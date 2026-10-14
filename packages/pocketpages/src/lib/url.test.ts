import { expect, test } from 'bun:test'
import parse from 'url-parse'
import { quickPathname } from './url'

test('quickPathname gives the pathname url-parse gives', () => {
  const samples = [
    '/',
    '/index',
    '/a/b/c',
    '/a/b?x=1',
    '/a/b?x=1&y=/z',
    '/a/b#hash',
    '/a?x=1#h',
    '/a%20b/c',
    '/a%2Fb',
    '/docs/overview.md',
    '/assets/app.abc123.css?v=2',
    '/products/42?filter={"a":1}',
    '/a/',
    '/a//b',
    '/?',
    '/#',
    '/a?b?c',
    '/é/日本',
    '/path;param/x',
    '/a:b/c',
    '/a@b/c',
    '/a\\b',
  ]
  for (const sample of samples) {
    const quick = quickPathname(sample)
    expect(quick).toBeDefined()
    expect(quick).toBe(parse(sample, true).pathname)
  }
})

test('quickPathname leaves anything but a plain path to url-parse', () => {
  const samples = [
    '',
    '*',
    'http://example.com/a',
    '//host/a',
    '/\\host/a',
    'a/b',
    'localhost:8090',
  ]
  for (const sample of samples) {
    expect(quickPathname(sample)).toBeUndefined()
  }
})

test('quickPathname agrees with url-parse on random request targets', () => {
  let seed = 11
  const random = () =>
    (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296
  const alphabet = 'ab/?#=&%.-_:@;[]{}"~ 1é'
  for (let i = 0; i < 20000; i++) {
    let s = '/'
    const length = Math.floor(random() * 12)
    for (let j = 0; j < length; j++)
      s += alphabet[Math.floor(random() * alphabet.length)]
    const quick = quickPathname(s)
    if (quick !== undefined) {
      expect(quick).toBe(parse(s, true).pathname)
    }
  }
})
