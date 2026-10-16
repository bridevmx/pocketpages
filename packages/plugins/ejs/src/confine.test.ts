import { expect, test } from 'bun:test'
import { confine } from './confine'

const root = '/app/pb_hooks/pages'

test('the root itself, and anything under it, is confined', () => {
  expect(confine(root, root)).toBe(true)
  expect(confine(root, root + '/_private/header.ejs')).toBe(true)
})

test('.. that lands outside root is not confined', () => {
  expect(confine(root, '/app/pb_hooks/.env')).toBe(false)
  expect(confine(root, '/etc/passwd')).toBe(false)
})

test('a sibling directory that is a text prefix of root, or that root is a text prefix of, is not mistaken for being inside', () => {
  expect(confine(root, '/app/pb_hooks/pages-backup/x')).toBe(false)
  expect(confine('/app/pb_hooks/pages-backup', root)).toBe(false)
})

test('an absolute path given as the second path.resolve() argument, which replaces the first instead of joining it, is caught', () => {
  expect(confine(root, '/etc/passwd')).toBe(false)
})
