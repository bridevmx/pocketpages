export type HstsOptions = {
  /** Seconds browsers remember to use HTTPS only, 180 days unless told otherwise */
  maxAge?: number
  includeSubDomains?: boolean
  preload?: boolean
}

export type HeadersOptions = {
  /** `X-Content-Type-Options`, `nosniff` unless told otherwise */
  contentTypeOptions?: string | false
  /** `X-Frame-Options`, `SAMEORIGIN` unless told otherwise */
  frameOptions?: string | false
  /** `Referrer-Policy`, `strict-origin-when-cross-origin` unless told otherwise */
  referrerPolicy?: string | false
  /** `Permissions-Policy`, no camera, microphone or geolocation unless told otherwise */
  permissionsPolicy?: string | false
  /** `Cross-Origin-Opener-Policy`, not sent unless told to */
  crossOriginOpenerPolicy?: string | false
  /** `Cross-Origin-Resource-Policy`, not sent unless told to */
  crossOriginResourcePolicy?: string | false
  /** `Strict-Transport-Security`, sent over HTTPS only */
  hsts?: HstsOptions | false
}

export type CspDirectives = Record<string, string | string[] | boolean>

export type CspOptions = {
  /**
   * The directives, `'script-src': ["'self'", '{nonce}']`. `{nonce}` stands for the
   * nonce of the request, which pages get as `csp.nonce`. A directive that is `true`
   * has no sources (`'upgrade-insecure-requests': true`).
   */
  directives: CspDirectives
  /** Only report what the policy would block, without blocking it */
  reportOnly?: boolean
}

export const DEFAULT_HSTS_MAX_AGE = 15552000

const DEFAULTS = {
  contentTypeOptions: 'nosniff',
  frameOptions: 'SAMEORIGIN',
  referrerPolicy: 'strict-origin-when-cross-origin',
  permissionsPolicy: 'camera=(), microphone=(), geolocation=()',
} as const

/** Header values are not the place for line breaks, nor for more directives */
const assertSafe = (what: string, value: string, allowSemicolon = false) => {
  if (/[\r\n]/.test(value) || (!allowSemicolon && value.indexOf(';') !== -1)) {
    throw new Error(`Invalid ${what}: ${JSON.stringify(value)}`)
  }
}

export type BuiltHeaders = {
  /** Sent with every page */
  always: Array<[name: string, value: string]>
  /** Sent with the pages of requests that came in over HTTPS */
  secure: Array<[name: string, value: string]>
}

export const buildHeaders = (options: HeadersOptions = {}): BuiltHeaders => {
  const always: BuiltHeaders['always'] = []
  const secure: BuiltHeaders['secure'] = []

  const add = (name: string, value: string | false | undefined) => {
    if (value === false || value === '') return
    if (value === undefined) return
    assertSafe(name, value, true)
    always.push([name, value])
  }
  const pick = <K extends keyof typeof DEFAULTS>(key: K) =>
    options[key] === undefined ? DEFAULTS[key] : options[key]

  add('X-Content-Type-Options', pick('contentTypeOptions'))
  add('X-Frame-Options', pick('frameOptions'))
  add('Referrer-Policy', pick('referrerPolicy'))
  add('Permissions-Policy', pick('permissionsPolicy'))
  add('Cross-Origin-Opener-Policy', options.crossOriginOpenerPolicy)
  add('Cross-Origin-Resource-Policy', options.crossOriginResourcePolicy)

  if (options.hsts !== false) {
    const hsts = options.hsts ?? {}
    let value = `max-age=${Math.floor(hsts.maxAge ?? DEFAULT_HSTS_MAX_AGE)}`
    if (hsts.includeSubDomains) value += '; includeSubDomains'
    if (hsts.preload) value += '; preload'
    secure.push(['Strict-Transport-Security', value])
  }

  return { always, secure }
}

export const NONCE_PLACEHOLDER = '{nonce}'

export type BuiltCsp = {
  name: 'Content-Security-Policy' | 'Content-Security-Policy-Report-Only'
  /** The policy, cut where the nonce goes */
  parts: string[]
}

export const buildCsp = (options: CspOptions): BuiltCsp => {
  const directives: string[] = []
  const names = Object.keys(options.directives)
  for (let i = 0; i < names.length; i++) {
    const name = names[i]!
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      throw new Error(`Invalid CSP directive name: ${JSON.stringify(name)}`)
    }
    const value = options.directives[name]
    if (value === false) continue
    if (value === true) {
      directives.push(name)
      continue
    }
    const sources = Array.isArray(value) ? value.join(' ') : String(value)
    assertSafe(`CSP directive ${name}`, sources)
    directives.push(sources ? `${name} ${sources}` : name)
  }
  const policy = directives.join('; ')
  return {
    name: options.reportOnly
      ? 'Content-Security-Policy-Report-Only'
      : 'Content-Security-Policy',
    parts: policy.split(NONCE_PLACEHOLDER),
  }
}

/**
 * The policy for a request, with its nonce in the places that ask for one
 */
export const renderCsp = (csp: BuiltCsp, nonce: string): string =>
  csp.parts.length === 1 ? csp.parts[0]! : csp.parts.join(`'nonce-${nonce}'`)
