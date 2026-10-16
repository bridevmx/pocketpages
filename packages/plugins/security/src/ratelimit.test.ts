import { expect, test } from 'bun:test'
import { Counters, createLimiter } from './ratelimit'

const memory = () => {
  const map = new Map<string, number>()
  const counters: Counters = {
    get: (key) => map.get(key) ?? 0,
    increment: (key) => {
      const n = (map.get(key) ?? 0) + 1
      map.set(key, n)
      return n
    },
    remove: (key) => {
      map.delete(key)
    },
    keys: () => Array.from(map.keys()),
  }
  return { map, counters }
}

const clock = (start = 1_000_000) => {
  let time = start
  return {
    now: () => time,
    advance: (ms: number) => {
      time += ms
    },
  }
}

const rule = { limit: 3, window: 60 }

test('requests are allowed up to the limit, and not past it', () => {
  const { counters } = memory()
  const c = clock(60_000 * 100) // start of a window
  const limiter = createLimiter(counters, c.now)
  const results = [1, 2, 3, 4, 5].map(
    () => limiter.hit('login', '203.0.113.9', rule).allowed
  )
  expect(results).toEqual([true, true, true, false, false])
})

test('decisions say how much is left and when to try again', () => {
  const { counters } = memory()
  const c = clock(60_000 * 100 + 20_000) // 20 seconds into a window
  const limiter = createLimiter(counters, c.now)
  const first = limiter.hit('login', 'a', rule)
  expect(first).toEqual({
    allowed: true,
    limit: 3,
    remaining: 2,
    resetIn: 40,
    retryAfter: 0,
  })
  limiter.hit('login', 'a', rule)
  limiter.hit('login', 'a', rule)
  const blocked = limiter.hit('login', 'a', rule)
  expect(blocked.allowed).toBe(false)
  expect(blocked.remaining).toBe(0)
  expect(blocked.retryAfter).toBe(40)
})

test('clients are counted apart', () => {
  const { counters } = memory()
  const c = clock(60_000 * 100)
  const limiter = createLimiter(counters, c.now)
  for (let i = 0; i < 3; i++) limiter.hit('login', 'a', rule)
  expect(limiter.hit('login', 'a', rule).allowed).toBe(false)
  expect(limiter.hit('login', 'b', rule).allowed).toBe(true)
})

test('rules are counted apart', () => {
  const { counters } = memory()
  const c = clock(60_000 * 100)
  const limiter = createLimiter(counters, c.now)
  for (let i = 0; i < 3; i++) limiter.hit('login', 'a', rule)
  expect(limiter.hit('login', 'a', rule).allowed).toBe(false)
  expect(limiter.hit('signup', 'a', rule).allowed).toBe(true)
})

test('subjects can hold any character', () => {
  const { counters } = memory()
  const c = clock(60_000 * 100)
  const limiter = createLimiter(counters, c.now)
  for (const subject of ['::1', '2001:db8::1', 'a|b', 'user@example.com']) {
    expect(limiter.hit('login', subject, rule).allowed).toBe(true)
  }
})

test('a new window starts afresh, but the one before still counts for a while', () => {
  const { counters } = memory()
  const c = clock(60_000 * 100)
  const limiter = createLimiter(counters, c.now)
  for (let i = 0; i < 3; i++) limiter.hit('login', 'a', rule)
  expect(limiter.hit('login', 'a', rule).allowed).toBe(false) // 4 requests in window 100

  // The very start of the next window: the previous one weighs as much as it did
  c.advance(60_000)
  expect(limiter.hit('login', 'a', rule).allowed).toBe(false)

  // Half way through, half of the 4 earlier requests are forgotten
  c.advance(30_000)
  const later = limiter.hit('login', 'a', rule) // 4 * 0.5 + 2
  expect(later.allowed).toBe(false)

  // Next window after that, with nothing going on in between: all forgotten
  c.advance(120_000)
  expect(limiter.hit('login', 'a', rule).allowed).toBe(true)
})

test('a client that waits is let in again', () => {
  const { counters } = memory()
  const c = clock(60_000 * 100)
  const limiter = createLimiter(counters, c.now)
  for (let i = 0; i < 4; i++) limiter.hit('login', 'a', rule)
  c.advance(60_000 * 2)
  const fresh = limiter.hit('login', 'a', rule)
  expect(fresh.allowed).toBe(true)
  expect(fresh.remaining).toBe(2)
})

test('counters of windows that are over are swept away', () => {
  const { map, counters } = memory()
  map.set('unrelated', 5)
  const c = clock(60_000 * 100)
  const limiter = createLimiter(counters, c.now)
  limiter.hit('login', 'a', rule)
  limiter.hit('login', 'b', rule)
  expect(limiter.sweep()).toBe(0)

  c.advance(60_000)
  limiter.hit('login', 'a', rule)
  expect(limiter.sweep()).toBe(0) // the window before still counts

  c.advance(60_000)
  expect(limiter.sweep()).toBe(2) // window 100 is two windows behind now
  expect(map.has('unrelated')).toBe(true)
  expect(counters.keys().filter((k) => k.startsWith('pp:rl|'))).toHaveLength(1)

  c.advance(60_000 * 10)
  expect(limiter.sweep()).toBe(1)
  expect(counters.keys()).toEqual(['unrelated'])
})

test('rules with different windows are swept by their own', () => {
  const { counters } = memory()
  const c = clock(1_000 * 3600 * 24)
  const limiter = createLimiter(counters, c.now)
  limiter.hit('short', 'a', { limit: 1, window: 10 })
  limiter.hit('long', 'a', { limit: 1, window: 3600 })
  c.advance(60_000)
  expect(limiter.sweep()).toBe(1)
  expect(counters.keys()).toHaveLength(1)
  expect(counters.keys()[0]).toContain('|long|')
})
