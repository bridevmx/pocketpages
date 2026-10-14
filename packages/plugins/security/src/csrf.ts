/**
 * What the CSRF protection needs from the outside, so that it can be tested without
 * PocketBase.
 */
export type CsrfTools = {
  /** `length` random hexadecimal characters */
  random: (length: number) => string
  /** `value.signature` */
  sign: (value: string) => string
  /** The value, if the signature is right */
  unsign: (signed: string) => string | undefined
  /** Compares without leaking where the strings differ */
  equal: (a: string, b: string) => boolean
}

/**
 * Cookie values that start with a letter followed by a dot are never mistaken for JSON
 * by `request.cookies()`
 */
const COOKIE_PREFIX = 'v1.'
const TOKEN_LENGTH = 32
const HEX = '0123456789abcdef'
const RAW_TOKEN = /^[0-9a-f]{32}$/
const MASKED_TOKEN = /^[0-9a-f]{64}$/

/**
 * A new token for someone. `binding` is who they are (the id of the signed in user, or
 * nothing), so that a token an attacker got for themselves does not work for anyone
 * else.
 *
 * `cookie` is what to store in the browser, `raw` what the forms are going to carry
 * (masked, see `maskToken`).
 */
export const issueToken = (tools: CsrfTools, binding: string) => {
  const raw = tools.random(TOKEN_LENGTH)
  return {
    raw,
    cookie: COOKIE_PREFIX + tools.sign(`${binding}|${raw}`),
  }
}

/**
 * The token in a cookie, if the cookie is one of ours and was issued to `binding`
 */
export const readToken = (
  tools: CsrfTools,
  cookie: unknown,
  binding: string
): string | undefined => {
  if (typeof cookie !== 'string' || !cookie.startsWith(COOKIE_PREFIX)) {
    return undefined
  }
  const value = tools.unsign(cookie.slice(COOKIE_PREFIX.length))
  if (value === undefined) return undefined
  const prefix = `${binding}|`
  if (!value.startsWith(prefix)) return undefined
  const raw = value.slice(prefix.length)
  return RAW_TOKEN.test(raw) ? raw : undefined
}

/**
 * The same token looks different every time it is put in a page: a random pad followed
 * by the token xor-ed with it. A page that compresses well and echoes what an attacker
 * sends would otherwise let them guess a token that never changes one character at a
 * time (the BREACH attack).
 */
export const maskToken = (tools: CsrfTools, raw: string): string => {
  const pad = tools.random(TOKEN_LENGTH)
  let masked = ''
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    masked += HEX[parseInt(raw[i]!, 16) ^ parseInt(pad[i]!, 16)]
  }
  return pad + masked
}

export const unmaskToken = (masked: string): string | undefined => {
  if (!MASKED_TOKEN.test(masked)) return undefined
  let raw = ''
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    raw +=
      HEX[parseInt(masked[i]!, 16) ^ parseInt(masked[TOKEN_LENGTH + i]!, 16)]
  }
  return raw
}

export type Verdict =
  | 'ok'
  /** The browser sent no cookie with a token */
  | 'no-cookie'
  /** The cookie is not ours, has been tampered with or is someone else's */
  | 'bad-cookie'
  /** The request carries no token */
  | 'no-token'
  /** The token is not the one of the cookie */
  | 'bad-token'

export const verifyToken = (
  tools: CsrfTools,
  cookie: unknown,
  submitted: unknown,
  binding: string
): Verdict => {
  if (cookie === undefined || cookie === null || cookie === '') {
    return 'no-cookie'
  }
  const expected = readToken(tools, cookie, binding)
  if (expected === undefined) return 'bad-cookie'
  if (submitted === undefined || submitted === null || submitted === '') {
    return 'no-token'
  }
  const raw = unmaskToken(String(submitted))
  if (raw === undefined) return 'bad-token'
  return tools.equal(raw, expected) ? 'ok' : 'bad-token'
}

export const VERDICT_MESSAGES: Record<Exclude<Verdict, 'ok'>, string> = {
  'no-cookie': 'CSRF cookie missing',
  'bad-cookie': 'CSRF cookie invalid',
  'no-token': 'CSRF token missing',
  'bad-token': 'CSRF token invalid',
}

export type OriginCheck = {
  /** The `Sec-Fetch-Site` header, `''` when absent */
  secFetchSite: string
  /** The `Origin` header, `''` when absent */
  origin: string
  /** The hosts this site is known as: the `Host` header, and `X-Forwarded-Host` */
  hosts: string[]
  /** Origins (`https://app.example.com`) or hosts (`app.example.com`) to trust as well */
  trusted: string[]
}

const originHost = (origin: string) => {
  const scheme = origin.indexOf('://')
  return scheme === -1 ? origin : origin.slice(scheme + 3)
}

/**
 * Browsers say where a request comes from. A request that does not come from the site
 * itself (or from somewhere it trusts) is not made by one of its pages.
 *
 * Requests that say nothing, which is what tools other than browsers do, are left to
 * the token.
 */
export const checkOrigin = (check: OriginCheck): 'ok' | 'cross-site' => {
  const { secFetchSite, origin, hosts, trusted } = check
  if (secFetchSite === 'same-origin' || secFetchSite === 'none') return 'ok'
  if (origin) {
    if (origin === 'null') return 'cross-site'
    const host = originHost(origin)
    if (hosts.indexOf(host) !== -1) return 'ok'
    if (trusted.indexOf(origin) !== -1 || trusted.indexOf(host) !== -1) {
      return 'ok'
    }
    return 'cross-site'
  }
  return secFetchSite ? 'cross-site' : 'ok'
}
