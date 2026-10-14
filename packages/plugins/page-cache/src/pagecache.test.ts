import { expect, test } from 'bun:test'
import {
  buildKey,
  cacheControlFor,
  cookiesAllowCaching,
  hasFlash,
  matchesName,
  parseHeaders,
  parseQuery,
  serializeHeaders,
  whyNotCacheable,
} from './rules'
import { createPageStore, Entry, KeyValue, sweepEveryFor } from './store'

const memory = () => {
  const map = new Map<string, unknown>()
  const kv: KeyValue = {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => void map.set(key, value),
    remove: (key) => void map.delete(key),
    keys: () => Array.from(map.keys()),
  }
  return { map, kv }
}

const entry = (extra: Partial<Entry> = {}): Entry => ({
  body: '<p>hi</p>',
  etag: '"abc"',
  created: 1000,
  expires: 61000,
  tags: '',
  gens: '0',
  headers: '',
  ...extra,
})

// --- the cache

test('a page that was kept is found until it expires', () => {
  const { kv } = memory()
  const store = createPageStore(kv, 100)
  store.save('k', entry())
  expect(store.lookup('k', 2000)?.body).toBe('<p>hi</p>')
  expect(store.lookup('k', 60999)).toBeDefined()
  expect(store.lookup('k', 61000)).toBeUndefined()
  expect(store.lookup('other', 2000)).toBeUndefined()
})

test('garbage in the store is not a page', () => {
  const { kv } = memory()
  const store = createPageStore(kv, 100)
  kv.set('pp:pc:e:a', 'text')
  kv.set('pp:pc:e:b', { body: 5 })
  kv.set('pp:pc:e:c', null)
  for (const key of ['a', 'b', 'c'])
    expect(store.lookup(key, 1)).toBeUndefined()
})

test('pages that depend on something are gone when it changes', () => {
  const { kv } = memory()
  const store = createPageStore(kv, 100)
  const g = store.generations(['posts', 'post:1'])
  store.save(
    'blog',
    entry({ tags: g.tags.join(','), gens: [...g.gens, g.global].join(',') })
  )
  const other = store.generations(['pages'])
  store.save(
    'about',
    entry({ tags: 'pages', gens: [...other.gens, other.global].join(',') })
  )
  const free = store.generations([])
  store.save('plain', entry({ gens: String(free.global) }))

  expect(store.lookup('blog', 2000)).toBeDefined()
  store.purge('post:1')
  expect(store.lookup('blog', 2000)).toBeUndefined()
  expect(store.lookup('about', 2000)).toBeDefined()
  expect(store.lookup('plain', 2000)).toBeDefined()

  // Pages made after the change depend on the new state
  const again = store.generations(['posts', 'post:1'])
  store.save(
    'blog',
    entry({
      tags: again.tags.join(','),
      gens: [...again.gens, again.global].join(','),
    })
  )
  expect(store.lookup('blog', 2000)).toBeDefined()
  store.purge('posts')
  store.purge('posts')
  expect(store.lookup('blog', 2000)).toBeUndefined()
})

test('everything can be purged at once', () => {
  const { kv } = memory()
  const store = createPageStore(kv, 100)
  const g = store.generations([])
  store.save('a', entry({ gens: String(g.global) }))
  store.save('b', entry({ tags: 'x', gens: `0,${g.global}` }))
  store.purgeAll()
  expect(store.lookup('a', 2000)).toBeUndefined()
  expect(store.lookup('b', 2000)).toBeUndefined()
})

test('tags have to be plain names', () => {
  const { kv } = memory()
  const store = createPageStore(kv, 100)
  for (const bad of ['', 'a b', 'a,b', 'a|b', 'x'.repeat(65), '../x']) {
    expect(() => store.purge(bad)).toThrow('Invalid page cache tag')
  }
  expect(() => store.purge('post:1.v2-x_y')).not.toThrow()
})

test('pages can be purged by address', () => {
  const { kv } = memory()
  const store = createPageStore(kv, 100)
  const key = (path: string) => `GET\nexample.com\n${path}\n`
  for (const path of [
    '/blog',
    '/blog/a',
    '/blog/a?page=2',
    '/blogger',
    '/about',
    '/blog?x=1',
  ]) {
    store.save(key(path), entry())
  }
  expect(store.purgePath('/blog')).toBe(4)
  expect(store.lookup(key('/blogger'), 2000)).toBeDefined()
  expect(store.lookup(key('/about'), 2000)).toBeDefined()
  expect(store.lookup(key('/blog/a'), 2000)).toBeUndefined()
  expect(store.purgePath('/about/')).toBe(0)
  expect(store.purgePath('/')).toBe(2)
})

test('sweeping removes what is out of date', () => {
  const { kv, map } = memory()
  const store = createPageStore(kv, 100)
  const g = store.generations([]).global
  store.save('old', entry({ expires: 5000, gens: String(g) }))
  store.save('new', entry({ expires: 90000, gens: String(g) }))
  kv.set('unrelated', 'x')
  expect(store.sweep(10000)).toBe(1)
  expect(map.has('pp:pc:e:old')).toBe(false)
  expect(map.has('pp:pc:e:new')).toBe(true)
  expect(map.has('unrelated')).toBe(true)
  store.purgeAll()
  expect(store.sweep(10000)).toBe(0)
})

test('sweeping makes room when there are too many pages, the oldest first', () => {
  const { kv, map } = memory()
  const store = createPageStore(kv, 10)
  const g = String(store.generations([]).global)
  for (let i = 0; i < 15; i++)
    store.save(`k${i}`, entry({ created: 1000 + i, expires: 90000, gens: g }))
  const left = store.sweep(2000)
  expect(left).toBe(9)
  expect(map.has('pp:pc:e:k0')).toBe(false)
  expect(map.has('pp:pc:e:k5')).toBe(false)
  expect(map.has('pp:pc:e:k6')).toBe(true)
  expect(map.has('pp:pc:e:k14')).toBe(true)
})

test('a flood of different addresses cannot fill the store between two sweeps', () => {
  const { kv, map } = memory()
  const store = createPageStore(kv, 50)
  const g = String(store.generations([]).global)
  const pages = () =>
    Array.from(map.keys()).filter((key) => key.startsWith('pp:pc:e:')).length
  let most = 0
  for (let i = 0; i < 2000; i++) {
    store.save(
      `GET\nhost\n/?q=${i}`,
      entry({ created: 1000 + i, expires: 9_000_000, gens: g })
    )
    most = Math.max(most, pages())
  }
  expect(most).toBeLessThanOrEqual(50 + sweepEveryFor(50))
  expect(pages()).toBeLessThanOrEqual(50 + sweepEveryFor(50))
  // The newest are the ones that stay
  expect(map.has('pp:pc:e:GET\nhost\n/?q=1999')).toBe(true)
  expect(map.has('pp:pc:e:GET\nhost\n/?q=0')).toBe(false)
})

test('making pages again does not make the store sweep each time', () => {
  const { kv } = memory()
  const store = createPageStore(kv, 40)
  const g = String(store.generations([]).global)
  let sweeps = 0
  const counting: KeyValue = {
    ...kv,
    keys: () => {
      sweeps++
      return kv.keys()
    },
  }
  const counted = createPageStore(counting, 40)
  // A full store whose pages are made again over and over
  for (let round = 0; round < 10; round++) {
    for (let i = 0; i < 40; i++)
      counted.save(
        `k${i}`,
        entry({ created: 1000 + round, expires: 9_000_000, gens: g })
      )
  }
  expect(store.sweep(2000)).toBe(40)
  // 400 saves, a sweep every `sweepEveryFor(40)` of them
  expect(sweeps).toBeLessThanOrEqual(Math.ceil(400 / sweepEveryFor(40)))
  expect(sweeps).toBeGreaterThan(0)
})

// --- rules

test('cookies stop pages from being shared, unless they are known to be harmless', () => {
  expect(cookiesAllowCaching('', [])).toBe(true)
  expect(cookiesAllowCaching('pp_session=abc', [])).toBe(false)
  expect(cookiesAllowCaching('a=1; b=2', ['a'])).toBe(false)
  expect(cookiesAllowCaching('a=1; b=2', ['a', 'b'])).toBe(true)
  expect(
    cookiesAllowCaching('_ga=GA1.2; _gat_UA123=1; _gid=x', ['_ga*', '_gid'])
  ).toBe(true)
  expect(cookiesAllowCaching('_ga=GA1.2; pp_session=x', ['_ga*'])).toBe(false)
  expect(cookiesAllowCaching('weird', ['weird'])).toBe(true)
  expect(cookiesAllowCaching(' ; ', ['a'])).toBe(true)
  expect(matchesName('_gat_UA1', ['_gat*'])).toBe(true)
  expect(matchesName('_ga', ['_gat*'])).toBe(false)
})

test('keys tell pages apart', () => {
  const base = {
    method: 'GET',
    host: 'example.com',
    path: '/blog',
    rawQuery: 'page=2&q=a',
    query: 'all' as const,
    vary: [] as string[],
  }
  expect(buildKey(base)).toBe('GET\nexample.com\n/blog?page=2&q=a\n')
  expect(buildKey({ ...base, rawQuery: '' })).toBe('GET\nexample.com\n/blog\n')
  expect(buildKey({ ...base, query: 'none' })).toBe('GET\nexample.com\n/blog\n')
  expect(buildKey({ ...base, query: ['q', 'page'] })).toBe(
    'GET\nexample.com\n/blog?page=2&q=a\n'
  )
  expect(
    buildKey({
      ...base,
      rawQuery: 'utm=1&q=a&flag&page=2',
      query: ['q', 'page', 'flag'],
    })
  ).toBe('GET\nexample.com\n/blog?flag=&page=2&q=a\n')
  expect(buildKey({ ...base, rawQuery: 'utm=1', query: ['q'] })).toBe(
    'GET\nexample.com\n/blog\n'
  )
  expect(buildKey({ ...base, vary: ['es', 'gzip'] })).toBe(
    'GET\nexample.com\n/blog?page=2&q=a\nes\u0001gzip'
  )
  expect(buildKey({ ...base, host: 'other.com' })).not.toBe(buildKey(base))
})

test('keys that are too long are not kept', () => {
  const base = {
    method: 'GET',
    host: 'example.com',
    path: '/blog',
    rawQuery: 'q=' + 'a'.repeat(600),
    query: 'all' as const,
    vary: [],
  }
  expect(buildKey(base)).toBeUndefined()
  expect(buildKey({ ...base, query: 'none' })).toBeDefined()
})

test('browsers and shared caches are told how long to keep pages', () => {
  expect(cacheControlFor(60, 0)).toBe('public, max-age=0, s-maxage=60')
  expect(cacheControlFor(60.7, 10)).toBe('public, max-age=10, s-maxage=60')
})

const facts = (extra: Record<string, unknown> = {}) =>
  ({
    status: 200,
    contentType: '',
    sent: false,
    setsCookie: false,
    cacheControl: '',
    vary: '',
    skipped: false,
    hasNonce: false,
    bytes: 1000,
    maxBytes: 5000,
    ...extra,
  }) as Parameters<typeof whyNotCacheable>[0]

test('ordinary pages can be kept', () => {
  expect(whyNotCacheable(facts())).toBeUndefined()
  expect(
    whyNotCacheable(facts({ contentType: 'text/html; charset=utf-8' }))
  ).toBeUndefined()
  expect(
    whyNotCacheable(
      facts({ cacheControl: 'public, max-age=60', vary: 'Accept-Language' })
    )
  ).toBeUndefined()
})

test('pages that are about someone, or not pages, are not kept', () => {
  const why = (extra: Record<string, unknown>) => whyNotCacheable(facts(extra))
  expect(why({ skipped: true })).toBe('skipped by the page')
  expect(why({ sent: true })).toBe('already sent')
  expect(why({ status: 404 })).toBe('status 404')
  expect(why({ status: 422 })).toBe('status 422')
  expect(why({ contentType: 'application/json' })).toBe('not html')
  expect(why({ setsCookie: true })).toBe('sets a cookie')
  expect(why({ hasNonce: true })).toBe('has a nonce')
  expect(why({ cacheControl: 'private' })).toBe('Cache-Control says not to')
  expect(why({ cacheControl: 'max-age=0, no-store' })).toBe(
    'Cache-Control says not to'
  )
  expect(why({ cacheControl: 'no-cache' })).toBe('Cache-Control says not to')
  expect(why({ vary: '*' })).toBe('Vary: *')
  expect(why({ vary: 'Accept, *' })).toBe('Vary: *')
  expect(why({ bytes: 6000 })).toBe('too large')
})

test('headers kept with a page', () => {
  const lines = serializeHeaders([
    ['Content-Language', 'es'],
    ['Link', '</a>; rel="x", </b>; rel="y"'],
    ['X-Evil', 'a\r\nSet-Cookie: x=1'],
  ])
  expect(lines).toBe('Content-Language: es\nLink: </a>; rel="x", </b>; rel="y"')
  expect(parseHeaders(lines)).toEqual([
    ['Content-Language', 'es'],
    ['Link', '</a>; rel="x", </b>; rel="y"'],
  ])
  expect(parseHeaders('')).toEqual([])
  expect(parseHeaders('nonsense\n: x')).toEqual([])
})

// --- keys are made of what pages read

test('queries are read the way pages read them', () => {
  expect(parseQuery('a=1&b=2')).toEqual([
    ['a', '1'],
    ['b', '2'],
  ])
  // Names and values are decoded, and + is a space
  expect(parseQuery('%70age=7&q=a+b%20c')).toEqual([
    ['page', '7'],
    ['q', 'a b c'],
  ])
  // The first value of a name is the one pages get
  expect(parseQuery('page=3&page=2&%70age=9')).toEqual([['page', '3']])
  // What can't be decoded is not there for pages either
  expect(parseQuery('a=%E0%A4%A&b=1')).toEqual([['b', '1']])
  expect(parseQuery('')).toEqual([])
})

test('the same page has the same key however the query is written', () => {
  const base = {
    method: 'GET',
    host: 'example.com',
    path: '/blog',
    vary: [],
    query: ['page'] as string[],
  }
  const key = (rawQuery: string) => buildKey({ ...base, rawQuery })
  expect(key('%70age=7')).toBe(key('page=7'))
  expect(key('%70age=7&page=2')).toBe(key('page=7'))
  expect(key('page=3&page=2')).not.toBe(key('page=2&page=3'))
  expect(key('page=3&page=2')).toBe(key('page=3'))
  expect(key('utm=1&%75tm=2')).toBe(key(''))
  expect(key('page=a b')).toBe(key('page=a+b'))
  expect(key('page=7')).not.toBe(key(''))
})

test('messages for one visitor are recognised however they are written', () => {
  expect(hasFlash('__flash=Hi')).toBe(true)
  expect(hasFlash('a=1&__flash=')).toBe(true)
  expect(hasFlash('%5F%5Fflash=Hi')).toBe(true)
  expect(hasFlash('__fla%73h=Hi')).toBe(true)
  expect(hasFlash('flash=1&_flash=2')).toBe(false)
  expect(hasFlash('')).toBe(false)
})

test('the address and the host are part of the key as they were asked for', () => {
  const base = { method: 'GET', rawQuery: '', query: 'all' as const, vary: [] }
  expect(buildKey({ ...base, host: 'a.test', path: '/a%2Fb' })).not.toBe(
    buildKey({ ...base, host: 'a.test', path: '/a/b' })
  )
  expect(buildKey({ ...base, host: 'a.test', path: '/' })).not.toBe(
    buildKey({ ...base, host: 'b.test', path: '/' })
  )
})
