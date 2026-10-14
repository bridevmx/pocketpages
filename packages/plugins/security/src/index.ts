import type {
  PagesRequest,
  PagesResponse,
  PluginFactory,
  PluginOptionsBase,
} from 'pocketpages'
import {
  checkOrigin,
  CsrfTools,
  issueToken,
  maskToken,
  readToken,
  VERDICT_MESSAGES,
  verifyToken,
} from './csrf'
import {
  buildCsp,
  buildHeaders,
  CspOptions,
  HeadersOptions,
  renderCsp,
} from './headers'
import { Counters, createLimiter, Decision, Limit } from './ratelimit'

export type { CspOptions, HeadersOptions, HstsOptions } from './headers'
export type { Decision, Limit } from './ratelimit'

export type CsrfOptions = {
  /** Where the browser keeps the token, `pp_csrf` unless told otherwise */
  cookieName?: string
  /** The form field that carries the token, `_csrf` unless told otherwise */
  fieldName?: string
  /** The header that can carry it instead, `X-CSRF-Token` unless told otherwise */
  headerName?: string
  /** Pages that take requests from elsewhere on purpose (webhooks...) */
  ignore?: string[]
  /** Sites (`https://app.example.com`) whose pages may send requests to this one */
  trustedOrigins?: string[]
  /** `POST`, `PUT`, `PATCH` and `DELETE` unless told otherwise */
  methods?: string[]
}

export type RateLimitRule = {
  /** Where the rule applies: `/login`, `/api/**`... */
  path: string | string[]
  /** Only for these methods. Every method unless told otherwise. */
  methods?: string[]
  /** Requests allowed per window */
  limit: number
  /** Window length in seconds */
  window: number
  /**
   * What requests are counted by: the address of the client (`ip`, the default), or
   * the signed in user when there is one (`user`). Needs the auth plugin to come
   * before this one.
   */
  by?: 'ip' | 'user'
}

export type RateLimitOptions = {
  rules: RateLimitRule[]
}

export type SecurityOptions = PluginOptionsBase & {
  /** Headers sent with every page, `false` for none. See `HeadersOptions`. */
  headers: HeadersOptions | false
  /** A Content-Security-Policy, none unless you describe one */
  csp: CspOptions | false
  /** Protection against forged requests, on unless told otherwise */
  csrf: CsrfOptions | false
  /** Limits on how often a client can request things, none unless you describe them */
  rateLimit: RateLimitOptions | false
}

const VALID_KEYS = ['debug', 'headers', 'csp', 'csrf', 'rateLimit']
const DEFAULT_UNSAFE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE']
const NAME = /^[A-Za-z0-9_-]+$/
const SWEEP_EVERY = 60_000

/**
 * What pages get as `csrf`
 */
export type Csrf = {
  /** A token for forms and scripts to send back. Looks different every time. */
  token: () => string
  /** `<input type="hidden" name="_csrf" value="...">` */
  field: () => string
  /** `<meta name="csrf-token" content="...">`, for scripts to read the token from */
  meta: () => string
  /** `{"X-CSRF-Token":"..."}`, for `hx-headers='...'` */
  hxHeaders: () => string
  fieldName: string
  headerName: string
}

export type RateLimitApi = {
  /** Counts a request against `limit` for `key`, and says whether it is allowed */
  hit: (key: string, limit: Limit) => Decision
  /** The same, and throws a 429 when it is not */
  enforce: (key: string, limit: Limit) => Decision
}

const securityPluginFactory: PluginFactory<SecurityOptions> = (
  config,
  extra
) => {
  const { globalApi, dbg } = config

  Object.keys(extra).forEach((key) => {
    if (!VALID_KEYS.includes(key)) {
      throw new Error(`pocketpages-plugin-security: unknown option '${key}'`)
    }
  })

  // --- headers

  const headers =
    extra.headers === false ? undefined : buildHeaders(extra.headers)
  const csp = extra.csp ? buildCsp(extra.csp) : undefined
  const cspNeedsNonce = !!csp && csp.parts.length > 1
  const staticCsp = csp && !cspNeedsNonce ? renderCsp(csp, '') : undefined

  const applyHeaders = (request: PagesRequest, response: PagesResponse) => {
    if (headers) {
      for (let i = 0; i < headers.always.length; i++) {
        response.header(headers.always[i]![0], headers.always[i]![1])
      }
      if (request.secure) {
        for (let i = 0; i < headers.secure.length; i++) {
          response.header(headers.secure[i]![0], headers.secure[i]![1])
        }
      }
    }
    if (csp) {
      if (staticCsp !== undefined) {
        response.header(csp.name, staticCsp)
      } else {
        // The nonce is only made, and the policy only written, when the response goes
        // out. Pages that never ask for the nonce get a header that has one nobody
        // uses, and are not tied to a visitor by it (the page cache can keep them).
        response.beforeSend(() => {
          const nonce =
            request.state.security?.nonce ?? $security.randomString(22)
          response.header(csp.name, renderCsp(csp, nonce))
        })
      }
    }
  }

  // --- csrf

  const csrfOptions =
    extra.csrf === false
      ? undefined
      : {
          cookieName: 'pp_csrf',
          fieldName: '_csrf',
          headerName: 'X-CSRF-Token',
          ignore: [] as string[],
          trustedOrigins: [] as string[],
          methods: DEFAULT_UNSAFE_METHODS,
          ...extra.csrf,
        }
  if (csrfOptions) {
    for (const name of [
      csrfOptions.cookieName,
      csrfOptions.fieldName,
      csrfOptions.headerName,
    ]) {
      if (!NAME.test(name)) {
        throw new Error(
          `pocketpages-plugin-security: invalid csrf name ${JSON.stringify(name)}`
        )
      }
    }
  }
  const unsafeMethods = new Set(
    (csrfOptions?.methods ?? []).map((method) => method.toUpperCase())
  )
  const isCsrfIgnored =
    csrfOptions && csrfOptions.ignore.length > 0
      ? globalApi.pathMatcher(csrfOptions.ignore)
      : () => false

  const tools: CsrfTools = {
    random: (length) =>
      $security.randomStringWithAlphabet(length, '0123456789abcdef'),
    sign: (value) => globalApi.sign(value, 'csrf'),
    unsign: (signed) => globalApi.unsign(signed, 'csrf'),
    equal: (a, b) => $security.equal(a, b),
  }

  /**
   * Who a token is for: the signed in user, or no one
   */
  const bindingOf = (request: PagesRequest) => request.auth?.id ?? ''

  const createCsrf = (
    request: PagesRequest,
    response: PagesResponse
  ): { csrf: Csrf; verify: () => void } => {
    const options = csrfOptions!
    const binding = bindingOf(request)
    let raw: string | undefined
    let masked: string | undefined

    const ensureToken = () => {
      if (raw !== undefined) return raw
      const existing = readToken(
        tools,
        request.cookies(options.cookieName),
        binding
      )
      if (existing !== undefined) {
        raw = existing
        return raw
      }
      const issued = issueToken(tools, binding)
      raw = issued.raw
      response.cookie(options.cookieName, issued.cookie, {
        httpOnly: true,
        sameSite: 'lax',
        secure: request.secure,
      })
      return raw
    }

    const token = () => {
      if (masked === undefined) masked = maskToken(tools, ensureToken())
      return masked
    }

    const submittedToken = () => {
      const fromHeader =
        request.header(options.headerName) || request.header('X-XSRF-Token')
      if (fromHeader) return fromHeader
      try {
        const body = request.body()
        if (body && typeof body === 'object') return body[options.fieldName]
      } catch (e) {
        dbg(`could not read the body to look for a CSRF token: ${e}`)
      }
      return undefined
    }

    const verify = () => {
      const host = request.header('Host')
      const forwarded = request.header('X-Forwarded-Host').split(',')[0]!.trim()
      const origin = checkOrigin({
        secFetchSite: request.header('Sec-Fetch-Site'),
        origin: request.header('Origin'),
        hosts: forwarded ? [host, forwarded] : [host],
        trusted: options.trustedOrigins,
      })
      if (origin !== 'ok') {
        dbg(
          `CSRF: ${request.method} ${request.pathname} comes from another site`
        )
        throw new ForbiddenError('CSRF origin not allowed')
      }
      const verdict = verifyToken(
        tools,
        request.cookies(options.cookieName),
        submittedToken(),
        binding
      )
      if (verdict !== 'ok') {
        dbg(`CSRF: ${request.method} ${request.pathname} refused: ${verdict}`)
        throw new ForbiddenError(VERDICT_MESSAGES[verdict])
      }
    }

    const csrf: Csrf = {
      token,
      field: () =>
        `<input type="hidden" name="${options.fieldName}" value="${token()}">`,
      meta: () => `<meta name="csrf-token" content="${token()}">`,
      hxHeaders: () => `{"${options.headerName}":"${token()}"}`,
      fieldName: options.fieldName,
      headerName: options.headerName,
    }
    return { csrf, verify }
  }

  // --- rate limiting

  const store = () => $app.store<any>() as any
  // PocketBase added an atomic update to its store after v0.25. Without it a few
  // requests that land at the very same moment may not be counted, which is the
  // price of being able to run on both.
  const hasAtomicUpdate = typeof store().setFunc === 'function'

  const counters: Counters = {
    get: (key) => {
      const value = store().get(key)
      return typeof value === 'number' ? value : 0
    },
    increment: (key) => {
      const s = store()
      if (hasAtomicUpdate) {
        let count = 0
        s.setFunc(key, (old: unknown) => {
          count = (typeof old === 'number' ? old : 0) + 1
          return count
        })
        return count
      }
      const old = s.get(key)
      const count = (typeof old === 'number' ? old : 0) + 1
      s.set(key, count)
      return count
    },
    remove: (key) => {
      store().remove(key)
    },
    keys: () => {
      const s = store()
      return typeof s.keys === 'function'
        ? Array.from(s.keys() as string[])
        : Object.keys(s.getAll())
    },
  }
  const limiter = createLimiter(counters)
  let lastSweep = Date.now()
  const sweepSometimes = () => {
    const now = Date.now()
    if (now - lastSweep < SWEEP_EVERY) return
    lastSweep = now
    const removed = limiter.sweep()
    if (removed) dbg(`rate limit: swept ${removed} counters`)
  }

  const rules = (extra.rateLimit ? extra.rateLimit.rules : []).map(
    (rule, index) => {
      if (!(rule.limit > 0) || !(rule.window > 0) || !rule.path) {
        throw new Error(
          `pocketpages-plugin-security: rate limit rule ${index} needs a path, a limit and a window`
        )
      }
      return {
        scope: `r${index}`,
        match: globalApi.pathMatcher(rule.path),
        methods: rule.methods
          ? new Set(rule.methods.map((method) => method.toUpperCase()))
          : undefined,
        limit: { limit: rule.limit, window: rule.window },
        by: rule.by ?? 'ip',
      }
    }
  )

  const describeDecision = (response: PagesResponse, decision: Decision) => {
    response.header('RateLimit-Limit', `${decision.limit}`)
    response.header('RateLimit-Remaining', `${decision.remaining}`)
    response.header('RateLimit-Reset', `${decision.resetIn}`)
    if (!decision.allowed) {
      response.header('Retry-After', `${decision.retryAfter}`)
    }
  }

  const enforceRules = (request: PagesRequest, response: PagesResponse) => {
    sweepSometimes()
    const { pathname, method } = request
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i]!
      if (rule.methods && !rule.methods.has(method)) continue
      if (!rule.match(pathname)) continue
      const subject =
        rule.by === 'user' && request.auth
          ? `user:${request.auth.id}`
          : `ip:${request.ip}`
      const decision = limiter.hit(rule.scope, subject, rule.limit)
      describeDecision(response, decision)
      if (!decision.allowed) {
        dbg(
          `rate limit: ${subject} is over ${rule.limit.limit}/${rule.limit.window}s on ${pathname}`
        )
        throw new TooManyRequestsError('Too many requests')
      }
    }
  }

  return {
    name: 'security',

    onRequest: ({ request, response, route }) => {
      if (route && !route.isStatic) {
        applyHeaders(request, response)
      }
      if (rules.length > 0 && route !== undefined) {
        enforceRules(request, response)
      }
    },

    onExtendContextApi: ({ api }) => {
      const { request, response } = api

      if (csrfOptions) {
        // Here and not in onRequest, where who is signed in is not known until the auth
        // plugin has run, whatever the order the plugins are in
        const { csrf, verify } = createCsrf(request, response)
        if (
          unsafeMethods.has(request.method) &&
          !isCsrfIgnored(request.pathname)
        ) {
          verify()
        }
        api.csrf = csrf
      }

      api.csp = {
        // Made when a page first asks for it
        get nonce(): string {
          if (!cspNeedsNonce) return ''
          const state = request.state.security ?? (request.state.security = {})
          return state.nonce ?? (state.nonce = $security.randomString(22))
        },
      }

      const hit = (key: string, limit: Limit) =>
        limiter.hit(`api${limit.window}`, key, limit)
      api.rateLimit = {
        hit,
        enforce: (key, limit) => {
          const decision = hit(key, limit)
          describeDecision(response, decision)
          if (!decision.allowed) {
            throw new TooManyRequestsError('Too many requests')
          }
          return decision
        },
      } as RateLimitApi
    },
  }
}

export default securityPluginFactory
