import type {
  PagesRequest,
  PagesResponse,
  PluginFactory,
  PluginOptionsBase,
} from 'pocketpages'
import {
  buildKey,
  cacheControlFor,
  cookiesAllowCaching,
  parseHeaders,
  QueryRule,
  serializeHeaders,
  whyNotCacheable,
} from './rules'
import { createPageStore, Entry, KeyValue, PageStore, TAG } from './store'

export type PageCacheOptions = PluginOptionsBase & {
  /** Seconds a page is kept, 60 unless told otherwise */
  ttl: number
  /** Seconds browsers keep a page without asking again, 0 (they ask, and get a quick 304) unless told otherwise */
  browserMaxAge: number
  /** Which pages to keep, everything unless told otherwise: `['/blog/**', '/']` */
  include: string[]
  /** Pages never to keep: `['/admin/**', '/cart']` */
  exclude: string[]
  /**
   * Cookies that don't stop a page from being kept (`_ga*`, `consent`). Requests with any
   * other cookie are never served from the cache, nor kept in it: a cookie may be about
   * the visitor, and the page too.
   */
  ignoreCookies: string[]
  /** What the query string means for the page: all of it (the default), none of it, or only these parameters */
  query: 'all' | 'none' | string[]
  /** Request headers that make different pages, `['Accept-Language']` */
  vary: string[]
  /** Headers of the page to send again with the copies */
  headers: string[]
  /** The most pages kept, 300 unless told otherwise */
  maxEntries: number
  /** The largest page kept, 256 KB unless told otherwise */
  maxBodyBytes: number
  /** Tell in the `X-Cache` header what happened (`HIT`, `MISS`, `BYPASS`), on unless told otherwise */
  header: boolean
  /** Keep pages with `--dev` too, off unless told otherwise */
  dev: boolean
}

const VALID_KEYS = [
  'debug',
  'ttl',
  'browserMaxAge',
  'include',
  'exclude',
  'ignoreCookies',
  'query',
  'vary',
  'headers',
  'maxEntries',
  'maxBodyBytes',
  'header',
  'dev',
]

const SWEEP_EVERY = 60_000

/** What pages get as `pageCache` */
export type PageCache = {
  /** The page depends on these things: it is made again after `purge()` of any of them. Call it before reading them. */
  tag: (...tags: string[]) => PageCache
  /** Do not keep this page */
  skip: () => PageCache
  /** `HIT`, `MISS` or `BYPASS`, as the visitor is told */
  status: () => string
  /** The pages that depend on `tag` are made again */
  purge: (tag: string) => void
  /** The pages whose address starts with `prefix` are forgotten */
  purgePath: (prefix: string) => number
  purgeAll: () => void
}

type State = {
  key: string
  tags: string[]
  gens: number[]
  global: number
  skipped: boolean
  status: 'HIT' | 'MISS' | 'BYPASS'
}

/** The store of PocketBase, shared by every JS runtime */
const pocketBaseStore = (): KeyValue => {
  const s = $app.store<any>() as any
  return {
    get: (key) => s.get(key),
    set: (key, value) => s.set(key, value),
    remove: (key) => s.remove(key),
    keys: () =>
      typeof s.keys === 'function'
        ? Array.from(s.keys() as string[])
        : Object.keys(s.getAll()),
  }
}

/** What `purge()` and the like use. They never make room, so the size they are given does not matter. */
let helperStore: PageStore | undefined
const helpers = () =>
  helperStore ?? (helperStore = createPageStore(pocketBaseStore(), 300))

/**
 * For code that is not a page, a hook of PocketBase for instance:
 *
 * ```js
 * onRecordAfterUpdateSuccess((e) => {
 *   require('pocketpages-plugin-page-cache').purge('posts')
 *   e.next()
 * }, 'posts')
 * ```
 */
export const purge = (tag: string) => helpers().purge(tag)
export const purgePath = (prefix: string) => helpers().purgePath(prefix)
export const purgeAll = () => helpers().purgeAll()

const pageCachePluginFactory: PluginFactory<PageCacheOptions> = (
  config,
  extra
) => {
  const { globalApi, dbg } = config

  Object.keys(extra).forEach((key) => {
    if (!VALID_KEYS.includes(key)) {
      throw new Error(`pocketpages-plugin-page-cache: unknown option '${key}'`)
    }
  })

  const options = {
    ttl: 60,
    browserMaxAge: 0,
    include: ['/**'],
    exclude: [] as string[],
    ignoreCookies: [] as string[],
    query: 'all' as QueryRule,
    vary: [] as string[],
    headers: ['Content-Language', 'Link', 'X-Robots-Tag'],
    maxEntries: 300,
    maxBodyBytes: 256 * 1024,
    header: true,
    dev: false,
    ...extra,
  }
  if (!(options.ttl > 0))
    throw new Error('pocketpages-plugin-page-cache: ttl must be above 0')
  for (const name of [...options.vary, ...options.headers]) {
    if (!/^[A-Za-z0-9-]+$/.test(name)) {
      throw new Error(
        `pocketpages-plugin-page-cache: invalid header name ${JSON.stringify(name)}`
      )
    }
  }

  const store = createPageStore(pocketBaseStore(), options.maxEntries)
  // With --dev files change under our feet, and pages with them
  const active = options.dev || (config.config.cache ?? !$app.isDev())
  const isIncluded = globalApi.pathMatcher(options.include)
  const isExcluded =
    options.exclude.length > 0
      ? globalApi.pathMatcher(options.exclude)
      : () => false
  const cacheControl = cacheControlFor(options.ttl, options.browserMaxAge)
  let lastSweep = Date.now()

  const sweepSometimes = () => {
    const now = Date.now()
    if (now - lastSweep < SWEEP_EVERY) return
    lastSweep = now
    dbg(`page cache: ${store.sweep(now)} pages kept`)
  }

  const send = (
    request: PagesRequest,
    response: PagesResponse,
    entry: Entry,
    now: number
  ) => {
    if (options.header) {
      response.header('X-Cache', 'HIT')
      response.header(
        'Age',
        String(Math.max(0, Math.floor((now - entry.created) / 1000)))
      )
    }
    for (const [name, value] of parseHeaders(entry.headers)) {
      // What plugins ahead of this one decided stays
      if (!response.header(name)) response.header(name, value)
    }
    response.header('ETag', entry.etag)
    response.header('Cache-Control', cacheControl)
    response.addHeader('Vary', 'Cookie')
    for (const name of options.vary) response.addHeader('Vary', name)
    response.header('Content-Type', 'text/html; charset=utf-8')
    if (request.header('If-None-Match') === entry.etag) {
      response.noContent(304)
    } else if (request.method === 'HEAD') {
      response.noContent(200)
    } else {
      response.html(200, entry.body)
    }
  }

  return {
    name: 'page-cache',

    onRequest: ({ request, response, route }) => {
      if (!active || !route || route.isStatic) return
      if (request.method !== 'GET' && request.method !== 'HEAD') return
      const path = request.event.request!.url!.path
      if (!isIncluded(request.pathname) || isExcluded(request.pathname)) return

      const bypass = (why: string) => {
        dbg(`page cache: ${path} bypassed, ${why}`)
        if (options.header) response.header('X-Cache', 'BYPASS')
      }
      if (
        !cookiesAllowCaching(request.header('Cookie'), options.ignoreCookies)
      ) {
        return bypass('cookies')
      }
      if (request.header('Authorization') || request.auth)
        return bypass('signed in')

      const key = buildKey({
        method: 'GET',
        host: request.header('Host'),
        path,
        rawQuery: request.event.request!.url!.rawQuery,
        query: options.query,
        vary: options.vary.map((name) => request.header(name)),
      })
      if (key === undefined) return bypass('address too long')

      sweepSometimes()
      const now = Date.now()
      const entry = store.lookup(key, now)
      if (entry) {
        request.state.pageCache = { status: 'HIT' }
        send(request, response, entry, now)
        return true
      }

      // A miss: the page is made, and kept if it turns out to be one for everybody
      const generations = store.generations([])
      const state: State = {
        key,
        tags: [],
        gens: [],
        global: generations.global,
        skipped: false,
        status: 'MISS',
      }
      request.state.pageCache = state
    },

    onAfterRender: ({ api, content }) => {
      const { request, response } = api
      const state = request.state.pageCache as State | undefined
      if (!state || state.status !== 'MISS') return

      const raw = request.event.response
      const why = whyNotCacheable({
        status: response.status(),
        contentType: response.header('Content-Type') ?? '',
        sent: response.sent(),
        setsCookie: !!raw.header().get('Set-Cookie'),
        cacheControl: response.header('Cache-Control') ?? '',
        vary: Array.from(raw.header().values('Vary')).join(', '),
        skipped: state.skipped,
        hasNonce: !!request.state.security?.nonce,
        bytes: content.length,
        maxBytes: options.maxBodyBytes,
      })
      if (options.header) response.header('X-Cache', 'MISS')
      if (why) {
        dbg(`page cache: ${request.pathname} not kept, ${why}`)
        state.status = 'BYPASS'
        if (options.header) response.header('X-Cache', 'BYPASS')
        return
      }

      const kept: Array<[string, string]> = []
      for (const name of options.headers) {
        const value = response.header(name)
        if (value) kept.push([name, value])
      }
      const now = Date.now()
      const entry: Entry = {
        body: content,
        etag: `"${$security.md5(content)}"`,
        created: now,
        expires: now + options.ttl * 1000,
        tags: state.tags.join(','),
        gens: [...state.gens, state.global].join(','),
        headers: serializeHeaders(kept),
      }
      store.save(state.key, entry)
      response.header('ETag', entry.etag)
      if (!response.header('Cache-Control'))
        response.header('Cache-Control', cacheControl)
      response.addHeader('Vary', 'Cookie')
      for (const name of options.vary) response.addHeader('Vary', name)
    },

    onExtendContextApi: ({ api }) => {
      const state = api.request.state.pageCache as
        | State
        | { status: string }
        | undefined
      const pageCache: PageCache = {
        tag: (...tags) => {
          const mine = state as State | undefined
          if (!mine || mine.status !== 'MISS') return pageCache
          for (const tag of tags) {
            if (!TAG.test(tag))
              throw new Error(`Invalid page cache tag: ${JSON.stringify(tag)}`)
            if (mine.tags.indexOf(tag) === -1) {
              mine.tags.push(tag)
              mine.gens.push(store.generations([tag]).gens[0]!)
            }
          }
          return pageCache
        },
        skip: () => {
          if (state && 'skipped' in state) state.skipped = true
          return pageCache
        },
        status: () => state?.status ?? 'BYPASS',
        purge: (tag) => store.purge(tag),
        purgePath: (prefix) => store.purgePath(prefix),
        purgeAll: () => store.purgeAll(),
      }
      api.pageCache = pageCache
    },
  }
}

export default pageCachePluginFactory
