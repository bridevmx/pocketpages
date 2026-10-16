import { expect, test } from 'bun:test'
import * as path from 'node:path'
import { confine } from './confine'

globalThis.$filepath = {
  rel: (base: string, target: string) => {
    const r = path.relative(base, target)
    return r === '' ? '.' : r
  },
} as any

const root = '/app/pb_hooks/pages'

test('the root itself, and anything under it, is confined', () => {
  expect(confine(root, root)).toBe(true)
  expect(confine(root, root + '/_private/header.ejs')).toBe(true)
  expect(confine(root, root + '/a/b/_private/x.js')).toBe(true)
})

test('.. that lands outside root is not confined', () => {
  expect(confine(root, '/app/pb_hooks/.env')).toBe(false)
  expect(confine(root, '/app/pb_hooks')).toBe(false)
  expect(confine(root, '/etc/passwd')).toBe(false)
})

test('a sibling directory whose name starts with the same prefix is not mistaken for being inside', () => {
  expect(confine(root, '/app/pb_hooks/pages-evil/x')).toBe(false)
})

test('.. that still lands back inside root is confined', () => {
  expect(confine(root, root + '/a/../b')).toBe(true)
})
