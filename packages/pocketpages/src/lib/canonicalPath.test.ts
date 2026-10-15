import { expect, test } from 'bun:test'
import { buildRouteIndex, canonicalPathFor, matchRoute } from './resolveRoute'
import './testkit'

const seg = (nodeName: string) => ({
  nodeName,
  paramName: /^\[.*\]$/.test(nodeName) ? nodeName.slice(1, -1) : undefined,
})

/** A route as AfterBootstrapHandler makes it: the extension of pages is gone from the last segment */
const page = (relativePath: string) =>
  ({
    relativePath,
    isStatic: false,
    fingerprint: 'abc',
    segments: relativePath.split('/').map(seg),
  }) as any

const file = (relativePath: string, fingerprint = 'f'.repeat(64)) =>
  ({
    relativePath,
    isStatic: true,
    fingerprint,
    segments: relativePath.split('/').map(seg),
  }) as any

const index = buildRouteIndex([
  page('index'),
  page('account/index'),
  page('dashboard'),
  page('posts/[id]/index'),
  page('posts/[id]'),
  page('shop/[category]/[item]'),
  file('members/handbook.pdf'),
])
const canonical = (pathname: string) => canonicalPathFor(index, pathname)

test('a page is known by its own address', () => {
  expect(canonical('/')).toBe('/')
  expect(canonical('/account')).toBe('/account')
  expect(canonical('/dashboard')).toBe('/dashboard')
})

test('every page has one address, the others are not routes', () => {
  expect(canonical('/account/')).toBe('/account')
  expect(matchRoute(index, '/account/index')).toBeNull()
  expect(matchRoute(index, '/index')).toBeNull()
  expect(matchRoute(index, '/account/index/whatever')).toBeNull()
  expect(matchRoute(index, '/dashboard/anything')).toBeNull()
  expect(matchRoute(index, '/dashboard/a/b/c')).toBeNull()
  // not routes, so they are left as they are
  expect(canonical('/account/index')).toBe('/account/index')
})

test('[param] segments keep the value of the request', () => {
  expect(canonical('/posts/5')).toBe('/posts/5')
  expect(canonical('/posts/5/')).toBe('/posts/5')
  expect(matchRoute(index, '/posts/5/index')).toBeNull()
  expect(matchRoute(index, '/posts/5/index/more')).toBeNull()
  expect(canonical('/shop/shoes/red')).toBe('/shop/shoes/red')
  expect(matchRoute(index, '/shop/shoes/red/extra')).toBeNull()
})

test('a [param] needs a value', () => {
  expect(matchRoute(index, '/shop')).toBeNull()
  expect(matchRoute(index, '/shop/shoes')).toBeNull()
})

test('empty segments and backslashes are not another way to write a path', () => {
  expect(matchRoute(index, '//account')).toBeNull()
  expect(matchRoute(index, '/account//')).toBeNull()
  expect(matchRoute(index, '/posts//5')).toBeNull()
  expect(matchRoute(index, '/posts\\5')).toBeNull()
  expect(matchRoute(index, '/\\account')).toBeNull()
})

test('static files are known by their file name, not by their fingerprint', () => {
  const hash = 'f'.repeat(64)
  expect(canonical('/members/handbook.pdf')).toBe('/members/handbook.pdf')
  expect(matchRoute(index, '/members/handbook.pdf/extra')).toBeNull()
  expect(canonical(`/members/handbook.${hash}.pdf`)).toBe(
    '/members/handbook.pdf'
  )
})

test('paths no route claims are left as they are', () => {
  expect(canonical('/api/health')).toBe('/api/health')
  expect(canonical('/nothing/here')).toBe('/nothing/here')
})

test('what is not an alias stays a different address', () => {
  expect(matchRoute(index, '/ACCOUNT')).toBeNull()
  expect(canonical('/ACCOUNT')).toBe('/ACCOUNT')
  expect(canonical('/%61ccount')).toBe('/%61ccount')
})
