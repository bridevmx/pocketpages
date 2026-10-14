import { beforeEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { pathMatcher } from '../../../pocketpages/src/lib/pathMatch'

const g = globalThis as any
const store = new Map<string, any>()
g.$app = {
  isDev: () => false,
  store: () => ({
    get: (key: string) => store.get(key) ?? null,
    set: (key: string, value: unknown) => void store.set(key, value),
    remove: (key: string) => void store.delete(key),
    keys: () => Array.from(store.keys()),
  }),
}
g.$security = { md5: (s: string) => createHash('md5').update(s).digest('hex') }

const mod = await import('./index')
const factory = mod.default

const make = (options: Record<string, any> = {}, cache = true) =>
  factory(
    { globalApi: { pathMatcher }, dbg: () => {}, config: { cache } } as any,
    { debug: false, ...options }
  )

type Init = {
  method?: string
  path?: string
  query?: string
  headers?: Record<string, string>
  route?: any
  auth?: unknown
}

const exchange = (init: Init = {}) => {
  const headers = Object.fromEntries(
    Object.entries({ Host: 'example.com', ...init.headers }).map(([k, v]) => [
      k.toLowerCase(),
      v,
    ])
  )
  const sent = new Map<string, string[]>()
  const out = {
    html: [] as [number, string][],
    noContent: [] as number[],
    status: 200,
    written: false,
  }
  const set = (name: string, value: string) =>
    void sent.set(name.toLowerCase(), [value])
  const request: any = {
    method: init.method ?? 'GET',
    pathname: init.path ?? '/',
    auth: init.auth,
    state: {},
    header: (name: string) => headers[name.toLowerCase()] ?? '',
    event: {
      request: { url: { path: init.path ?? '/', rawQuery: init.query ?? '' } },
      response: {
        header: () => ({
          get: (name: string) => sent.get(name.toLowerCase())?.[0] ?? '',
          values: (name: string) => sent.get(name.toLowerCase()) ?? [],
        }),
      },
    },
  }
  const response: any = {
    header: (name: string, value?: string) =>
      value === undefined
        ? (sent.get(name.toLowerCase())?.[0] ?? '')
        : void set(name, value),
    addHeader: (name: string, value: string) =>
      void sent.set(name.toLowerCase(), [
        ...(sent.get(name.toLowerCase()) ?? []),
        value,
      ]),
    html: (status: number, body: string) =>
      void (out.html.push([status, body]), (out.written = true)),
    noContent: (status: number) =>
      void (out.noContent.push(status), (out.written = true)),
    sent: () => out.written,
    status: (code?: number) => {
      if (code !== undefined) out.status = code
      return out.status
    },
  }
  const route = 'route' in init ? init.route : { isStatic: false }
  return { request, response, route, sent, out, set }
}

/** A visit: the request hooks, and if the page is made, the page and its after-render hook */
const visit = (
  plugin: any,
  x: ReturnType<typeof exchange>,
  render = '<p>page</p>',
  rendering?: (api: any) => void
) => {
  const answered = plugin.onRequest({
    request: x.request,
    response: x.response,
    route: x.route,
  })
  if (answered === true) return { hit: true, api: undefined }
  const api: any = { request: x.request, response: x.response }
  plugin.onExtendContextApi({ api, route: x.route })
  rendering?.(api)
  plugin.onAfterRender({ api, content: render, route: x.route })
  return { hit: false, api }
}

beforeEach(() => store.clear())

test('options are checked', () => {
  expect(() => make({ nope: 1 })).toThrow("unknown option 'nope'")
  expect(() => make({ ttl: 0 })).toThrow('ttl must be above 0')
  expect(() => make({ vary: ['Bad Header'] })).toThrow('invalid header name')
})

test('the second visit to a page gets it from the cache', () => {
  const plugin = make()
  const first = exchange({ path: '/blog' })
  const a = visit(plugin, first, '<p>fresh</p>')
  expect(a.hit).toBe(false)
  expect(first.sent.get('x-cache')).toEqual(['MISS'])
  expect(first.sent.get('etag')?.[0]).toMatch(/^"[0-9a-f]{32}"$/)
  expect(first.sent.get('cache-control')).toEqual([
    'public, max-age=0, s-maxage=60',
  ])
  expect(first.sent.get('vary')).toEqual(['Cookie'])

  const second = exchange({ path: '/blog' })
  const b = visit(plugin, second)
  expect(b.hit).toBe(true)
  expect(second.out.html).toEqual([[200, '<p>fresh</p>']])
  expect(second.sent.get('x-cache')).toEqual(['HIT'])
  expect(second.sent.get('age')).toEqual(['0'])
  expect(second.sent.get('etag')).toEqual(first.sent.get('etag'))
  expect(second.sent.get('content-type')).toEqual(['text/html; charset=utf-8'])
})

test('browsers that have the page are told it has not changed', () => {
  const plugin = make()
  const first = exchange({ path: '/blog' })
  visit(plugin, first)
  const etag = first.sent.get('etag')![0]!
  const again = exchange({ path: '/blog', headers: { 'If-None-Match': etag } })
  expect(visit(plugin, again).hit).toBe(true)
  expect(again.out.noContent).toEqual([304])
  expect(again.out.html).toEqual([])
  const other = exchange({
    path: '/blog',
    headers: { 'If-None-Match': '"nope"' },
  })
  visit(plugin, other)
  expect(other.out.html).toHaveLength(1)
})

test('HEAD requests get the headers', () => {
  const plugin = make()
  visit(plugin, exchange({ path: '/blog' }))
  const head = exchange({ path: '/blog', method: 'HEAD' })
  expect(visit(plugin, head).hit).toBe(true)
  expect(head.out.noContent).toEqual([200])
})

test('pages are kept for the time asked, and no longer', () => {
  const plugin = make({ ttl: 30 })
  visit(plugin, exchange({ path: '/a' }))
  const realNow = Date.now
  try {
    Date.now = () => realNow() + 29_000
    expect(visit(plugin, exchange({ path: '/a' })).hit).toBe(true)
    Date.now = () => realNow() + 31_000
    expect(visit(plugin, exchange({ path: '/a' })).hit).toBe(false)
  } finally {
    Date.now = realNow
  }
})

test('visitors with cookies get their own page and are not given the shared one', () => {
  const plugin = make()
  visit(plugin, exchange({ path: '/a' }), '<p>shared</p>')
  const cookie = exchange({ path: '/a', headers: { Cookie: 'pp_session=abc' } })
  expect(visit(plugin, cookie, '<p>mine</p>').hit).toBe(false)
  expect(cookie.sent.get('x-cache')).toEqual(['BYPASS'])
  // and what was made for them is not kept for the others
  const later = exchange({ path: '/a' })
  visit(plugin, later)
  expect(later.out.html).toEqual([[200, '<p>shared</p>']])
})

test('cookies that do not matter are ignored', () => {
  const plugin = make({ ignoreCookies: ['_ga*'] })
  visit(plugin, exchange({ path: '/a' }), '<p>shared</p>')
  expect(
    visit(
      plugin,
      exchange({ path: '/a', headers: { Cookie: '_ga=1; _gat_x=2' } })
    ).hit
  ).toBe(true)
  expect(
    visit(plugin, exchange({ path: '/a', headers: { Cookie: '_ga=1; sid=2' } }))
      .hit
  ).toBe(false)
})

test('signed in visitors never get a shared page', () => {
  const plugin = make({ ignoreCookies: ['pb_auth'] })
  visit(plugin, exchange({ path: '/a' }), '<p>shared</p>')
  expect(
    visit(
      plugin,
      exchange({
        path: '/a',
        headers: { Cookie: 'pb_auth=x' },
        auth: { id: 'u1' },
      })
    ).hit
  ).toBe(false)
  expect(
    visit(
      plugin,
      exchange({ path: '/a', headers: { Authorization: 'Bearer x' } })
    ).hit
  ).toBe(false)
})

test('only pages, only GET and HEAD, only what is included', () => {
  const plugin = make({ include: ['/blog/**'], exclude: ['/blog/private/**'] })
  visit(plugin, exchange({ path: '/blog/a' }))
  expect(visit(plugin, exchange({ path: '/blog/a' })).hit).toBe(true)
  expect(visit(plugin, exchange({ path: '/other' })).hit).toBe(false)
  visit(plugin, exchange({ path: '/other' }))
  expect(visit(plugin, exchange({ path: '/other' })).hit).toBe(false)
  visit(plugin, exchange({ path: '/blog/private/x' }))
  expect(visit(plugin, exchange({ path: '/blog/private/x' })).hit).toBe(false)
  visit(plugin, exchange({ path: '/blog/a', method: 'POST' }))
  expect(visit(plugin, exchange({ path: '/blog/a', method: 'POST' })).hit).toBe(
    false
  )
  for (const route of [null, { isStatic: true }]) {
    const x = exchange({ path: '/blog/f', route })
    expect(
      plugin.onRequest({
        request: x.request,
        response: x.response,
        route: x.route,
      })
    ).toBeUndefined()
    expect(x.sent.size).toBe(0)
  }
})

test('the query string tells pages apart, or does not', () => {
  const all = make()
  visit(all, exchange({ path: '/list', query: 'page=1' }), '<p>one</p>')
  visit(all, exchange({ path: '/list', query: 'page=2' }), '<p>two</p>')
  const one = exchange({ path: '/list', query: 'page=1' })
  visit(all, one)
  expect(one.out.html).toEqual([[200, '<p>one</p>']])
  const two = exchange({ path: '/list', query: 'page=2' })
  visit(all, two)
  expect(two.out.html).toEqual([[200, '<p>two</p>']])

  store.clear()
  const some = make({ query: ['page'] })
  visit(some, exchange({ path: '/list', query: 'utm=1&page=2' }), '<p>two</p>')
  expect(
    visit(some, exchange({ path: '/list', query: 'page=2&utm=7' })).hit
  ).toBe(true)
  expect(visit(some, exchange({ path: '/list', query: 'page=3' })).hit).toBe(
    false
  )

  store.clear()
  const none = make({ query: 'none' })
  visit(none, exchange({ path: '/list', query: 'a=1' }))
  expect(visit(none, exchange({ path: '/list', query: 'b=2' })).hit).toBe(true)
})

test('hosts and headers the page varies by get their own pages', () => {
  const plugin = make({ vary: ['Accept-Language'] })
  visit(
    plugin,
    exchange({ path: '/a', headers: { 'Accept-Language': 'es' } }),
    '<p>hola</p>'
  )
  const x = exchange({ path: '/a', headers: { 'Accept-Language': 'en' } })
  expect(visit(plugin, x, '<p>hello</p>').hit).toBe(false)
  expect(x.sent.get('vary')).toEqual(['Cookie', 'Accept-Language'])
  const es = exchange({ path: '/a', headers: { 'Accept-Language': 'es' } })
  visit(plugin, es)
  expect(es.out.html).toEqual([[200, '<p>hola</p>']])
  const otherHost = exchange({
    path: '/a',
    headers: { Host: 'other.test', 'Accept-Language': 'es' },
  })
  expect(visit(plugin, otherHost).hit).toBe(false)
})

test('addresses with absurd query strings are not kept', () => {
  const plugin = make()
  const x = exchange({ path: '/a', query: 'q=' + 'a'.repeat(600) })
  expect(visit(plugin, x).hit).toBe(false)
  expect(x.sent.get('x-cache')).toEqual(['BYPASS'])
  expect(
    visit(plugin, exchange({ path: '/a', query: 'q=' + 'a'.repeat(600) })).hit
  ).toBe(false)
})

test('pages that are not for everybody are not kept', () => {
  const plugin = make()
  const nothing = (
    name: string,
    setup: (x: ReturnType<typeof exchange>, api: any) => void,
    content = '<p>x</p>'
  ) => {
    const path = `/${name}`
    const first = exchange({ path })
    visit(plugin, first, content, (api) => setup(first, api))
    expect(first.sent.get('x-cache')).toEqual(['BYPASS'])
    expect(visit(plugin, exchange({ path })).hit).toBe(false)
  }
  nothing('cookie', (x) => x.set('Set-Cookie', 'a=1'))
  nothing('private', (x) => x.set('Cache-Control', 'private'))
  nothing('nostore', (x) => x.set('Cache-Control', 'no-store'))
  nothing('type', (x) => x.set('Content-Type', 'application/json'))
  nothing('status', (x) => {
    x.out.status = 404
  })
  nothing('skip', (_x, api) => api.pageCache.skip())
  nothing('nonce', (x) => void (x.request.state.security = { nonce: 'abc' }))
  nothing('sent', (x) => void (x.out.written = true))
  nothing('large', () => {}, 'x'.repeat(300 * 1024))
})

test('a page can set its own Cache-Control and keep it', () => {
  const plugin = make()
  const x = exchange({ path: '/a' })
  visit(plugin, x, '<p>x</p>', () =>
    x.set('Cache-Control', 'public, max-age=300')
  )
  expect(x.sent.get('cache-control')).toEqual(['public, max-age=300'])
})

test('headers of a page are sent again with the copies', () => {
  const plugin = make()
  const first = exchange({ path: '/a' })
  visit(plugin, first, '<p>x</p>', () => {
    first.set('Content-Language', 'es')
    first.set('X-Other', 'no')
  })
  const second = exchange({ path: '/a' })
  visit(plugin, second)
  expect(second.sent.get('content-language')).toEqual(['es'])
  expect(second.sent.has('x-other')).toBe(false)
  // What a plugin ahead already set stays
  const third = exchange({ path: '/a' })
  third.set('Content-Language', 'en')
  visit(plugin, third)
  expect(third.sent.get('content-language')).toEqual(['en'])
})

test('pages that depend on something are made again when it changes', () => {
  const plugin = make()
  const render = (x: ReturnType<typeof exchange>, text: string) =>
    visit(plugin, x, text, (api) => api.pageCache.tag('posts', 'post:1'))
  render(exchange({ path: '/blog' }), '<p>v1</p>')
  expect(visit(plugin, exchange({ path: '/blog' })).hit).toBe(true)
  mod.purge('post:1')
  const remade = exchange({ path: '/blog' })
  expect(render(remade, '<p>v2</p>').hit).toBe(false)
  const again = exchange({ path: '/blog' })
  visit(plugin, again)
  expect(again.out.html).toEqual([[200, '<p>v2</p>']])
})

test('a page made while its data changed does not outlive the change', () => {
  const plugin = make()
  const x = exchange({ path: '/blog' })
  visit(plugin, x, '<p>old</p>', (api) => {
    api.pageCache.tag('posts')
    // The data changes while the page is being made
    mod.purge('posts')
  })
  expect(visit(plugin, exchange({ path: '/blog' })).hit).toBe(false)
})

test('tags have to be plain names', () => {
  const plugin = make()
  const x = exchange({ path: '/a' })
  expect(() =>
    visit(plugin, x, '<p>x</p>', (api) => api.pageCache.tag('bad,tag'))
  ).toThrow('Invalid page cache tag')
})

test('everything can be purged, or what is under an address', () => {
  const plugin = make()
  visit(plugin, exchange({ path: '/blog/a' }))
  visit(plugin, exchange({ path: '/about' }))
  expect(mod.purgePath('/blog')).toBe(1)
  expect(visit(plugin, exchange({ path: '/blog/a' })).hit).toBe(false)
  expect(visit(plugin, exchange({ path: '/about' })).hit).toBe(true)
  mod.purgeAll()
  expect(visit(plugin, exchange({ path: '/about' })).hit).toBe(false)
})

test('pages can say what happened', () => {
  const plugin = make()
  let status = ''
  visit(
    plugin,
    exchange({ path: '/a' }),
    '<p>x</p>',
    (api) => (status = api.pageCache.status())
  )
  expect(status).toBe('MISS')
  // Requests that never were candidates are bypassed
  const cookie = exchange({ path: '/a', headers: { Cookie: 'sid=1' } })
  expect(visit(plugin, cookie).api.pageCache.status()).toBe('BYPASS')
})

test('nothing is kept in development, unless asked', () => {
  const dev = make({}, false)
  visit(dev, exchange({ path: '/a' }))
  expect(visit(dev, exchange({ path: '/a' })).hit).toBe(false)
  const asked = make({ dev: true }, false)
  visit(asked, exchange({ path: '/a' }))
  expect(visit(asked, exchange({ path: '/a' })).hit).toBe(true)
})

test('the X-Cache header can be left out', () => {
  const plugin = make({ header: false })
  const x = exchange({ path: '/a' })
  visit(plugin, x)
  expect(x.sent.has('x-cache')).toBe(false)
  const y = exchange({ path: '/a' })
  visit(plugin, y)
  expect(y.sent.has('x-cache')).toBe(false)
})

test('browsers can be allowed to keep pages', () => {
  const plugin = make({ ttl: 120, browserMaxAge: 30 })
  const x = exchange({ path: '/a' })
  visit(plugin, x)
  expect(x.sent.get('cache-control')).toEqual([
    'public, max-age=30, s-maxage=120',
  ])
})
