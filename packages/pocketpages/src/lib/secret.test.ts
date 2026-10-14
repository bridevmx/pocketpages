import { afterEach, beforeEach, expect, test } from 'bun:test'
import { installGlobals, store } from './testkit'

const g = globalThis as any
const { resetSecrets, secret, sign, unsign } = await import('./secret')

beforeEach(() => {
  installGlobals()
  store.clear()
  resetSecrets()
  delete process.env.POCKETPAGES_SECRET
})

afterEach(() => {
  delete process.env.POCKETPAGES_SECRET
})

test('secrets are stable and made for a purpose', () => {
  const a = secret('session')
  expect(a).toMatch(/^[0-9a-f]{64}$/)
  expect(secret('session')).toBe(a)
  expect(secret('csrf')).not.toBe(a)
})

test('every runtime derives the same secret', () => {
  const a = secret('session')
  // Another runtime: nothing remembered but what is in the store
  resetSecrets()
  expect(secret('session')).toBe(a)
})

test('POCKETPAGES_SECRET wins when set', () => {
  const fromPocketBase = secret('session')
  store.clear()
  resetSecrets()
  process.env.POCKETPAGES_SECRET = 'my own secret, long enough'
  const fromEnv = secret('session')
  expect(fromEnv).not.toBe(fromPocketBase)
  expect(fromEnv).toBe(
    g.$security.hs256('pocketpages:session', 'my own secret, long enough')
  )
})

test('a secret that is too short is not used', () => {
  process.env.POCKETPAGES_SECRET = 'short'
  const derived = secret('session')
  expect(derived).toBe(g.$security.hs256('pocketpages:session', 's'.repeat(50)))
})

test('without anything to derive from, the secret lasts until the restart', () => {
  g.$app.findCollectionByNameOrId = () => {
    throw new Error('no such collection')
  }
  const a = secret('session')
  expect(secret('session')).toBe(a)
  expect(a).toMatch(/^[0-9a-f]{64}$/)
  store.clear()
  resetSecrets()
  expect(secret('session')).not.toBe(a)
})

test('signed values can be read and checked', () => {
  const signed = sign('hello')
  expect(signed.startsWith('hello.')).toBe(true)
  expect(signed).toHaveLength('hello.'.length + 64)
  expect(unsign(signed)).toBe('hello')
})

test('values with dots in them survive', () => {
  expect(unsign(sign('a.b.c'))).toBe('a.b.c')
  expect(unsign(sign(''))).toBe('')
  expect(unsign(sign('.'))).toBe('.')
})

test('tampering is noticed', () => {
  const signed = sign('user:1')
  expect(unsign(signed.replace('user:1', 'user:2'))).toBeUndefined()
  expect(
    unsign(signed.slice(0, -1) + (signed.endsWith('0') ? '1' : '0'))
  ).toBeUndefined()
  expect(unsign(`user:2.${'0'.repeat(64)}`)).toBeUndefined()
})

test('a signature means something for its purpose only', () => {
  const signed = sign('user:1', 'session')
  expect(unsign(signed, 'session')).toBe('user:1')
  expect(unsign(signed, 'csrf')).toBeUndefined()
  expect(unsign(signed)).toBeUndefined()
})

test('things that are not signed values are refused', () => {
  expect(unsign('')).toBeUndefined()
  expect(unsign('nodots')).toBeUndefined()
  expect(unsign('.')).toBeUndefined()
  expect(unsign('a.b')).toBeUndefined()
  expect(unsign(undefined as any)).toBeUndefined()
  expect(unsign(42 as any)).toBeUndefined()
})
