import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const g = globalThis as any
const root = mkdtempSync(path.join(tmpdir(), 'pp-i18n-'))
g.__hooks = root
g.$filepath = { join: (...parts: string[]) => path.join(...parts) }
g.$os = { readFile: (file: string) => readFileSync(file) }
g.toString = (bytes: Uint8Array) => Buffer.from(bytes).toString('utf8')
g.$app = {
  isDev: () => false,
  settings: () => ({ meta: { appURL: 'https://example.com/' } }),
}

const write = (dir: string, locale: string, tree: unknown) => {
  mkdirSync(path.join(root, dir), { recursive: true })
  writeFileSync(path.join(root, dir, `${locale}.json`), JSON.stringify(tree))
}

write('locales', 'en', {
  title: 'Hello',
  nav: { home: 'Home' },
  welcome: 'Welcome, {name}!',
  items: { one: '{count} item', other: '{count} items' },
  bold: 'Hi <b>{name}</b>',
  onlyEnglish: 'English only',
})
write('locales', 'es', {
  title: 'Hola',
  nav: { home: 'Inicio' },
  welcome: 'Bienvenido, {name}!',
  items: { one: '{count} elemento', other: '{count} elementos' },
  _format: { number: { group: ' ' } },
})
write('locales', 'pt-BR', { title: 'Olá' })

const { default: factory } = await import('./index')
const globalApi: any = {
  url: (p: string) => ({ pathname: p.split('?')[0], href: p }),
}

const make = (options: Record<string, any> = {}) =>
  factory({ globalApi, dbg: () => {}, config: { cache: false } } as any, {
    debug: false,
    locales: ['en', 'es', 'pt-BR'],
    ...options,
  })

type Init = {
  path?: string
  query?: string
  method?: string
  headers?: Record<string, string>
  cookies?: Record<string, string>
  route?: any
}

const exchange = (init: Init = {}) => {
  const headers = Object.fromEntries(
    Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])
  )
  const sent = new Map<string, string[]>()
  const cookies: any[] = []
  const redirects: [string, number][] = []
  const original = init.path ?? '/'
  const request: any = {
    method: init.method ?? 'GET',
    pathname: original,
    secure: false,
    state: {},
    header: (name: string) => headers[name.toLowerCase()] ?? '',
    cookies: (name?: string) => (name ? init.cookies?.[name] : init.cookies),
    event: { request: { url: { path: original, rawQuery: init.query ?? '' } } },
  }
  Object.defineProperty(request, 'url', {
    get: () => ({ pathname: request.pathname }),
    set: (value: any) => {
      request.pathname = value.pathname
      request.rewrittenTo = value.href
    },
  })
  const response: any = {
    header: (name: string, value: string) => void sent.set(name, [value]),
    addHeader: (name: string, value: string) =>
      void sent.set(name, [...(sent.get(name) ?? []), value]),
    cookie: (name: string, value: string, options: any) =>
      void cookies.push({ name, value, options }),
    redirect: (to: string, status: number) => void redirects.push([to, status]),
  }
  const route = 'route' in init ? init.route : { isStatic: false }
  return { request, response, route, sent, cookies, redirects }
}

const run = (plugin: any, x: ReturnType<typeof exchange>) => {
  const answered = plugin.onRequest({
    request: x.request,
    response: x.response,
    route: x.route,
  })
  if (answered === true) return undefined
  const api: any = { request: x.request, response: x.response }
  plugin.onExtendContextApi({ api, route: x.route })
  return api
}

test('options are checked', () => {
  expect(() => make({ typo: 1 })).toThrow("unknown option 'typo'")
  expect(() => make({ locales: [] })).toThrow('at least one language')
  expect(() => make({ locales: ['english!'] })).toThrow('invalid locale')
  expect(() => make({ defaultLocale: 'fr' })).toThrow(
    'defaultLocale must be one of'
  )
  expect(() => make({ strategy: 'path' })).toThrow("unknown strategy 'path'")
  expect(() => make({ cookieName: 'bad name' })).toThrow('invalid cookie name')
})

test('pages without a prefix are in the default language', () => {
  const x = exchange({ path: '/about' })
  const api = run(make(), x)
  expect(api.locale).toBe('en')
  expect(api.t('title')).toBe('Hello')
  expect(x.request.pathname).toBe('/about')
  expect(x.request.rewrittenTo).toBeUndefined()
  expect(x.sent.get('Content-Language')).toEqual(['en'])
})

test('a prefix is the language, and is taken off the address', () => {
  const x = exchange({ path: '/es/about', query: 'a=1' })
  const api = run(make(), x)
  expect(api.locale).toBe('es')
  expect(api.t('title')).toBe('Hola')
  expect(x.request.pathname).toBe('/about')
  expect(x.request.rewrittenTo).toBe('/about?a=1')
  expect(x.sent.get('Content-Language')).toEqual(['es'])
  expect(x.cookies).toEqual([])

  const home = exchange({ path: '/es' })
  run(make(), home)
  expect(home.request.pathname).toBe('/')
  const regional = exchange({ path: '/pt-br/sobre' })
  expect(run(make(), regional).locale).toBe('pt-BR')
})

test('things that are not languages are not taken off', () => {
  const x = exchange({ path: '/espanol/about' })
  expect(run(make(), x).locale).toBe('en')
  expect(x.request.pathname).toBe('/espanol/about')
})

test('the default language has one address', () => {
  const x = exchange({ path: '/en/about', query: 'a=1' })
  const answered = make().onRequest!({
    request: x.request,
    response: x.response,
    route: x.route,
  })
  expect(answered).toBe(true)
  expect(x.redirects).toEqual([['/about?a=1', 301]])

  const post = exchange({ path: '/en/about', method: 'POST' })
  make().onRequest!({
    request: post.request,
    response: post.response,
    route: post.route,
  })
  expect(post.redirects).toEqual([])
  expect(post.request.pathname).toBe('/about')

  const kept = exchange({ path: '/en/about' })
  make({ redirectDefaultPrefix: false }).onRequest!({
    request: kept.request,
    response: kept.response,
    route: kept.route,
  })
  expect(kept.redirects).toEqual([])
})

test('every language can have a prefix', () => {
  const plugin = make({ prefixDefault: true })
  const bare = exchange({
    path: '/about',
    headers: { 'Accept-Language': 'es-MX,es;q=0.9' },
  })
  expect(
    plugin.onRequest!({
      request: bare.request,
      response: bare.response,
      route: bare.route,
    })
  ).toBe(true)
  expect(bare.redirects).toEqual([['/es/about', 302]])
  expect(bare.sent.get('Vary')).toEqual(['Accept-Language', 'Cookie'])

  const nothing = exchange({ path: '/about' })
  plugin.onRequest!({
    request: nothing.request,
    response: nothing.response,
    route: nothing.route,
  })
  expect(nothing.redirects).toEqual([['/en/about', 302]])

  const cookie = exchange({
    path: '/',
    cookies: { pp_lang: 'pt-BR' },
    headers: { 'Accept-Language': 'es' },
  })
  plugin.onRequest!({
    request: cookie.request,
    response: cookie.response,
    route: cookie.route,
  })
  expect(cookie.redirects).toEqual([['/pt-BR', 302]])

  const prefixed = exchange({ path: '/en/about' })
  const api = run(plugin, prefixed)
  expect(api.locale).toBe('en')
  expect(prefixed.redirects).toEqual([])
  expect(api.localePath('/contact')).toBe('/en/contact')
  expect(prefixed.cookies).toHaveLength(1)
})

test('first time visitors can be sent to their language', () => {
  const plugin = make({ autoRedirect: true })
  const spanish = exchange({
    path: '/about',
    headers: { 'Accept-Language': 'es' },
  })
  plugin.onRequest!({
    request: spanish.request,
    response: spanish.response,
    route: spanish.route,
  })
  expect(spanish.redirects).toEqual([['/es/about', 302]])

  const english = exchange({
    path: '/about',
    headers: { 'Accept-Language': 'en-US,en' },
  })
  plugin.onRequest!({
    request: english.request,
    response: english.response,
    route: english.route,
  })
  expect(english.redirects).toEqual([])

  const returning = exchange({
    path: '/about',
    headers: { 'Accept-Language': 'es' },
    cookies: { pp_lang: 'en' },
  })
  plugin.onRequest!({
    request: returning.request,
    response: returning.response,
    route: returning.route,
  })
  expect(returning.redirects).toEqual([])

  const post = exchange({
    path: '/about',
    method: 'POST',
    headers: { 'Accept-Language': 'es' },
  })
  plugin.onRequest!({
    request: post.request,
    response: post.response,
    route: post.route,
  })
  expect(post.redirects).toEqual([])

  const unknown = exchange({
    path: '/about',
    headers: { 'Accept-Language': 'ja' },
  })
  plugin.onRequest!({
    request: unknown.request,
    response: unknown.response,
    route: unknown.route,
  })
  expect(unknown.redirects).toEqual([])
})

test('without prefixes the language comes from the cookie, then the browser', () => {
  const plugin = make({ strategy: 'none' })
  const browser = exchange({
    path: '/about',
    headers: { 'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8' },
  })
  const api = run(plugin, browser)
  expect(api.locale).toBe('es')
  expect(browser.request.pathname).toBe('/about')
  expect(browser.sent.get('Vary')).toEqual(['Accept-Language', 'Cookie'])
  expect(browser.cookies[0]).toMatchObject({ name: 'pp_lang', value: 'es' })

  const cookie = exchange({
    path: '/about',
    headers: { 'Accept-Language': 'es' },
    cookies: { pp_lang: 'pt-BR' },
  })
  expect(run(plugin, cookie).locale).toBe('pt-BR')
  expect(cookie.cookies).toEqual([])

  const forged = exchange({
    path: '/',
    cookies: { pp_lang: '../../etc' },
    headers: { 'Accept-Language': 'es' },
  })
  expect(run(plugin, forged).locale).toBe('es')

  const none = exchange({ path: '/' })
  expect(run(plugin, none).locale).toBe('en')
  expect(run(plugin, none).localePath('/about')).toBe('/about')
})

test('files and PocketBase requests are left alone', () => {
  const plugin = make()
  for (const route of [null, { isStatic: true }]) {
    const x = exchange({ path: '/logo.png', route })
    expect(
      plugin.onRequest!({
        request: x.request,
        response: x.response,
        route: x.route,
      })
    ).toBeUndefined()
    expect(x.request.pathname).toBe('/logo.png')
    expect(x.sent.size).toBe(0)
    expect(x.request.state.i18n).toBeUndefined()
  }
  const strategyNone = make({ strategy: 'none' })
  const y = exchange({
    path: '/api/health',
    route: null,
    headers: { 'Accept-Language': 'es' },
  })
  strategyNone.onRequest!({
    request: y.request,
    response: y.response,
    route: y.route,
  })
  expect(y.sent.size).toBe(0)
  expect(y.cookies).toEqual([])
})

test('addresses with a language are rewritten before a route is known for them', () => {
  // The route of /es/about is the one of the address as it came in: none
  const x = exchange({ path: '/es/about', route: null })
  run(make(), x)
  expect(x.request.pathname).toBe('/about')
  expect(x.request.state.i18n.locale).toBe('es')
  const file = exchange({ path: '/es/assets/app.css', route: null })
  make().onRequest!({
    request: file.request,
    response: file.response,
    route: file.route,
  })
  expect(file.request.pathname).toBe('/assets/app.css')
})

// --- translating

const english = () => run(make(), exchange({ path: '/' }))
const spanish = () => run(make(), exchange({ path: '/es/' }))

test('messages are found by their path', () => {
  expect(english().t('nav.home')).toBe('Home')
  expect(spanish().t('nav.home')).toBe('Inicio')
  expect(english().t.has('nav.home')).toBe(true)
  expect(english().t.has('nav.nothing')).toBe(false)
})

test('variables go in', () => {
  expect(english().t('welcome', { name: 'Ana' })).toBe('Welcome, Ana!')
  expect(spanish().t('welcome', { name: 'Ana' })).toBe('Bienvenido, Ana!')
})

test('the form of a plural comes from the count', () => {
  const t = english().t
  expect(t('items', { count: 1 })).toBe('1 item')
  expect(t('items', { count: 2 })).toBe('2 items')
  expect(spanish().t('items', { count: 0 })).toBe('0 elementos')
  expect(spanish().t('items', { count: 1 })).toBe('1 elemento')
})

test('what is missing in a language comes from the default one, then is the key', () => {
  expect(spanish().t('onlyEnglish')).toBe('English only')
  expect(spanish().t('no.such.key')).toBe('no.such.key')
  expect(run(make(), exchange({ path: '/pt-BR/' })).t('nav.home')).toBe('Home')
  expect(spanish().t.has('onlyEnglish')).toBe(true)
})

test('a message can be asked for in another language', () => {
  expect(english().t('title', {}, { locale: 'es' })).toBe('Hola')
})

test('messages with markup can have their variables escaped', () => {
  const api = english()
  expect(api.t('bold', { name: '<script>' })).toBe('Hi <b><script></b>')
  expect(api.t.html('bold', { name: '<script>' })).toBe(
    'Hi <b>&lt;script&gt;</b>'
  )
})

test('translations can be written in the config, and files win', () => {
  const plugin = make({
    locales: ['en', 'fr'],
    messages: {
      fr: { title: 'Bonjour', extra: 'Extra' },
      en: { title: 'Overridden', inlineOnly: 'Inline' },
    },
  })
  const fr = run(plugin, exchange({ path: '/fr/' }))
  expect(fr.t('title')).toBe('Bonjour')
  expect(fr.t('extra')).toBe('Extra')
  const en = run(plugin, exchange({ path: '/' }))
  expect(en.t('title')).toBe('Hello')
  expect(en.t('inlineOnly')).toBe('Inline')
})

test('a language with no file works from the config alone', () => {
  const plugin = make({
    locales: ['en', 'de'],
    messages: { de: { title: 'Hallo' } },
  })
  expect(run(plugin, exchange({ path: '/de/' })).t('title')).toBe('Hallo')
})

// --- addresses

test('addresses are put in a language', () => {
  const api = run(make(), exchange({ path: '/es/about' }))
  expect(api.localePath('/contact')).toBe('/es/contact')
  expect(api.i18n.path('/contact', 'en')).toBe('/contact')
  expect(api.i18n.path('/contact', 'pt-BR')).toBe('/pt-BR/contact')
  expect(api.i18n.path('/', 'es')).toBe('/es')
})

test('every language of a page', () => {
  const api = run(make(), exchange({ path: '/es/blog/post' }))
  expect(api.i18n.alternates()).toEqual([
    { locale: 'en', path: '/blog/post', current: false },
    { locale: 'es', path: '/es/blog/post', current: true },
    { locale: 'pt-BR', path: '/pt-BR/blog/post', current: false },
  ])
  expect(api.i18n.hreflang()).toBe(
    [
      '<link rel="alternate" hreflang="en" href="https://example.com/blog/post">',
      '<link rel="alternate" hreflang="es" href="https://example.com/es/blog/post">',
      '<link rel="alternate" hreflang="pt-BR" href="https://example.com/pt-BR/blog/post">',
      '<link rel="alternate" hreflang="x-default" href="https://example.com/blog/post">',
    ].join('\n')
  )
  const custom = run(
    make({ baseUrl: 'https://www.example.org/' }),
    exchange({ path: '/' })
  )
  expect(custom.i18n.hreflang()).toContain('href="https://www.example.org/es"')
  expect(
    run(make({ strategy: 'none' }), exchange({ path: '/' })).i18n.hreflang()
  ).toBe('')
})

test('right to left languages say so', () => {
  const plugin = make({ locales: ['en', 'ar', 'he-IL'], messages: {} })
  expect(run(plugin, exchange({ path: '/ar/' })).i18n.dir).toBe('rtl')
  expect(run(plugin, exchange({ path: '/he-IL/' })).i18n.dir).toBe('rtl')
  expect(run(plugin, exchange({ path: '/' })).i18n.dir).toBe('ltr')
})

// --- numbers and dates

test('numbers and dates follow the language', () => {
  const en = english().i18n
  const es = spanish().i18n
  expect(en.formatNumber(1234567.5)).toBe('1,234,567.5')
  expect(en.formatNumber(3.14159, { decimals: 2 })).toBe('3.14')
  // The file of Spanish changes the separator of groups
  expect(es.formatNumber(1234567.5)).toBe('1 234 567,5')
  const date = '2024-05-06 15:08:09.000Z'
  expect(en.formatDate(date)).toBe('May 6, 2024')
  expect(en.formatDate(date, 'long')).toBe('May 6, 2024')
  expect(en.formatDate(date, 'short')).toBe('05/06/2024')
  expect(en.formatDate(date, 'time')).toBe('3:08 PM')
  expect(en.formatDate(date, 'datetime')).toBe('May 6, 2024 3:08 PM')
  expect(es.formatDate(date, 'long')).toBe('6 de mayo de 2024')
  expect(es.formatDate(date, 'dddd D')).toBe('lunes 6')
  expect(en.formatDate('nonsense')).toBe('')
})
