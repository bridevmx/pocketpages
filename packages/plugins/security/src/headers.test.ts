import { expect, test } from 'bun:test'
import { buildCsp, buildHeaders, renderCsp } from './headers'

const toObject = (list: Array<[string, string]>) => Object.fromEntries(list)

test('sensible headers are sent unless told otherwise', () => {
  const { always, secure } = buildHeaders()
  expect(toObject(always)).toEqual({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  })
  expect(toObject(secure)).toEqual({
    'Strict-Transport-Security': 'max-age=15552000',
  })
})

test('headers can be changed or turned off one by one', () => {
  const { always } = buildHeaders({
    frameOptions: 'DENY',
    referrerPolicy: false,
    permissionsPolicy: '',
    contentTypeOptions: false,
    crossOriginOpenerPolicy: 'same-origin',
    crossOriginResourcePolicy: 'same-site',
  })
  expect(toObject(always)).toEqual({
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-site',
  })
})

test('HSTS has options, and can be turned off', () => {
  expect(
    toObject(
      buildHeaders({
        hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
      }).secure
    )
  ).toEqual({
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  })
  expect(buildHeaders({ hsts: false }).secure).toEqual([])
})

test('headers cannot carry line breaks', () => {
  expect(() =>
    buildHeaders({ referrerPolicy: 'no-referrer\r\nX-Evil: 1' })
  ).toThrow()
})

test('a policy is made of its directives', () => {
  const csp = buildCsp({
    directives: {
      'default-src': ["'self'"],
      'img-src': ["'self'", 'data:', 'https://cdn.example.com'],
      'object-src': ["'none'"],
      'upgrade-insecure-requests': true,
      'frame-ancestors': "'self'",
      'style-src': false,
    },
  })
  expect(csp.name).toBe('Content-Security-Policy')
  expect(renderCsp(csp, 'abc')).toBe(
    "default-src 'self'; img-src 'self' data: https://cdn.example.com; object-src 'none'; upgrade-insecure-requests; frame-ancestors 'self'"
  )
})

test('the nonce goes where the policy asks for it', () => {
  const csp = buildCsp({
    directives: {
      'script-src': ["'self'", '{nonce}'],
      'style-src': ['{nonce}'],
    },
    reportOnly: true,
  })
  expect(csp.name).toBe('Content-Security-Policy-Report-Only')
  expect(renderCsp(csp, 'Zm9v')).toBe(
    "script-src 'self' 'nonce-Zm9v'; style-src 'nonce-Zm9v'"
  )
})

test('directives cannot sneak in more directives', () => {
  expect(() =>
    buildCsp({ directives: { 'script-src': ["'self'; script-src *"] } })
  ).toThrow()
  expect(() =>
    buildCsp({ directives: { 'script-src; evil': ["'self'"] } })
  ).toThrow()
  expect(() =>
    buildCsp({ directives: { 'script-src': ["'self'\r\nX-Evil: 1"] } })
  ).toThrow()
})
