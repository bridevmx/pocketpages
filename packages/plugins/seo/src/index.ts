import type {
  PagesRequest,
  PagesResponse,
  PluginFactory,
  PluginOptionsBase,
} from 'pocketpages'
import {
  buildHead,
  Crumb,
  breadcrumbs as makeBreadcrumbs,
  mergeSeo,
  SeoData,
  SeoSettings,
  titleOf,
} from './head'
import { buildRobots, RobotsRule } from './robots'
import { buildRss, FeedItem } from './rss'
import {
  buildSitemap,
  detectI18n,
  pagePaths,
  PathEntry,
  SitemapEntry,
  toEntries,
} from './sitemap'
import { absoluteUrl, excerpt, expand, toW3CDate } from './xml'

export type { SeoData } from './head'
export type { RobotsRule } from './robots'

export type SitemapCollection = {
  /** The collection to list records of */
  collection: string
  /** Which records, in the filter syntax of PocketBase. Say `published = true` if some are drafts: the sitemap is public. */
  filter?: string
  sort?: string
  /** The address of a record, filled in with its fields: `/blog/{slug}` */
  path: string
  /** The field with the day it last changed, `updated` */
  lastmod?: string
  changefreq?: SitemapEntry['changefreq']
  priority?: number
  /** List the address in every language of the site, as pages are. On when the site has several. */
  localized?: boolean
  /** The most records to list, 50000 (a sitemap's limit) unless told otherwise */
  limit?: number
}

export type SitemapOptions = {
  /** Where it is served, `/sitemap.xml` unless told otherwise */
  path?: string
  /** List the pages of the site, on unless told otherwise */
  pages?: boolean
  /** Pages and folders to leave out: `/admin/**`, `/login` */
  exclude?: string[]
  /** More addresses */
  urls?: Array<{
    path: string
    lastmod?: string
    changefreq?: SitemapEntry['changefreq']
    priority?: number
    localized?: boolean
  }>
  /** Addresses made from records */
  collections?: SitemapCollection[]
  /** Seconds a sitemap is kept before it is made again, an hour unless told otherwise */
  ttl?: number
}

export type FeedOptions = {
  /** Where it is served, `/rss.xml` unless told otherwise */
  path?: string
  title: string
  description: string
  /** The page the feed is about, `/` unless told otherwise */
  link?: string
  language?: string
  collection: string
  filter?: string
  /** `-created` unless told otherwise */
  sort?: string
  /** The most posts, 20 unless told otherwise */
  limit?: number
  /** Seconds a feed is kept before it is made again, ten minutes unless told otherwise */
  ttl?: number
  /** Which field of a record goes where. `{slug}` and the like are filled in. */
  item: {
    title: string
    /** The address of the post: `/blog/{slug}` */
    link: string
    /** Field with a summary */
    description?: string
    /** Field with the whole post, in HTML */
    content?: string
    /** Field with the day it was published, `created` unless told otherwise */
    date?: string
    /** Field with the name of the author */
    author?: string
    /** Field with a category (or several) */
    category?: string
  }
}

export type SeoOptions = PluginOptionsBase &
  SeoData & {
    /** The address of the site, `https://example.com`. The `appURL` setting of PocketBase unless told otherwise. */
    baseUrl: string
    /** `{title} | {siteName}` unless told otherwise */
    titleTemplate: string
    /** The title of pages that don't set one, the name of the site unless told otherwise */
    defaultTitle: string
    /** Add the `hreflang` links of the i18n plugin to the head, on unless told otherwise */
    hreflang: boolean
    /** `robots.txt`: rules, or `false` to leave it to you. Served by default. */
    robots:
      | { rules?: RobotsRule[]; sitemap?: boolean | string | string[] }
      | false
    /** `sitemap.xml`: `false` to leave it to you. Served by default. */
    sitemap: SitemapOptions | false
    /** RSS feeds */
    feeds: FeedOptions[]
  }

const SEO_KEYS = [
  'title',
  'description',
  'canonical',
  'image',
  'imageAlt',
  'type',
  'siteName',
  'locale',
  'noindex',
  'nofollow',
  'twitter',
  'twitterCreator',
  'twitterCard',
  'publishedTime',
  'modifiedTime',
  'author',
  'section',
  'tags',
  'meta',
]
const VALID_KEYS = [
  'debug',
  'baseUrl',
  'titleTemplate',
  'defaultTitle',
  'hreflang',
  'robots',
  'sitemap',
  'feeds',
  ...SEO_KEYS,
]

/** What pages get as `seo` */
export type Seo = {
  /** Sets what this page says about itself. What it leaves out stays as the config says. */
  set: (data: SeoData) => Seo
  get: () => SeoData
  /** The title of the page as it goes in the `<title>`: `Pricing | Acme` */
  title: () => string
  /** Adds structured data (JSON-LD) to the head. Pass an object, or a list of them. */
  jsonLd: (data: object | object[]) => Seo
  /** Adds a `BreadcrumbList`: `seo.breadcrumbs([{ name: 'Home', url: '/' }, ...])` */
  breadcrumbs: (items: Crumb[]) => Seo
  /** Text without tags, cut at a word, for descriptions */
  excerpt: (html: string, max?: number) => string
  /** The tags for the `<head>` */
  head: () => string
}

const STORE_PREFIX = 'pp:seo:'

type Cached = { body: string; expires: number; etag: string }

const seoPluginFactory: PluginFactory<SeoOptions> = (config, extra) => {
  const { globalApi, dbg } = config

  Object.keys(extra).forEach((key) => {
    if (!VALID_KEYS.includes(key)) {
      throw new Error(`pocketpages-plugin-seo: unknown option '${key}'`)
    }
  })

  const defaults: SeoData = {}
  for (const key of SEO_KEYS) {
    const value = (extra as Record<string, unknown>)[key]
    if (value !== undefined) (defaults as Record<string, unknown>)[key] = value
  }
  const titleTemplate = extra.titleTemplate ?? '{title} | {siteName}'
  const useCache = config.config.cache ?? !$app.isDev()

  const baseUrl = (): string =>
    (extra.baseUrl ?? $app.settings().meta.appURL ?? '').replace(/\/+$/, '')

  const settings = (): SeoSettings => ({
    baseUrl: baseUrl(),
    titleTemplate,
    defaultTitle: extra.defaultTitle,
  })

  const i18n = detectI18n(config.config.plugins as unknown[])

  // --- documents served at an address of their own

  type Endpoint = {
    type: string
    ttl: number
    make: () => string
  }
  const endpoints = new Map<string, Endpoint>()

  const recordsOf = (
    collection: string,
    filter: string,
    sort: string,
    limit: number
  ) =>
    $app.findRecordsByFilter(collection, filter, sort, limit, 0) as Array<
      | {
          get: (field: string) => unknown
        }
      | undefined
    >

  const sitemapOptions =
    extra.sitemap === false ? undefined : (extra.sitemap ?? {})
  const sitemapPath = sitemapOptions?.path ?? '/sitemap.xml'
  if (sitemapOptions) {
    const isExcluded =
      sitemapOptions.exclude && sitemapOptions.exclude.length > 0
        ? globalApi.pathMatcher(sitemapOptions.exclude)
        : () => false
    endpoints.set(sitemapPath, {
      type: 'application/xml; charset=utf-8',
      ttl: sitemapOptions.ttl ?? 3600,
      make: () => {
        const base = baseUrl()
        const paths: PathEntry[] = []
        if (sitemapOptions.pages !== false) {
          for (const path of pagePaths(config.routes as any, isExcluded)) {
            paths.push({ path })
          }
        }
        for (const url of sitemapOptions.urls ?? [])
          paths.push({ ...url, lastmod: toW3CDate(url.lastmod) })
        for (const c of sitemapOptions.collections ?? []) {
          const records = recordsOf(
            c.collection,
            c.filter ?? '',
            c.sort ?? '',
            c.limit ?? 50000
          )
          for (const record of records) {
            if (!record) continue
            paths.push({
              path: expand(c.path, (field) => record.get(field)),
              lastmod:
                c.lastmod === undefined
                  ? toW3CDate(record.get('updated'))
                  : toW3CDate(record.get(c.lastmod)),
              changefreq: c.changefreq,
              priority: c.priority,
              localized: c.localized,
            })
          }
        }
        return buildSitemap(toEntries(base, paths, i18n))
      },
    })
  }

  const robotsOptions =
    extra.robots === false ? undefined : (extra.robots ?? {})
  if (robotsOptions) {
    endpoints.set('/robots.txt', {
      type: 'text/plain; charset=utf-8',
      ttl: 3600,
      make: () => {
        const wanted = robotsOptions.sitemap ?? true
        const sitemaps =
          wanted === false
            ? []
            : wanted === true
              ? sitemapOptions
                ? [sitemapPath]
                : []
              : [wanted].flat()
        return buildRobots(robotsOptions.rules ?? [], sitemaps, baseUrl())
      },
    })
  }

  for (const feed of extra.feeds ?? []) {
    const path = feed.path ?? '/rss.xml'
    endpoints.set(path, {
      type: 'application/rss+xml; charset=utf-8',
      ttl: feed.ttl ?? 600,
      make: () => {
        const base = baseUrl()
        const fields = feed.item
        const records = recordsOf(
          feed.collection,
          feed.filter ?? '',
          feed.sort ?? '-created',
          feed.limit ?? 20
        )
        const items: FeedItem[] = []
        for (const record of records) {
          if (!record) continue
          const text = (field: string | undefined) => {
            if (!field) return undefined
            const value = record.get(field)
            return value === undefined || value === null || value === ''
              ? undefined
              : String(value)
          }
          const categories = fields.category
            ? record.get(fields.category)
            : undefined
          items.push({
            title: text(fields.title) ?? '',
            link: absoluteUrl(
              base,
              expand(fields.link, (f) => record.get(f))
            ),
            description: text(fields.description),
            content: text(fields.content),
            date: text(fields.date ?? 'created'),
            author: text(fields.author),
            categories: Array.isArray(categories)
              ? categories.map(String)
              : categories
                ? [String(categories)]
                : undefined,
          })
        }
        return buildRss(
          {
            title: feed.title,
            description: feed.description,
            link: absoluteUrl(base, feed.link ?? '/'),
            self: absoluteUrl(base, path),
            language: feed.language,
            ttl: Math.round((feed.ttl ?? 600) / 60),
          },
          items
        )
      },
    })
  }

  /** The document, from the cache shared by every JS runtime when it is fresh enough */
  const documentFor = (path: string, endpoint: Endpoint): Cached => {
    const key = `${STORE_PREFIX}${path}`
    const now = Date.now()
    if (useCache) {
      const known = $app.store<Cached>().get(key) as Cached | null
      if (known && typeof known === 'object' && known.expires > now)
        return known
    }
    const body = endpoint.make()
    const made: Cached = {
      body,
      expires: now + endpoint.ttl * 1000,
      etag: `"${$security.md5(body)}"`,
    }
    if (useCache) $app.store<Cached>().set(key, made)
    return made
  }

  const serve = (
    path: string,
    endpoint: Endpoint,
    request: PagesRequest,
    response: PagesResponse
  ) => {
    const doc = documentFor(path, endpoint)
    response.header('Content-Type', endpoint.type)
    response.header('ETag', doc.etag)
    response.header(
      'Cache-Control',
      `public, max-age=${Math.min(endpoint.ttl, 3600)}`
    )
    if (request.header('If-None-Match') === doc.etag) {
      response.noContent(304)
    } else if (request.method === 'HEAD') {
      response.noContent(200)
    } else {
      response.text(200, doc.body)
    }
  }

  return {
    name: 'seo',

    onRequest: ({ request, response, route }) => {
      // A page of the site with that address wins over the one made here. Pages with a
      // [param] in their address don't: `/[slug]` would otherwise hide `/robots.txt`.
      if (endpoints.size === 0) return
      if (route && !route.segments.some((segment) => segment.paramName)) return
      if (request.method !== 'GET' && request.method !== 'HEAD') return
      const path = request.pathname
      const endpoint = endpoints.get(path)
      if (!endpoint) return
      dbg(`serving ${path}`)
      serve(path, endpoint, request, response)
      return true
    },

    onExtendContextApi: ({ api }) => {
      const { request } = api
      let page: SeoData = {}
      const jsonLd: unknown[] = []

      const data = (): SeoData => {
        const merged = mergeSeo(defaults, page)
        // The language of the visitor, if the i18n plugin has one
        if (
          merged.locale === undefined &&
          typeof api.locale === 'string' &&
          api.locale.includes('-')
        ) {
          merged.locale = api.locale.replace('-', '_')
        }
        return merged
      }

      const seo: Seo = {
        set: (values) => {
          page = mergeSeo(page, values)
          return seo
        },
        get: data,
        title: () => titleOf(data(), settings()),
        jsonLd: (values) => {
          jsonLd.push(...[values].flat())
          return seo
        },
        breadcrumbs: (items) => {
          jsonLd.push(makeBreadcrumbs(baseUrl(), items))
          return seo
        },
        excerpt,
        head: () => {
          const extraTags: string[] = []
          if (extra.hreflang !== false && api.i18n?.hreflang) {
            const links = api.i18n.hreflang() as string
            if (links) extraTags.push(links)
          }
          // The address the visitor used, without the query string, as it was asked for
          // (encoded: `/%2Fevil.example` must not become `//evil.example`, an address
          // elsewhere) and starting with a single slash
          const target = request.event.request!.url!
          const path =
            '/' + (target.escapedPath?.() ?? target.path).replace(/^[/\\]+/, '')
          return buildHead(data(), settings(), path, jsonLd, extraTags)
        },
      }
      api.seo = seo
    },
  }
}

export default seoPluginFactory
