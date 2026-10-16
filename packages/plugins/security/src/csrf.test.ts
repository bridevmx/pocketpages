import { expect, test } from 'bun:test'
import { createHmac, randomBytes } from 'node:crypto'
import {
  checkOrigin,
  CsrfTools,
  issueToken,
  maskToken,
  readToken,
  unmaskToken,
  verifyToken,
} from './csrf'

const tools = (key = 'secret'): CsrfTools => {
  const mac = (value: string) =>
    createHmac('sha256', key).update(value).digest('hex')
  return {
    random: (n) => randomBytes(n).toString('hex').slice(0, n),
    sign: (value) => `${value}.${mac(value)}`,
    unsign: (signed) => {
      const cut = signed.lastIndexOf('.')
      if (cut < 0) return undefined
      const value = signed.slice(0, cut)
      return signed.slice(cut + 1) === mac(value) ? value : undefined
    },
    equal: (a, b) => a === b,
  }
}

test('a token travels in a cookie and is read back', () => {
  const t = tools()
  const { raw, cookie } = issueToken(t, '')
  expect(cookie.startsWith('v1.')).toBe(true)
  expect(raw).toMatch(/^[0-9a-f]{32}$/)
  expect(readToken(t, cookie, '')).toBe(raw)
})

test('cookies never look like JSON', () => {
  const t = tools()
  for (let i = 0; i < 50; i++) {
    expect(issueToken(t, 'user1').cookie).toMatch(/^v1\./)
  }
})

test('a token belongs to the person it was issued to', () => {
  const t = tools()
  const { cookie } = issueToken(t, 'user1')
  expect(readToken(t, cookie, 'user1')).toBeDefined()
  expect(readToken(t, cookie, 'user2')).toBeUndefined()
  expect(readToken(t, cookie, '')).toBeUndefined()
  const anonymous = issueToken(t, '').cookie
  expect(readToken(t, anonymous, 'user1')).toBeUndefined()
})

test('a user id that starts like another one does not borrow its tokens', () => {
  const t = tools()
  const { cookie } = issueToken(t, 'abc')
  expect(readToken(t, cookie, 'ab')).toBeUndefined()
  expect(readToken(t, cookie, 'abc')).toBeDefined()
})

test('cookies made with another secret, or by hand, are refused', () => {
  const { cookie } = issueToken(tools('one'), '')
  expect(readToken(tools('two'), cookie, '')).toBeUndefined()
  expect(readToken(tools(), 'v1.' + 'a'.repeat(32), '')).toBeUndefined()
  expect(readToken(tools(), 'a'.repeat(32), '')).toBeUndefined()
  expect(readToken(tools(), undefined, '')).toBeUndefined()
  expect(readToken(tools(), 42, '')).toBeUndefined()
})

test('masked tokens are different every time and unmask to the same one', () => {
  const t = tools()
  const { raw } = issueToken(t, '')
  const a = maskToken(t, raw)
  const b = maskToken(t, raw)
  expect(a).toMatch(/^[0-9a-f]{64}$/)
  expect(a).not.toBe(b)
  expect(unmaskToken(a)).toBe(raw)
  expect(unmaskToken(b)).toBe(raw)
  expect(a).not.toContain(raw)
})

test('anything that is not a masked token is refused', () => {
  expect(unmaskToken('')).toBeUndefined()
  expect(unmaskToken('a'.repeat(63))).toBeUndefined()
  expect(unmaskToken('g'.repeat(64))).toBeUndefined()
  expect(unmaskToken('A'.repeat(64))).toBeUndefined()
})

test('requests are verified against the cookie they come with', () => {
  const t = tools()
  const { raw, cookie } = issueToken(t, 'user1')
  const submitted = maskToken(t, raw)
  expect(verifyToken(t, cookie, submitted, 'user1')).toBe('ok')
  expect(verifyToken(t, cookie, maskToken(t, raw), 'user1')).toBe('ok')

  expect(verifyToken(t, undefined, submitted, 'user1')).toBe('no-cookie')
  expect(verifyToken(t, '', submitted, 'user1')).toBe('no-cookie')
  expect(verifyToken(t, 'v1.junk', submitted, 'user1')).toBe('bad-cookie')
  expect(verifyToken(t, cookie, submitted, 'user2')).toBe('bad-cookie')
  expect(verifyToken(t, cookie, undefined, 'user1')).toBe('no-token')
  expect(verifyToken(t, cookie, '', 'user1')).toBe('no-token')
  expect(verifyToken(t, cookie, 'nonsense', 'user1')).toBe('bad-token')

  const other = issueToken(t, 'user1')
  expect(verifyToken(t, cookie, maskToken(t, other.raw), 'user1')).toBe(
    'bad-token'
  )
})

test('the token the form carries survives being turned into something else', () => {
  const t = tools()
  const { raw, cookie } = issueToken(t, '')
  // A number that PocketBase read out of a form field, say
  const submitted = Number('1234') as unknown
  expect(verifyToken(t, cookie, submitted, '')).toBe('bad-token')
  expect(verifyToken(t, cookie, new String(maskToken(t, raw)), '')).toBe('ok')
})

const same = {
  hosts: ['example.com'],
  trusted: [] as string[],
}

test('requests from the site itself pass', () => {
  expect(
    checkOrigin({ ...same, secFetchSite: 'same-origin', origin: '' })
  ).toBe('ok')
  expect(checkOrigin({ ...same, secFetchSite: 'none', origin: '' })).toBe('ok')
  expect(
    checkOrigin({
      ...same,
      secFetchSite: '',
      origin: 'https://example.com',
    })
  ).toBe('ok')
  expect(
    checkOrigin({ ...same, secFetchSite: '', origin: 'http://example.com' })
  ).toBe('ok')
})

test('requests from elsewhere do not', () => {
  expect(
    checkOrigin({
      ...same,
      secFetchSite: 'cross-site',
      origin: 'https://evil.test',
    })
  ).toBe('cross-site')
  expect(
    checkOrigin({ ...same, secFetchSite: '', origin: 'https://evil.test' })
  ).toBe('cross-site')
  expect(
    checkOrigin({
      ...same,
      secFetchSite: '',
      origin: 'https://example.com.evil.test',
    })
  ).toBe('cross-site')
  expect(
    checkOrigin({
      ...same,
      secFetchSite: 'same-site',
      origin: 'https://sub.example.com',
    })
  ).toBe('cross-site')
  expect(checkOrigin({ ...same, secFetchSite: '', origin: 'null' })).toBe(
    'cross-site'
  )
  expect(checkOrigin({ ...same, secFetchSite: 'cross-site', origin: '' })).toBe(
    'cross-site'
  )
})

test('origins can be trusted by origin or by host', () => {
  const trusted = ['https://app.example.org', 'admin.example.org']
  expect(
    checkOrigin({
      hosts: ['example.com'],
      trusted,
      secFetchSite: 'cross-site',
      origin: 'https://app.example.org',
    })
  ).toBe('ok')
  expect(
    checkOrigin({
      hosts: ['example.com'],
      trusted,
      secFetchSite: 'cross-site',
      origin: 'https://admin.example.org',
    })
  ).toBe('ok')
  expect(
    checkOrigin({
      hosts: ['example.com'],
      trusted,
      secFetchSite: 'cross-site',
      origin: 'http://app.example.org',
    })
  ).toBe('cross-site')
})

test('requests that say nothing about where they come from are left to the token', () => {
  expect(checkOrigin({ ...same, secFetchSite: '', origin: '' })).toBe('ok')
})

test('a proxy can make the site known under several hosts', () => {
  expect(
    checkOrigin({
      hosts: ['localhost:8090', 'example.com'],
      trusted: [],
      secFetchSite: '',
      origin: 'https://example.com',
    })
  ).toBe('ok')
})
