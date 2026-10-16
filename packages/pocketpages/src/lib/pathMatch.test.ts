import { expect, test } from 'bun:test'
import { pathMatcher } from './pathMatch'

test('plain paths match as they are, with or without a trailing slash', () => {
  const m = pathMatcher('/login')
  expect(m('/login')).toBe(true)
  expect(m('/login/')).toBe(true)
  expect(m('/login/x')).toBe(false)
  expect(m('/logins')).toBe(false)
  expect(m('/')).toBe(false)
  expect(m('/Login')).toBe(false)
})

test('* stands for one segment', () => {
  const m = pathMatcher('/blog/*')
  expect(m('/blog/a')).toBe(true)
  expect(m('/blog/a/')).toBe(true)
  expect(m('/blog')).toBe(false)
  expect(m('/blog/')).toBe(false)
  expect(m('/blog/a/b')).toBe(false)
  const part = pathMatcher('/files/*.png')
  expect(part('/files/a.png')).toBe(true)
  expect(part('/files/a/b.png')).toBe(false)
  expect(part('/files/a.jpg')).toBe(false)
})

test('** stands for any number of segments, none included', () => {
  const m = pathMatcher('/admin/**')
  expect(m('/admin')).toBe(true)
  expect(m('/admin/')).toBe(true)
  expect(m('/admin/users')).toBe(true)
  expect(m('/admin/users/1/edit')).toBe(true)
  expect(m('/administrator')).toBe(false)
  expect(m('/other/admin')).toBe(false)

  const middle = pathMatcher('/users/**/edit')
  expect(middle('/users/edit')).toBe(true)
  expect(middle('/users/1/edit')).toBe(true)
  expect(middle('/users/1/2/edit')).toBe(true)
  expect(middle('/users/1/view')).toBe(false)

  const everything = pathMatcher('/**')
  expect(everything('/')).toBe(true)
  expect(everything('/a/b/c')).toBe(true)
})

test('characters that mean something in a regular expression do not', () => {
  const m = pathMatcher('/a.b/(c)+/[id]')
  expect(m('/a.b/(c)+/[id]')).toBe(true)
  expect(m('/aXb/(c)+/[id]')).toBe(false)
  expect(m('/a.b/c/i')).toBe(false)
})

test('a list of patterns matches when one of them does', () => {
  const m = pathMatcher(['/login', '/admin/**'])
  expect(m('/login')).toBe(true)
  expect(m('/admin/x')).toBe(true)
  expect(m('/logout')).toBe(false)
  expect(pathMatcher([])('/anything')).toBe(false)
})
