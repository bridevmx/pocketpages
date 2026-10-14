import { expect, test } from 'bun:test'
import { pathMatcher } from '../../../pocketpages/src/lib/pathMatch'
import { compileRules, decide, rolesOf, safeNext, Subject } from './rules'

const visitor: Subject = { signedIn: false, roles: [], verified: false }
const member: Subject = { signedIn: true, roles: ['member'], verified: true }
const admin: Subject = { signedIn: true, roles: ['admin'], verified: true }
const unconfirmed: Subject = {
  signedIn: true,
  roles: ['member'],
  verified: false,
}

const rules = compileRules(
  [
    { path: '/admin/login', public: true },
    { path: '/admin/**', roles: ['admin'] },
    { path: ['/account', '/account/**'], auth: true },
    { path: '/orders/**', verified: true },
    { path: '/moderate/**', roles: ['admin', 'moderator'], hide: true },
    { path: '/posts/*', methods: ['POST', 'PUT', 'DELETE'], auth: true },
  ],
  pathMatcher
)

const can = (who: Subject, path: string, method = 'GET') =>
  decide(rules, who, method, path)

test('requests no rule covers are allowed', () => {
  expect(can(visitor, '/')).toBe('allow')
  expect(can(visitor, '/blog/hello')).toBe('allow')
})

test('pages that need a sign in', () => {
  expect(can(visitor, '/account')).toBe('unauthenticated')
  expect(can(visitor, '/account/settings')).toBe('unauthenticated')
  expect(can(member, '/account')).toBe('allow')
  expect(can(member, '/account/settings')).toBe('allow')
})

test('pages that need a role', () => {
  expect(can(visitor, '/admin')).toBe('unauthenticated')
  expect(can(member, '/admin/users')).toBe('forbidden')
  expect(can(admin, '/admin/users')).toBe('allow')
})

test('the first rule that covers a request decides', () => {
  expect(can(visitor, '/admin/login')).toBe('allow')
  expect(can(visitor, '/admin/login/reset')).toBe('unauthenticated')
})

test('any of the roles of a rule will do', () => {
  const moderator: Subject = {
    signedIn: true,
    roles: ['moderator'],
    verified: true,
  }
  expect(can(moderator, '/moderate/queue')).toBe('allow')
  expect(can(admin, '/moderate/queue')).toBe('allow')
  expect(can(member, '/moderate/queue')).toBe('hidden')
  expect(can(visitor, '/moderate/queue')).toBe('hidden')
})

test('users with several roles have all of them', () => {
  const both: Subject = {
    signedIn: true,
    roles: ['member', 'admin'],
    verified: true,
  }
  expect(can(both, '/admin')).toBe('allow')
})

test('pages that need a confirmed email address', () => {
  expect(can(visitor, '/orders')).toBe('unauthenticated')
  expect(can(unconfirmed, '/orders/1')).toBe('unverified')
  expect(can(member, '/orders/1')).toBe('allow')
})

test('rules can be for some methods', () => {
  expect(can(visitor, '/posts/1', 'GET')).toBe('allow')
  expect(can(visitor, '/posts/1', 'POST')).toBe('unauthenticated')
  expect(can(visitor, '/posts/1', 'DELETE')).toBe('unauthenticated')
  expect(can(member, '/posts/1', 'DELETE')).toBe('allow')
})

test('rules have to say something', () => {
  expect(() => compileRules([{ path: '/x' }], pathMatcher)).toThrow(
    'says nothing'
  )
  expect(() => compileRules([{ path: '', auth: true }], pathMatcher)).toThrow(
    'needs a path'
  )
  expect(() =>
    compileRules([{ path: '/x', public: true, auth: true }], pathMatcher)
  ).toThrow('public')
  expect(() =>
    compileRules([{ path: '/x', roles: 'admin' as any }], pathMatcher)
  ).toThrow('must be a list')
  expect(() => compileRules([{ path: '/x', roles: [] }], pathMatcher)).toThrow(
    'says nothing'
  )
})

test('roles come from a text or a list, and superusers have one of their own', () => {
  expect(rolesOf('admin', false)).toEqual(['admin'])
  expect(rolesOf(['admin', 'editor', 'admin'], false)).toEqual([
    'admin',
    'editor',
  ])
  expect(rolesOf(undefined, false)).toEqual([])
  expect(rolesOf('', false)).toEqual([])
  expect(rolesOf(null, false)).toEqual([])
  expect(rolesOf([1, null, 'x'], false)).toEqual(['x'])
  expect(rolesOf('admin', true)).toEqual(['admin', 'superuser'])
  expect(rolesOf(undefined, true)).toEqual(['superuser'])
})

test('only places on this site are safe to send visitors to', () => {
  for (const good of [
    '/',
    '/account',
    '/account/settings?tab=1#top',
    '/a/b%20c',
  ]) {
    expect(safeNext(good)).toBe(good)
  }
  for (const bad of [
    undefined,
    null,
    42,
    '',
    'account',
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/\\/evil.example',
    '\\\\evil.example',
    'javascript:alert(1)',
    '/ok\nLocation: https://evil.example',
    '/ok\r\n',
    '/a\\b',
  ]) {
    expect(safeNext(bad)).toBe('/')
  }
  expect(safeNext('https://evil.example', '/home')).toBe('/home')
})
