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

test('index spelled out, or followed by anything, is the folder', () => {
  expect(canonical('/account/index')).toBe('/account')
  expect(canonical('/account/index/')).toBe('/account')
  expect(canonical('/account/index/whatever/else')).toBe('/account')
  expect(canonical('/index')).toBe('/')
  expect(canonical('/index/more')).toBe('/')
})

test('a file route answers for what follows it', () => {
  expect(canonical('/dashboard/anything')).toBe('/dashboard')
  expect(canonical('/dashboard/a/b/c')).toBe('/dashboard')
})

test('[param] segments keep the value of the request', () => {
  expect(canonical('/posts/5')).toBe('/posts/5')
  expect(canonical('/posts/5/index')).toBe('/posts/5')
  expect(canonical('/posts/5/index/more')).toBe('/posts/5')
  expect(canonical('/shop/shoes/red')).toBe('/shop/shoes/red')
  expect(canonical('/shop/shoes/red/extra')).toBe('/shop/shoes/red')
})

test('a [param] that finds nothing in the path leaves the address shorter', () => {
  expect(canonical('/shop')).toBe('/shop')
  expect(canonical('/shop/shoes')).toBe('/shop/shoes')
})

test('static files are known by their file name, not by their fingerprint', () => {
  const hash = 'f'.repeat(64)
  expect(canonical('/members/handbook.pdf')).toBe('/members/handbook.pdf')
  expect(canonical('/members/handbook.pdf/extra')).toBe('/members/handbook.pdf')
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
