import { beforeEach, expect, test } from 'bun:test'
import { installGlobals, makeEvent, route, store } from './testkit'

// The modules under test read PocketBase's globals when they load
const { MiddlewareHandler } = await import('../handlers/MiddlewareHandler')
const { publishCache } = await import('./cache')

/**
 * Drives MiddlewareHandler with a fake PocketBase event, to check which requests it
 * lets through untouched, which ones it serves, and what plugins get to see.
 */

const configure = (plugins: any[], routes: any[]) =>
  publishCache({ routes, config: { plugins, debug: false, cache: true } })

beforeEach(() => {
  installGlobals()
  store.clear()
})

const renderer =
  (log: any[] = []) =>
  () => ({
    name: 'renderer',
    handles: () => true,
    onRender: ({ api }: any) => {
      log.push({ params: { ...api.params } })
      return `rendered ${JSON.stringify(api.params)}`
    },
  })

test('requests no route claims go straight back to PocketBase', () => {
  let built = 0
  configure(
    [
      () => {
        built++
        return { name: 'quiet', onExtendContextApi: () => {} }
      },
    ],
    [route('index', { isStatic: false })]
  )
  for (const url of [
    '/api/health',
    '/_/assets/app.js',
    '/api/collections/users/records?page=1',
  ]) {
    const { e, seen } = makeEvent(url)
    MiddlewareHandler(e)
    expect(seen.next).toBe(1)
    expect(seen.html).toEqual([])
    expect(seen.files).toEqual([])
  }
  // Plugins are set up once, not for every request
  expect(built).toBe(1)
})

test('plugins that want every request still get it, along with the route', () => {
  const seen: any[] = []
  configure(
    [
      () => ({
        name: 'spy',
        onRequest: ({ request, route }: any) => {
          seen.push({
            url: request.method,
            route: route === null ? null : route?.relativePath,
          })
        },
      }),
    ],
    [route('logo.png')]
  )
  const hit = makeEvent('/logo.png')
  MiddlewareHandler(hit.e)
  expect(hit.seen.files).toEqual(['logo.png'])
  const miss = makeEvent('/api/health')
  MiddlewareHandler(miss.e)
  expect(miss.seen.next).toBe(1)
  expect(seen).toEqual([
    { url: 'GET', route: 'logo.png' },
    { url: 'GET', route: null },
  ])
})

test('static files are served, and fingerprinted ones are cached for good', () => {
  configure([() => ({ name: 'none' })], [route('assets/app.css')])

  const plain = makeEvent('/assets/app.css?v=3')
  MiddlewareHandler(plain.e)
  expect(plain.seen.files).toEqual(['app.css'])
  expect(plain.seen.headers['Cache-Control']).toBeUndefined()

  const hashed = makeEvent('/assets/app.abc123.css')
  MiddlewareHandler(hashed.e)
  expect(hashed.seen.files).toEqual(['app.css'])
  expect(hashed.seen.headers['Cache-Control']).toBe(
    'public, max-age=31536000, immutable'
  )

  const stale = makeEvent('/assets/app.0000.css')
  MiddlewareHandler(stale.e)
  expect(stale.seen.files).toEqual([])
  expect(stale.seen.next).toBe(1)
})

test('a plugin can rewrite the URL before routing', () => {
  configure(
    [
      (config: any) => ({
        name: 'rewrite',
        onRequest: ({ request }: any) => {
          if (request.url.pathname === '/old') {
            request.url = config.globalApi.url('/new')
          }
        },
      }),
    ],
    [route('new'), route('old')]
  )
  const { e, seen } = makeEvent('/old')
  MiddlewareHandler(e)
  expect(seen.files).toEqual(['new'])
})

test('pages get the query string and the values of [param] segments as params', () => {
  const log: any[] = []
  configure(
    [renderer(log)],
    [
      route('posts/[id]', {
        isStatic: false,
        segments: [
          { nodeName: 'posts' },
          { nodeName: '[id]', paramName: 'id' },
        ],
      }),
    ]
  )
  const { e, seen } = makeEvent('/posts/42?page=2&draft=true&id=overridden')
  MiddlewareHandler(e)
  expect(seen.html).toEqual([
    [200, 'rendered {"page":2,"draft":true,"id":"42"}'],
  ])
  expect(log).toHaveLength(1)
})

test('a page is rendered, and only requests it matches are touched', () => {
  const log: any[] = []
  configure([renderer(log)], [route('about', { isStatic: false })])
  const hit = makeEvent('/about')
  MiddlewareHandler(hit.e)
  expect(hit.seen.html[0]![0]).toBe(200)
  const miss = makeEvent('/elsewhere')
  MiddlewareHandler(miss.e)
  expect(miss.seen.next).toBe(1)
  expect(log).toHaveLength(1)
})

test('republishing the routes makes the next request see the new ones', () => {
  configure([() => ({ name: 'none' })], [route('a')])
  const first = makeEvent('/a')
  MiddlewareHandler(first.e)
  expect(first.seen.files).toEqual(['a'])

  configure([() => ({ name: 'none' })], [route('b')])
  const second = makeEvent('/a')
  MiddlewareHandler(second.e)
  expect(second.seen.next).toBe(1)
  const third = makeEvent('/b')
  MiddlewareHandler(third.e)
  expect(third.seen.files).toEqual(['b'])
})
