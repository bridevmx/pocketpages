/** `_ga*` stands for `_ga`, `_gat` and `_gat_UA123` */
export const matchesName = (name: string, patterns: string[]): boolean => {
  for (const pattern of patterns) {
    if (
      pattern.endsWith('*')
        ? name.startsWith(pattern.slice(0, -1))
        : name === pattern
    ) {
      return true
    }
  }
  return false
}

/**
 * Whether the cookies of a request leave it a request for the page everybody gets. Any
 * cookie may be about the visitor (a session, a sign in, a language, a cart), so the
 * only ones that don't count are those you named.
 */
export const cookiesAllowCaching = (
  header: string,
  ignore: string[]
): boolean => {
  if (!header) return true
  if (ignore.length === 0) return false
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=')
    const name = (eq === -1 ? pair : pair.slice(0, eq)).trim()
    if (name && !matchesName(name, ignore)) return false
  }
  return true
}

export type QueryRule = 'all' | 'none' | string[]

export type KeyParts = {
  method: string
  host: string
  path: string
  rawQuery: string
  query: QueryRule
  /** The values of the headers pages vary by, in the order they are named */
  vary: string[]
}

export const MAX_KEY_LENGTH = 512

/**
 * Which page a request is for. Requests with the same key get the same page.
 * Returns `undefined` when the key would be too long to be worth keeping: a client
 * could otherwise fill the cache with them.
 */
export const buildKey = (parts: KeyParts): string | undefined => {
  let query = ''
  if (parts.query === 'all') {
    query = parts.rawQuery ? `?${parts.rawQuery}` : ''
  } else if (Array.isArray(parts.query) && parts.rawQuery) {
    const wanted = parts.query
    const kept = parts.rawQuery
      .split('&')
      .filter((pair) => {
        const eq = pair.indexOf('=')
        return wanted.indexOf(eq === -1 ? pair : pair.slice(0, eq)) !== -1
      })
      .sort()
    query = kept.length > 0 ? `?${kept.join('&')}` : ''
  }
  const key = `${parts.method}\n${parts.host}\n${parts.path}${query}\n${parts.vary.join('\u0001')}`
  return key.length > MAX_KEY_LENGTH ? undefined : key
}

export const cacheControlFor = (ttl: number, browserMaxAge: number): string =>
  `public, max-age=${Math.max(0, Math.floor(browserMaxAge))}, s-maxage=${Math.max(0, Math.floor(ttl))}`

export type ResponseFacts = {
  status: number
  /** `Content-Type` of the response so far, `''` if none (pages are HTML then) */
  contentType: string
  /** Something was already written: a redirect, `echo()`... */
  sent: boolean
  /** The page sets a cookie */
  setsCookie: boolean
  /** The `Cache-Control` of the page, `''` if none */
  cacheControl: string
  vary: string
  /** The page said not to keep it (`pageCache.skip()`) */
  skipped: boolean
  /** It carries a nonce that would not be the one of the visitor it is sent to */
  hasNonce: boolean
  bytes: number
  maxBytes: number
}

/**
 * Whether a rendered page can be kept for the next visitor, and if not, why not
 */
export const whyNotCacheable = (facts: ResponseFacts): string | undefined => {
  if (facts.skipped) return 'skipped by the page'
  if (facts.sent) return 'already sent'
  if (facts.status !== 200) return `status ${facts.status}`
  if (facts.contentType && !/^text\/html\b/i.test(facts.contentType))
    return 'not html'
  if (facts.setsCookie) return 'sets a cookie'
  if (facts.hasNonce) return 'has a nonce'
  if (/\b(private|no-store|no-cache)\b/i.test(facts.cacheControl))
    return 'Cache-Control says not to'
  if (/(^|,)\s*\*\s*(,|$)/.test(facts.vary)) return 'Vary: *'
  if (facts.bytes > facts.maxBytes) return 'too large'
  return undefined
}

/** Parses the lines `Name: value` kept with a page */
export const parseHeaders = (lines: string): Array<[string, string]> => {
  const headers: Array<[string, string]> = []
  for (const line of lines.split('\n')) {
    const colon = line.indexOf(':')
    if (colon > 0)
      headers.push([line.slice(0, colon), line.slice(colon + 1).trim()])
  }
  return headers
}

export const serializeHeaders = (headers: Array<[string, string]>): string =>
  headers
    .filter(([name, value]) => !/[\r\n]/.test(name) && !/[\r\n]/.test(value))
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n')
