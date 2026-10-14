import { beforeEach, expect, test } from 'bun:test'
import { createHmac, randomBytes } from 'node:crypto'
import { pathMatcher } from '../../../pocketpages/src/lib/pathMatch'

const g = globalThis as any

class FakeError {
  constructor(
    public status: number,
    public message = ''
  ) {}
}
g.ForbiddenError = class extends FakeError {
  constructor(message?: string) {
    super(403, message)
  }
}
g.TooManyRequestsError = class extends FakeError {
  constructor(message?: string) {
    super(429, message)
  }
}

const store = new Map<string, any>()
const installStore = (atomic: boolean) => {
  const api: any = {
    get: (key: string) => store.get(key) ?? null,
    set: (key: string, value: any) => void store.set(key, value),
    remove: (key: string) => void store.delete(key),
    getAll: () => Object.fromEntries(store),
  }
  if (atomic) {
    api.keys = () => Array.from(store.keys())
    api.setFunc = (key: string, fn: (old: any) => any) =>
      void store.set(key, fn(store.get(key) ?? null))
  }
  g.$app = { store: () => api }
}
g.$security = {
  randomString: (n: number) => randomBytes(n).toString('hex').slice(0, n),
  randomStringWithAlphabet: (n: number, alphabet: string) => {
    let s = ''
    for (let i = 0; i < n; i++)
      s += alphabet[Math.floor(Math.random() * alphabet.length)]
    return s
  },
  equal: (a: string, b: string) => a === b,
}

const mac = (value: string, purpose: string) =>
  createHmac('sha256', `secret:${purpose}`).update(value).digest('hex')
const globalApi: any = {
  sign: (value: string, purpose = 'sign') => `${value}.${mac(value, purpose)}`,
  unsign: (signed: string, purpose = 'sign') => {
    const cut = signed.length - 65
    if (cut < 0 || signed[cut] !== '.') return undefined
    const value = signed.slice(0, cut)
    return signed.slice(cut + 1) === mac(value, purpose) ? value : undefined
  },
  pathMatcher,
}

const { default: factory } = await import('./index')

const make = (options: Record<string, any> = {}) =>
  factory({ globalApi, dbg: () => {} } as any, { debug: false, ...options })

type Cookie = { name: string; value: string; options: any }

/** What the plugin sees of a request, and what it does to the response */
const exchange = (
  init: {
    method?: string
    path?: string
    headers?: Record<string, string>
    cookies?: Record<string, string>
    body?: any
    auth?: { id: string }
    ip?: string
    secure?: boolean
    route?: any
  } = {}
) => {
  const headers = new Map(
    Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])
  )
  const sent = new Map<string, string>()
  const cookies: Cookie[] = []
  const request: any = {
    method: init.method ?? 'GET',
    pathname: init.path ?? '/',
    ip: init.ip ?? '203.0.113.9',
    secure: init.secure ?? false,
    auth: init.auth,
    state: {},
    header: (name: string) => headers.get(name.toLowerCase()) ?? '',
    cookies: (name?: string) => (name ? init.cookies?.[name] : init.cookies),
    body: () => init.body ?? {},
  }
  const callbacks: Array<() => void> = []
  const response: any = {
    beforeSend: (callback: () => void) => void callbacks.push(callback),
    header: (name: string, value?: string) => {
      if (value === undefined) return sent.get(name) ?? ''
      sent.set(name, value)
      return value
    },
    cookie: (name: string, value: string, options: any = {}) => {
      cookies.push({ name, value, options })
    },
  }
  const route = 'route' in init ? init.route : { isStatic: false }
  return { request, response, sent, cookies, route, callbacks }
}

const run = (plugin: any, x: ReturnType<typeof exchange>) => {
  plugin.onRequest({ request: x.request, response: x.response, route: x.route })
  const api: any = { request: x.request, response: x.response }
  plugin.onExtendContextApi({ api, route: x.route })
  return api
}

/** The response goes out */
const send = (x: ReturnType<typeof exchange>) => {
  for (const callback of x.callbacks.splice(0)) callback()
}

const catching = (fn: () => void) => {
  try {
    fn()
  } catch (e) {
    return e as FakeError
  }
  return undefined
}

beforeEach(() => {
  store.clear()
  installStore(true)
})

test('unknown options are refused', () => {
  expect(() => make({ csrff: true })).toThrow("unknown option 'csrff'")
})

test('pages get security headers, other requests do not', () => {
  const plugin = make()
  const page = exchange({ secure: true })
  run(plugin, page)
  expect(Object.fromEntries(page.sent)).toEqual({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Strict-Transport-Security': 'max-age=15552000',
  })

  const plain = exchange({ secure: false })
  run(plugin, plain)
  expect(plain.sent.has('Strict-Transport-Security')).toBe(false)

  const api = exchange({ route: null })
  plugin.onRequest!({
    request: api.request,
    response: api.response,
    route: api.route,
  })
  expect(api.sent.size).toBe(0)

  const file = exchange({ route: { isStatic: true } })
  plugin.onRequest!({
    request: file.request,
    response: file.response,
    route: file.route,
  })
  expect(file.sent.size).toBe(0)
})

test('headers can be turned off', () => {
  const plugin = make({ headers: false, csrf: false })
  const page = exchange()
  run(plugin, page)
  expect(page.sent.size).toBe(0)
})

test('a policy with a nonce gets a new one for every request', () => {
  const plugin = make({
    csp: { directives: { 'script-src': ["'self'", '{nonce}'] } },
    headers: false,
  })
  const a = exchange()
  const apiA = run(plugin, a)
  const nonceA = apiA.csp.nonce
  send(a)
  const b = exchange()
  const apiB = run(plugin, b)
  const nonceB = apiB.csp.nonce
  send(b)
  expect(nonceA).toMatch(/^[0-9a-f]{22}$/)
  expect(nonceA).not.toBe(nonceB)
  expect(apiA.csp.nonce).toBe(nonceA)
  expect(a.sent.get('Content-Security-Policy')).toBe(
    `script-src 'self' 'nonce-${nonceA}'`
  )
})

test('the nonce is only made for the pages that ask for it', () => {
  const plugin = make({
    csp: { directives: { 'script-src': ["'self'", '{nonce}'] } },
    headers: false,
  })
  const unused = exchange()
  run(plugin, unused)
  expect(unused.request.state.security).toBeUndefined()
  send(unused)
  // The policy is written all the same, with a nonce nobody got to see
  expect(unused.sent.get('Content-Security-Policy')).toMatch(
    /^script-src 'self' 'nonce-[0-9a-f]{22}'$/
  )
  expect(unused.request.state.security).toBeUndefined()
})

test('a policy without a nonce is the same for everyone', () => {
  const plugin = make({
    csp: { directives: { 'default-src': ["'self'"] }, reportOnly: true },
    headers: false,
  })
  const a = exchange()
  const api = run(plugin, a)
  expect(a.sent.get('Content-Security-Policy-Report-Only')).toBe(
    "default-src 'self'"
  )
  expect(api.csp.nonce).toBe('')
})

// --- csrf

test('forms get a token, and it is accepted when sent back', () => {
  const plugin = make()
  const get = exchange()
  const api = run(plugin, get)
  const token = api.csrf.token()
  expect(token).toMatch(/^[0-9a-f]{64}$/)
  expect(api.csrf.token()).toBe(token)
  expect(api.csrf.field()).toBe(
    `<input type="hidden" name="_csrf" value="${token}">`
  )
  expect(api.csrf.meta()).toBe(`<meta name="csrf-token" content="${token}">`)
  expect(api.csrf.hxHeaders()).toBe(`{"X-CSRF-Token":"${token}"}`)
  expect(get.cookies).toHaveLength(1)
  const cookie = get.cookies[0]!
  expect(cookie.name).toBe('pp_csrf')
  expect(cookie.value).toMatch(/^v1\./)
  expect(cookie.options).toEqual({
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
  })

  const post = exchange({
    method: 'POST',
    cookies: { pp_csrf: cookie.value },
    body: { _csrf: token, name: 'Ana' },
  })
  expect(catching(() => run(plugin, post))).toBeUndefined()
})

test('the cookie is kept for as long as it is good', () => {
  const plugin = make()
  const first = exchange()
  run(plugin, first).csrf.token()
  const again = exchange({ cookies: { pp_csrf: first.cookies[0]!.value } })
  run(plugin, again).csrf.token()
  expect(again.cookies).toHaveLength(0)
})

test('no cookie is set unless a page asks for a token', () => {
  const plugin = make()
  const x = exchange()
  run(plugin, x)
  expect(x.cookies).toHaveLength(0)
})

test('tokens are for the secure setting of the request', () => {
  const plugin = make()
  const x = exchange({ secure: true })
  run(plugin, x).csrf.token()
  expect(x.cookies[0]!.options.secure).toBe(true)
})

test('requests without a valid token are refused', () => {
  const plugin = make()
  const get = exchange()
  const token = run(plugin, get).csrf.token()
  const cookie = get.cookies[0]!.value

  const refusal = (init: Parameters<typeof exchange>[0]) =>
    catching(() => run(plugin, exchange({ method: 'POST', ...init })))

  expect(refusal({})).toMatchObject({
    status: 403,
    message: 'CSRF cookie missing',
  })
  expect(refusal({ cookies: { pp_csrf: cookie } })).toMatchObject({
    status: 403,
    message: 'CSRF token missing',
  })
  expect(
    refusal({ cookies: { pp_csrf: cookie }, body: { _csrf: 'x'.repeat(64) } })
  ).toMatchObject({
    message: 'CSRF token invalid',
  })
  expect(
    refusal({ cookies: { pp_csrf: 'v1.nope' }, body: { _csrf: token } })
  ).toMatchObject({
    message: 'CSRF cookie invalid',
  })
  expect(
    refusal({
      cookies: { pp_csrf: cookie },
      body: { _csrf: token },
      headers: { Origin: 'https://evil.test', Host: 'example.test' },
    })
  ).toMatchObject({ message: 'CSRF origin not allowed' })
})

test('the token can come in a header', () => {
  const plugin = make()
  const get = exchange()
  const token = run(plugin, get).csrf.token()
  const post = exchange({
    method: 'DELETE',
    cookies: { pp_csrf: get.cookies[0]!.value },
    headers: { 'X-CSRF-Token': token },
  })
  expect(catching(() => run(plugin, post))).toBeUndefined()
})

test('safe methods are not checked', () => {
  const plugin = make()
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    expect(catching(() => run(plugin, exchange({ method })))).toBeUndefined()
  }
})

test('a token is for the user it was issued to', () => {
  const plugin = make()
  const get = exchange({ auth: { id: 'user1' } })
  const token = run(plugin, get).csrf.token()
  const cookie = get.cookies[0]!.value

  const asOwner = exchange({
    method: 'POST',
    auth: { id: 'user1' },
    cookies: { pp_csrf: cookie },
    body: { _csrf: token },
  })
  expect(catching(() => run(plugin, asOwner))).toBeUndefined()

  const asOther = exchange({
    method: 'POST',
    auth: { id: 'user2' },
    cookies: { pp_csrf: cookie },
    body: { _csrf: token },
  })
  expect(catching(() => run(plugin, asOther))).toMatchObject({ status: 403 })

  // Signing in or out gets a new token for the next page
  const afterSignOut = exchange({ cookies: { pp_csrf: cookie } })
  run(plugin, afterSignOut).csrf.token()
  expect(afterSignOut.cookies).toHaveLength(1)
})

test('pages can take requests from elsewhere', () => {
  const plugin = make({ csrf: { ignore: ['/webhooks/**'] } })
  const hook = exchange({ method: 'POST', path: '/webhooks/stripe' })
  expect(catching(() => run(plugin, hook))).toBeUndefined()
  const other = exchange({ method: 'POST', path: '/contact' })
  expect(catching(() => run(plugin, other))).toMatchObject({ status: 403 })
})

test('sites can be trusted', () => {
  const plugin = make({ csrf: { trustedOrigins: ['https://app.example.org'] } })
  const get = exchange()
  const token = run(plugin, get).csrf.token()
  const post = exchange({
    method: 'POST',
    cookies: { pp_csrf: get.cookies[0]!.value },
    body: { _csrf: token },
    headers: {
      Origin: 'https://app.example.org',
      Host: 'example.test',
      'Sec-Fetch-Site': 'cross-site',
    },
  })
  expect(catching(() => run(plugin, post))).toBeUndefined()
})

test('the proxy can say which host the site is known as', () => {
  const plugin = make()
  const get = exchange()
  const token = run(plugin, get).csrf.token()
  const post = exchange({
    method: 'POST',
    cookies: { pp_csrf: get.cookies[0]!.value },
    body: { _csrf: token },
    headers: {
      Origin: 'https://example.com',
      Host: 'localhost:8090',
      'X-Forwarded-Host': 'example.com',
    },
  })
  expect(catching(() => run(plugin, post))).toBeUndefined()
})

test('csrf protection can be turned off, or changed', () => {
  const off = make({ csrf: false })
  const post = exchange({ method: 'POST' })
  expect(catching(() => run(off, post))).toBeUndefined()
  expect(run(off, exchange()).csrf).toBeUndefined()

  const renamed = make({
    csrf: { cookieName: 'xsrf', fieldName: 'token', headerName: 'X-Token' },
  })
  const get = exchange()
  const api = run(renamed, get)
  expect(api.csrf.field()).toContain('name="token"')
  expect(api.csrf.hxHeaders()).toContain('"X-Token"')
  expect(get.cookies[0]!.name).toBe('xsrf')

  const putOnly = make({ csrf: { methods: ['put'] } })
  expect(
    catching(() => run(putOnly, exchange({ method: 'POST' })))
  ).toBeUndefined()
  expect(
    catching(() => run(putOnly, exchange({ method: 'PUT' })))
  ).toMatchObject({ status: 403 })

  expect(() => make({ csrf: { cookieName: 'bad name;' } })).toThrow(
    'invalid csrf name'
  )
})

// --- rate limits

const limited = (options: Record<string, any> = {}) =>
  make({
    csrf: false,
    headers: false,
    rateLimit: {
      rules: [
        { path: '/login', methods: ['POST'], limit: 3, window: 60 },
        ...(options.rules ?? []),
      ],
    },
  })

test('clients that go over a limit are told to wait', () => {
  const plugin = limited()
  const request = () =>
    exchange({ method: 'POST', path: '/login', route: null })
  const results = [1, 2, 3, 4].map(() => {
    const x = request()
    const error = catching(() =>
      plugin.onRequest!({
        request: x.request,
        response: x.response,
        route: null,
      })
    )
    return { error, sent: x.sent }
  })
  expect(results.map((r) => r.error?.status)).toEqual([
    undefined,
    undefined,
    undefined,
    429,
  ])
  expect(results[0]!.sent.get('RateLimit-Limit')).toBe('3')
  expect(results[0]!.sent.get('RateLimit-Remaining')).toBe('2')
  expect(Number(results[3]!.sent.get('Retry-After'))).toBeGreaterThan(0)
  expect(results[3]!.sent.get('RateLimit-Remaining')).toBe('0')
})

test('rules only apply to the paths and methods they are for', () => {
  const plugin = limited()
  for (let i = 0; i < 10; i++) {
    const get = exchange({ method: 'GET', path: '/login', route: null })
    expect(
      catching(() =>
        plugin.onRequest!({
          request: get.request,
          response: get.response,
          route: null,
        })
      )
    ).toBeUndefined()
    const other = exchange({ method: 'POST', path: '/elsewhere', route: null })
    expect(
      catching(() =>
        plugin.onRequest!({
          request: other.request,
          response: other.response,
          route: null,
        })
      )
    ).toBeUndefined()
  }
})

test('clients are told apart', () => {
  const plugin = limited()
  const post = (ip: string) => {
    const x = exchange({ method: 'POST', path: '/login', route: null, ip })
    return catching(() =>
      plugin.onRequest!({
        request: x.request,
        response: x.response,
        route: null,
      })
    )
  }
  for (let i = 0; i < 3; i++) post('198.51.100.1')
  expect(post('198.51.100.1')).toMatchObject({ status: 429 })
  expect(post('198.51.100.2')).toBeUndefined()
})

test('requests can be counted by user', () => {
  const plugin = make({
    csrf: false,
    headers: false,
    rateLimit: {
      rules: [{ path: '/api/**', limit: 2, window: 60, by: 'user' }],
    },
  })
  const hit = (ip: string, auth?: { id: string }) => {
    const x = exchange({ path: '/api/things', route: null, ip, auth })
    return catching(() =>
      plugin.onRequest!({
        request: x.request,
        response: x.response,
        route: null,
      })
    )
  }
  expect(hit('1.1.1.1', { id: 'u1' })).toBeUndefined()
  expect(hit('2.2.2.2', { id: 'u1' })).toBeUndefined()
  expect(hit('3.3.3.3', { id: 'u1' })).toMatchObject({ status: 429 })
  expect(hit('3.3.3.3', { id: 'u2' })).toBeUndefined()
  // No one signed in: by address
  expect(hit('4.4.4.4')).toBeUndefined()
  expect(hit('4.4.4.4')).toBeUndefined()
  expect(hit('4.4.4.4')).toMatchObject({ status: 429 })
})

test('limits hold without the atomic update of newer PocketBase versions', () => {
  installStore(false)
  const plugin = limited()
  const post = () => {
    const x = exchange({ method: 'POST', path: '/login', route: null })
    return catching(() =>
      plugin.onRequest!({
        request: x.request,
        response: x.response,
        route: null,
      })
    )
  }
  expect([post(), post(), post(), post()].map((e) => e?.status)).toEqual([
    undefined,
    undefined,
    undefined,
    429,
  ])
})

test('pages can limit what they want, by any key', () => {
  const plugin = make({ csrf: false, headers: false })
  const x = exchange()
  const api = run(plugin, x)
  const limit = { limit: 2, window: 300 }
  expect(api.rateLimit.hit('login:ana@example.com', limit)).toMatchObject({
    allowed: true,
    remaining: 1,
  })
  expect(api.rateLimit.hit('login:ana@example.com', limit)).toMatchObject({
    allowed: true,
    remaining: 0,
  })
  expect(api.rateLimit.hit('login:ana@example.com', limit).allowed).toBe(false)
  expect(api.rateLimit.hit('login:bob@example.com', limit).allowed).toBe(true)

  expect(
    catching(() => api.rateLimit.enforce('login:ana@example.com', limit))
  ).toMatchObject({ status: 429 })
  expect(x.sent.get('Retry-After')).toBeDefined()
  expect(
    catching(() => api.rateLimit.enforce('login:carol@example.com', limit))
  ).toBeUndefined()
})

test('rules have to make sense', () => {
  expect(() =>
    make({ rateLimit: { rules: [{ path: '/x', limit: 0, window: 60 }] } })
  ).toThrow('rate limit rule 0')
  expect(() =>
    make({ rateLimit: { rules: [{ path: '/x', limit: 5, window: 0 }] } })
  ).toThrow('rate limit rule 0')
  expect(() =>
    make({ rateLimit: { rules: [{ limit: 5, window: 5 }] } })
  ).toThrow('rate limit rule 0')
})
