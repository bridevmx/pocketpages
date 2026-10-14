import { afterAll, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { installGlobals, makeEvent, route, store } from './testkit'

// The modules under test read PocketBase's globals when they load
const { MiddlewareHandler } = await import('../handlers/MiddlewareHandler')
const { publishCache } = await import('./cache')

const g = globalThis as any

// Loaders written to disk by the tests, removed when they are done
const tempDirs: string[] = []
const tempDir = (prefix: string) => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

const configure = (plugins: any[], routes: any[], debug = false) =>
  publishCache({ routes, config: { plugins, debug, cache: true } })

beforeEach(() => {
  installGlobals()
  store.clear()
})

const page = (relativePath: string, extra: Record<string, any> = {}) =>
  route(relativePath, { isStatic: false, ...extra })

/** Renders every page as `rendered:<path>` */
const renderer = (render?: (ctx: any) => string) => () => ({
  name: 'renderer',
  handles: () => true,
  onRender: (ctx: any) =>
    ctx.filePath.endsWith('+layout.html')
      ? `<layout>${ctx.api.slot}</layout>`
      : (render?.(ctx) ?? `rendered:${ctx.route.relativePath}`),
})

// --- onRequest

test('a plugin that answers a request keeps it from going anywhere else', () => {
  const called: string[] = []
  configure(
    [
      () => ({
        name: 'first',
        onRequest: ({ request, response }: any) => {
          called.push('first')
          if (request.url.pathname === '/robots.txt') {
            response.text(200, 'User-agent: *')
            return true
          }
        },
      }),
      () => ({
        name: 'second',
        onRequest: () => {
          called.push('second')
        },
      }),
    ],
    [page('index')]
  )

  const answered = makeEvent('/robots.txt')
  MiddlewareHandler(answered.e)
  expect(answered.seen.text).toEqual([[200, 'User-agent: *']])
  expect(answered.seen.next).toBe(0)
  expect(called).toEqual(['first'])

  called.length = 0
  const other = makeEvent('/api/health')
  MiddlewareHandler(other.e)
  expect(other.seen.next).toBe(1)
  expect(called).toEqual(['first', 'second'])
})

test('only `true` counts as an answer', () => {
  const answers = [undefined, false, 1, 'yes', null]
  for (const answer of answers) {
    configure(
      [() => ({ name: 'maybe', onRequest: () => answer }), renderer()],
      [page('index')]
    )
    const { e, seen } = makeEvent('/')
    MiddlewareHandler(e)
    expect(seen.html).toEqual([[200, 'rendered:index']])
    expect(seen.next).toBe(0)
  }
})

test('plugins after one that rewrote the URL see the route of the new one', () => {
  const seen: any[] = []
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
      () => ({
        name: 'spy',
        onRequest: ({ request, route }: any) => {
          seen.push([request.url.pathname, route?.relativePath ?? route])
        },
      }),
    ],
    [route('new'), route('old')]
  )
  const { e } = makeEvent('/old')
  MiddlewareHandler(e)
  expect(seen).toEqual([['/new', 'new']])
})

test('a plugin can leave things for the page in request.state', () => {
  let pageState: any
  configure(
    [
      () => ({
        name: 'locale',
        onRequest: ({ request }: any) => {
          request.state.locale = 'es'
        },
      }),
      renderer(({ api }) => {
        pageState = { ...api.request.state }
        return 'ok'
      }),
    ],
    [page('index')]
  )
  const first = makeEvent('/')
  MiddlewareHandler(first.e)
  expect(pageState).toEqual({ locale: 'es' })
})

test('request.state starts empty for every request', () => {
  const states: any[] = []
  configure(
    [
      () => ({
        name: 'count',
        onRequest: ({ request }: any) => {
          states.push({ ...request.state })
          request.state.seen = true
        },
      }),
    ],
    [page('index')]
  )
  MiddlewareHandler(makeEvent('/').e)
  MiddlewareHandler(makeEvent('/').e)
  expect(states).toEqual([{}, {}])
})

// --- errors

test('PocketBase errors thrown by a plugin answer with their status', () => {
  configure(
    [
      () => ({
        name: 'guard',
        onRequest: ({ request, route }: any) => {
          if (request.url.pathname === '/admin') {
            throw new g.ForbiddenError('not for you')
          }
        },
      }),
      renderer(),
    ],
    [page('admin'), page('index')]
  )

  const { e, seen } = makeEvent('/admin')
  MiddlewareHandler(e)
  // The message of the error is not for visitors, unless debugging
  expect(seen.html).toEqual([[403, 'Forbidden']])
  expect(seen.next).toBe(0)

  const ok = makeEvent('/')
  MiddlewareHandler(ok.e)
  expect(ok.seen.html).toEqual([[200, 'rendered:index']])
})

test('debugging shows the message of the error', () => {
  configure(
    [
      () => ({
        name: 'guard',
        onRequest: () => {
          throw new g.NotFoundError('no such thing')
        },
      }),
      renderer(),
    ],
    [page('index')],
    true
  )
  const { e, seen } = makeEvent('/')
  MiddlewareHandler(e)
  expect(seen.html).toEqual([[404, 'no such thing']])
})

test('errors of requests that are not for a page are answered like PocketBase would', () => {
  configure(
    [
      () => ({
        name: 'limit',
        onRequest: () => {
          throw new g.TooManyRequestsError('slow down')
        },
      }),
    ],
    [page('index')]
  )
  const { e, seen } = makeEvent('/api/collections/posts/records')
  MiddlewareHandler(e)
  expect(seen.json).toEqual([
    [429, { status: 429, message: 'Too Many Requests', data: {} }],
  ])
  expect(seen.html).toEqual([])
  expect(seen.next).toBe(0)
})

test('clients that ask for JSON get JSON, whatever the route', () => {
  configure(
    [
      () => ({
        name: 'limit',
        onRequest: () => {
          throw new g.UnauthorizedError()
        },
      }),
      renderer(),
    ],
    [page('index')]
  )
  const asJson = makeEvent('/', 'GET', {
    headers: { Accept: 'application/json' },
  })
  MiddlewareHandler(asJson.e)
  expect(asJson.seen.json).toEqual([
    [401, { status: 401, message: 'Unauthorized', data: {} }],
  ])

  const browser = makeEvent('/', 'GET', {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/json;q=0.9',
    },
  })
  MiddlewareHandler(browser.e)
  expect(browser.seen.html).toEqual([[401, 'Unauthorized']])
})

test('anything else that is thrown is an internal error', () => {
  configure(
    [
      renderer(() => {
        throw new Error('boom')
      }),
    ],
    [page('index')]
  )
  const { e, seen } = makeEvent('/')
  MiddlewareHandler(e)
  expect(seen.html).toHaveLength(1)
  expect(seen.html[0]![0]).toBe(500)
  expect(seen.html[0]![1]).toContain('Internal Server Error')
  // Nothing about the error leaks
  expect(seen.html[0]![1]).not.toContain('boom')
})

test('errors of the PocketBase SDK are internal errors, whatever their status', () => {
  class ClientResponseError extends Error {
    status = 404
  }
  configure(
    [
      renderer(() => {
        throw new ClientResponseError('record not found')
      }),
    ],
    [page('index')]
  )
  const { e, seen } = makeEvent('/')
  MiddlewareHandler(e)
  expect(seen.html[0]![0]).toBe(500)
})

test('debugging shows where an internal error comes from', () => {
  configure(
    [
      renderer(() => {
        throw new Error('boom')
      }),
    ],
    [page('index')],
    true
  )
  const { e, seen } = makeEvent('/')
  MiddlewareHandler(e)
  expect(seen.html[0]![0]).toBe(500)
  expect(seen.html[0]![1]).toContain('PocketPages Error')
  expect(seen.html[0]![1]).toContain('boom')
})

test('onError hooks get to answer first, in order', () => {
  const contexts: any[] = []
  configure(
    [
      () => ({
        name: 'decline',
        onError: (ctx: any) => {
          contexts.push(['decline', ctx.status])
        },
      }),
      () => ({
        name: 'pretty',
        onError: ({ status, response, error, route, api, request }: any) => {
          contexts.push([
            'pretty',
            status,
            route?.relativePath,
            !!api,
            request.method,
          ])
          response.html(status, `<h1>Oops ${error.message}</h1>`)
          return true
        },
      }),
      () => ({
        name: 'never',
        onError: () => {
          contexts.push(['never'])
        },
      }),
      renderer(() => {
        throw new g.NotFoundError('gone')
      }),
    ],
    [page('index')]
  )
  const { e, seen } = makeEvent('/')
  MiddlewareHandler(e)
  expect(seen.html).toEqual([[404, '<h1>Oops gone</h1>']])
  expect(contexts).toEqual([
    ['decline', 404],
    ['pretty', 404, 'index', true, 'GET'],
  ])
})

test('onError hooks also hear about errors from plugins, without a page context', () => {
  const contexts: any[] = []
  configure(
    [
      () => ({
        name: 'guard',
        onRequest: () => {
          throw new g.ForbiddenError()
        },
      }),
      () => ({
        name: 'listen',
        onError: ({ status, route, api }: any) => {
          contexts.push([
            status,
            route === null ? null : route.relativePath,
            api,
          ])
        },
      }),
    ],
    [page('index')]
  )
  MiddlewareHandler(makeEvent('/').e)
  MiddlewareHandler(makeEvent('/elsewhere').e)
  expect(contexts).toEqual([
    [403, 'index', undefined],
    [403, null, undefined],
  ])
})

test('an onError hook that fails does not get in the way', () => {
  configure(
    [
      () => ({
        name: 'broken',
        onError: () => {
          throw new Error('hook bug')
        },
      }),
      renderer(() => {
        throw new g.BadRequestError('bad')
      }),
    ],
    [page('index')]
  )
  const { e, seen } = makeEvent('/')
  MiddlewareHandler(e)
  expect(seen.html).toEqual([[400, 'Bad Request']])
})

test('what PocketBase does further down the chain is not for PocketPages to handle', () => {
  configure([() => ({ name: 'quiet', onError: () => true })], [page('index')])
  const { e } = makeEvent('/api/health')
  e.next = () => {
    throw new g.NotFoundError('from PocketBase')
  }
  expect(() => MiddlewareHandler(e)).toThrow()
})

test('plugins with hooks other than onRequest keep the fast path', () => {
  let called = 0
  configure(
    [
      () => ({
        name: 'quiet',
        onError: () => {
          called++
        },
        onAfterRender: () => {
          called++
        },
      }),
    ],
    [page('index')]
  )
  const { e, seen } = makeEvent('/api/health')
  MiddlewareHandler(e)
  expect(seen.next).toBe(1)
  expect(called).toBe(0)
})

// --- onAfterRender

test('onAfterRender sees the page with its layouts and can replace it', () => {
  const seen: string[] = []
  configure(
    [
      renderer(),
      () => ({
        name: 'banner',
        onAfterRender: ({ content, route }: any) => {
          seen.push(content)
          return content.replace('rendered', `[${route.relativePath}]`)
        },
      }),
      () => ({
        name: 'after-banner',
        onAfterRender: ({ content }: any) => {
          seen.push(content)
          return `${content}!`
        },
      }),
    ],
    [page('blog/post', { layouts: ['/hooks/pages/+layout.html'] })]
  )
  const { e, seen: out } = makeEvent('/blog/post')
  MiddlewareHandler(e)
  expect(seen).toEqual([
    '<layout>rendered:blog/post</layout>',
    '<layout>[blog/post]:blog/post</layout>',
  ])
  expect(out.html).toEqual([[200, '<layout>[blog/post]:blog/post</layout>!']])
})

test('onAfterRender can leave the page alone', () => {
  configure(
    [
      renderer(),
      () => ({ name: 'nothing', onAfterRender: () => undefined }),
      () => ({ name: 'not a string', onAfterRender: () => 42 as any }),
    ],
    [page('index')]
  )
  const { e, seen } = makeEvent('/')
  MiddlewareHandler(e)
  expect(seen.html).toEqual([[200, 'rendered:index']])
})

test('onAfterRender is for web pages, not for JSON', () => {
  let called = 0
  configure(
    [
      renderer(() => '{"hello":"world"}'),
      () => ({
        name: 'banner',
        onAfterRender: () => {
          called++
        },
      }),
    ],
    [page('index')]
  )
  const { e, seen } = makeEvent('/')
  MiddlewareHandler(e)
  expect(seen.json).toEqual([[200, { hello: 'world' }]])
  expect(called).toBe(0)
})

// --- the response

test('beforeSend callbacks run once, before anything is sent', () => {
  const order: string[] = []
  configure(
    [
      () => ({
        name: 'early',
        onRequest: ({ response }: any) => {
          response.beforeSend(() => {
            order.push(`first (sent: ${response.sent()})`)
            response.cookie('a', '1')
          })
        },
      }),
      renderer(({ api }) => {
        api.response.beforeSend(() => {
          order.push('second')
          api.response.header('X-Late', 'yes')
        })
        return 'page'
      }),
    ],
    [page('index')]
  )
  const { e, seen } = makeEvent('/')
  MiddlewareHandler(e)
  expect(order).toEqual(['first (sent: false)', 'second'])
  expect(seen.html).toEqual([[200, 'page']])
  expect(seen.headers['X-Late']).toBe('yes')
  expect(seen.values('Set-Cookie')).toEqual(['a=1; Path=/'])
})

test('beforeSend callbacks also run for requests that go on to PocketBase', () => {
  const order: string[] = []
  configure(
    [
      () => ({
        name: 'headers',
        onRequest: ({ response }: any) => {
          response.beforeSend(() => order.push('callback'))
        },
      }),
    ],
    [page('index')]
  )
  const { e, seen } = makeEvent('/api/health')
  const next = e.next
  e.next = () => {
    order.push('next')
    next()
  }
  MiddlewareHandler(e)
  expect(order).toEqual(['callback', 'next'])
  expect(seen.next).toBe(1)
})

test('a beforeSend callback that sends the response does not run the others twice', () => {
  let runs = 0
  configure(
    [
      () => ({
        name: 'early',
        onRequest: ({ response }: any) => {
          response.beforeSend(() => {
            runs++
            response.html(200, 'from the callback')
          })
          response.beforeSend(() => {
            runs++
          })
        },
      }),
    ],
    [page('index')]
  )
  const { e, seen } = makeEvent('/api/health')
  MiddlewareHandler(e)
  expect(runs).toBe(2)
  expect(seen.html).toEqual([[200, 'from the callback']])
  // The response is sent, PocketBase has nothing left to do
  expect(seen.next).toBe(0)
})

test('cookies set during a request are all sent, and setting one again replaces it', () => {
  configure(
    [
      renderer(({ api }) => {
        api.response.cookie('session', 'one')
        api.response.cookie('theme', 'dark', { maxAge: 60 })
        api.response.cookie('session', 'two')
        api.response.cookie('prefs', { a: 1 })
        return 'page'
      }),
    ],
    [page('index')]
  )
  const { e, seen } = makeEvent('/')
  MiddlewareHandler(e)
  expect(seen.values('Set-Cookie')).toEqual([
    'theme=dark; Max-Age=60; Path=/',
    'session=two; Path=/',
    'prefs=%7B%22a%22%3A1%7D; Path=/',
  ])
})

test('headers that can be sent more than once can be added', () => {
  configure(
    [
      renderer(({ api }) => {
        api.response.addHeader('Vary', 'Accept-Language')
        api.response.addHeader('Vary', 'Cookie')
        api.response.header('X-One', 'a')
        api.response.header('X-One', 'b')
        return 'page'
      }),
    ],
    [page('index')]
  )
  const { e, seen } = makeEvent('/')
  MiddlewareHandler(e)
  expect(seen.values('Vary')).toEqual(['Accept-Language', 'Cookie'])
  expect(seen.values('X-One')).toEqual(['b'])
})

test('responses can be plain text or have no content', () => {
  configure(
    [
      () => ({
        name: 'answers',
        onRequest: ({ request, response }: any) => {
          if (request.url.pathname === '/text') {
            response.text(201, 'created')
            return true
          }
          if (request.url.pathname === '/gone') {
            response.noContent()
            return true
          }
          if (request.url.pathname === '/same') {
            response.noContent(304)
            return true
          }
        },
      }),
    ],
    []
  )
  const text = makeEvent('/text')
  MiddlewareHandler(text.e)
  expect(text.seen.text).toEqual([[201, 'created']])
  const gone = makeEvent('/gone')
  MiddlewareHandler(gone.e)
  expect(gone.seen.noContent).toEqual([204])
  const same = makeEvent('/same')
  MiddlewareHandler(same.e)
  expect(same.seen.noContent).toEqual([304])
})

test('response.sent() tells whether something was written', () => {
  const sent: boolean[] = []
  configure(
    [
      renderer(({ api }) => {
        sent.push(api.response.sent())
        api.redirect('/elsewhere')
        sent.push(api.response.sent())
        return 'page'
      }),
    ],
    [page('index')]
  )
  const { e, seen } = makeEvent('/')
  MiddlewareHandler(e)
  expect(sent).toEqual([false, true])
  expect(seen.redirects[0]![0]).toBe(302)
})

test('a template cannot be stopped by a redirect, but what it made is not sent', () => {
  const rendered: string[] = []
  const after: string[] = []
  configure(
    [
      renderer(({ api }) => {
        rendered.push('page')
        api.redirect('/elsewhere')
        return 'the rest of the page'
      }),
      () => ({
        name: 'after',
        onAfterRender: () => {
          after.push('after render')
        },
      }),
    ],
    [page('index')]
  )
  const { e, seen } = makeEvent('/')
  MiddlewareHandler(e)
  expect(rendered).toEqual(['page'])
  expect(seen.redirects).toHaveLength(1)
  expect(seen.html).toEqual([])
  expect(after).toEqual([])
})

// --- loaders

test('loaders are picked by the method plugins set on the request', () => {
  const dir = tempDir('pp-loaders-')
  const write = (name: string, source: string) => {
    const file = path.join(dir, name)
    writeFileSync(file, source)
    return file
  }
  const post = write('+post.js', `module.exports = () => ({ via: 'post' })`)
  const del = write('+delete.js', `module.exports = () => ({ via: 'delete' })`)

  configure(
    [
      () => ({
        name: 'method-override',
        onRequest: ({ request }: any) => {
          if (request.method === 'POST' && request.url.query._method) {
            request.method = String(request.url.query._method).toUpperCase()
          }
        },
      }),
      renderer(({ api }) => `via ${api.data.via}`),
    ],
    [page('item', { loaders: { post, delete: del } })]
  )

  const plain = makeEvent('/item', 'POST')
  MiddlewareHandler(plain.e)
  expect(plain.seen.html).toEqual([[200, 'via post']])

  const overridden = makeEvent('/item?_method=delete', 'POST')
  MiddlewareHandler(overridden.e)
  expect(overridden.seen.html).toEqual([[200, 'via delete']])
})

test('requests know where they come from and whether it was secure', () => {
  const seen: any[] = []
  configure(
    [
      () => ({
        name: 'spy',
        onRequest: ({ request }: any) => {
          seen.push([request.ip, request.secure])
        },
      }),
    ],
    []
  )
  MiddlewareHandler(makeEvent('/a', 'GET', { ip: '198.51.100.7' }).e)
  MiddlewareHandler(
    makeEvent('/b', 'GET', { headers: { 'X-Forwarded-Proto': 'https' } }).e
  )
  MiddlewareHandler(
    makeEvent('/c', 'GET', { headers: { 'X-Forwarded-Proto': 'http' } }).e
  )
  const direct = makeEvent('/d')
  direct.e.request.tls = {}
  MiddlewareHandler(direct.e)
  expect(seen).toEqual([
    ['198.51.100.7', false],
    ['203.0.113.9', true],
    ['203.0.113.9', false],
    ['203.0.113.9', true],
  ])
})

test('request.pathname is the path, wherever the URL is rewritten to', () => {
  const seen: string[] = []
  configure(
    [
      (config: any) => ({
        name: 'rewrite',
        onRequest: ({ request }: any) => {
          seen.push(request.pathname)
          if (request.pathname === '/old') {
            request.url = config.globalApi.url('/new?x=1')
          }
          seen.push(request.pathname)
        },
      }),
    ],
    [route('new'), route('old')]
  )
  MiddlewareHandler(makeEvent('/old?a=1#top').e)
  MiddlewareHandler(makeEvent('/plain/path').e)
  MiddlewareHandler(makeEvent('http://example.test/absolute/url?q=1').e)
  expect(seen).toEqual([
    '/old',
    '/new',
    '/plain/path',
    '/plain/path',
    '/absolute/url',
    '/absolute/url',
  ])
})

test('pages can change the status they are sent with', () => {
  const statuses: number[] = []
  configure(
    [
      renderer(({ api }) => {
        statuses.push(api.response.status())
        statuses.push(api.response.status(422))
        statuses.push(api.response.status())
        return api.route?.relativePath === 'json' ? '{"ok":false}' : 'invalid'
      }),
    ],
    [page('form'), page('json')]
  )
  const html = makeEvent('/form')
  MiddlewareHandler(html.e)
  expect(html.seen.html).toEqual([[422, 'invalid']])
  expect(statuses).toEqual([200, 422, 422])
})

test('the status of a page that is JSON follows too', () => {
  configure(
    [
      renderer(({ api }) => {
        api.response.status(409)
        return '{"ok":false}'
      }),
    ],
    [page('json')]
  )
  const { e, seen } = makeEvent('/json')
  MiddlewareHandler(e)
  expect(seen.json).toEqual([[409, { ok: false }]])
})

const writeLoader = (name: string, source: string) => {
  const dir = tempDir('pp-redirect-')
  const file = path.join(dir, name)
  writeFileSync(file, source)
  return file
}

test('a loader that redirects is the last word: the page is not rendered', () => {
  const rendered: string[] = []
  const load = writeLoader(
    '+load.js',
    `module.exports = ({ redirect }) => { redirect('/thanks'); return { form: undefined } }`
  )
  const post = writeLoader(
    '+post.js',
    `globalThis.__postRan = true; module.exports = () => ({})`
  )
  g.__postRan = false
  configure(
    [
      renderer(() => {
        rendered.push('page')
        return 'page'
      }),
    ],
    [page('contact', { loaders: { load, post } })]
  )
  const { e, seen } = makeEvent('/contact', 'POST')
  MiddlewareHandler(e)
  expect(seen.redirects).toEqual([[302, '/thanks?__flash=']])
  expect(rendered).toEqual([])
  expect(seen.html).toEqual([])
  // No more loaders either
  expect(g.__postRan).toBe(false)
})

test('a middleware that redirects keeps everything after it from running', () => {
  const rendered: string[] = []
  const guard = writeLoader(
    '+middleware.js',
    `module.exports = ({ redirect }) => { redirect('/login'); return {} }`
  )
  configure(
    [
      renderer(() => {
        rendered.push('page')
        return 'page'
      }),
    ],
    [page('secret', { middlewares: [guard] })]
  )
  const { e, seen } = makeEvent('/secret')
  MiddlewareHandler(e)
  expect(seen.redirects).toHaveLength(1)
  expect(rendered).toEqual([])
})

test('other responses from a loader do not stop the page', () => {
  const rendered: string[] = []
  const load = writeLoader(
    '+load.js',
    `module.exports = ({ response }) => { response.header('X-From-Loader', '1'); return {} }`
  )
  configure(
    [
      renderer(() => {
        rendered.push('page')
        return 'page'
      }),
    ],
    [page('index', { loaders: { load } })]
  )
  const { e, seen } = makeEvent('/')
  MiddlewareHandler(e)
  expect(rendered).toEqual(['page'])
  expect(seen.headers['X-From-Loader']).toBe('1')
})
