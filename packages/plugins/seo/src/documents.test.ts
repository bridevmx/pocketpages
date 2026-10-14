import { expect, test } from 'bun:test'
import { buildRobots } from './robots'
import { buildRss } from './rss'
import {
  buildSitemap,
  detectI18n,
  localized,
  pagePaths,
  routePath,
  toEntries,
} from './sitemap'

const route = (names: string[], extra: Record<string, unknown> = {}) => ({
  isStatic: false,
  segments: names.map((n) =>
    n.startsWith('[')
      ? { nodeName: n, paramName: n.slice(1, -1) }
      : { nodeName: n }
  ),
  ...extra,
})

test('pages with a fixed address are listed', () => {
  expect(routePath(route(['index']))).toBe('/')
  expect(routePath(route(['about']))).toBe('/about')
  expect(routePath(route(['docs', 'index']))).toBe('/docs')
  expect(routePath(route(['docs', 'intro']))).toBe('/docs/intro')
  expect(routePath(route(['blog', '[slug]']))).toBeUndefined()
  expect(routePath(route(['logo.png'], { isStatic: true }))).toBeUndefined()
})

test('every page once, in order, minus those left out', () => {
  const routes = [
    route(['index']),
    route(['about']),
    route(['docs', 'index']),
    route(['docs']),
    route(['admin', 'users']),
    route(['blog', '[slug]']),
  ]
  expect(pagePaths(routes, () => false)).toEqual([
    '/',
    '/about',
    '/admin/users',
    '/docs',
  ])
  expect(pagePaths(routes, (p) => p.startsWith('/admin'))).toEqual([
    '/',
    '/about',
    '/docs',
  ])
})

test('a sitemap lists addresses', () => {
  const xml = buildSitemap([
    { loc: 'https://example.com/' },
    {
      loc: 'https://example.com/a?b=1&c=2',
      lastmod: '2024-05-06',
      changefreq: 'weekly',
      priority: 0.8,
    },
  ])
  expect(xml).toBe(
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
      '<url>',
      '<loc>https://example.com/</loc>',
      '</url>',
      '<url>',
      '<loc>https://example.com/a?b=1&amp;c=2</loc>',
      '<lastmod>2024-05-06</lastmod>',
      '<changefreq>weekly</changefreq>',
      '<priority>0.8</priority>',
      '</url>',
      '</urlset>',
      '',
    ].join('\n')
  )
})

test('priorities stay between 0 and 1', () => {
  expect(buildSitemap([{ loc: 'x', priority: 5 }])).toContain(
    '<priority>1.0</priority>'
  )
  expect(buildSitemap([{ loc: 'x', priority: -1 }])).toContain(
    '<priority>0.0</priority>'
  )
})

test('a sitemap has at most 50,000 addresses', () => {
  const entries = Array.from({ length: 50005 }, (_, i) => ({
    loc: `https://example.com/${i}`,
  }))
  expect(buildSitemap(entries).match(/<url>/g)).toHaveLength(50000)
})

test('pages in several languages point at each other', () => {
  const i18n = {
    locales: ['en', 'es'],
    defaultLocale: 'en',
    prefixDefault: false,
  }
  const entries = toEntries(
    'https://example.com',
    [{ path: '/about' }, { path: '/', lastmod: '2024-01-01' }],
    i18n
  )
  expect(entries.map((e) => e.loc)).toEqual([
    'https://example.com/about',
    'https://example.com/es/about',
    'https://example.com/',
    'https://example.com/es',
  ])
  expect(entries[0]!.alternates).toEqual([
    { hreflang: 'en', href: 'https://example.com/about' },
    { hreflang: 'es', href: 'https://example.com/es/about' },
    { hreflang: 'x-default', href: 'https://example.com/about' },
  ])
  expect(entries[3]!.lastmod).toBe('2024-01-01')
  const xml = buildSitemap(entries.slice(0, 1))
  expect(xml).toContain(
    '<xhtml:link rel="alternate" hreflang="es" href="https://example.com/es/about"/>'
  )
})

test('pages can be left in one language', () => {
  const i18n = {
    locales: ['en', 'es'],
    defaultLocale: 'en',
    prefixDefault: true,
  }
  const entries = toEntries(
    'https://example.com',
    [{ path: '/legal', localized: false }, { path: '/x' }],
    i18n
  )
  expect(entries.map((e) => e.loc)).toEqual([
    'https://example.com/legal',
    'https://example.com/en/x',
    'https://example.com/es/x',
  ])
  expect(entries[0]!.alternates).toBeUndefined()
  expect(localized('/x', 'en', i18n)).toBe('/en/x')
  expect(toEntries('https://example.com', [{ path: '/x' }], undefined)).toEqual(
    [{ loc: 'https://example.com/x' }]
  )
})

test('the i18n plugin is found in the config', () => {
  expect(
    detectI18n([
      'pocketpages-plugin-ejs',
      {
        name: 'pocketpages-plugin-i18n',
        locales: ['es', 'en'],
        prefixDefault: true,
      },
    ])
  ).toEqual({ locales: ['es', 'en'], defaultLocale: 'es', prefixDefault: true })
  expect(
    detectI18n([
      {
        name: 'pocketpages-plugin-i18n',
        locales: ['en', 'es'],
        defaultLocale: 'es',
      },
    ])?.defaultLocale
  ).toBe('es')
  expect(
    detectI18n([
      {
        name: 'pocketpages-plugin-i18n',
        locales: ['en', 'es'],
        strategy: 'none',
      },
    ])
  ).toBeUndefined()
  expect(detectI18n(['pocketpages-plugin-i18n'])).toBeUndefined()
  expect(detectI18n([{ name: 'other' }, null, 5])).toBeUndefined()
})

test('robots.txt', () => {
  expect(buildRobots([], [], 'https://example.com')).toBe(
    'User-agent: *\nAllow: /\n'
  )
  expect(
    buildRobots(
      [
        { userAgent: '*', disallow: ['/admin', '/api'] },
        { userAgent: ['GPTBot', 'CCBot'], disallow: ['/'] },
        { userAgent: 'Bingbot', crawlDelay: 5 },
      ],
      ['/sitemap.xml', 'https://cdn.example.com/other.xml'],
      'https://example.com'
    )
  ).toBe(
    [
      'User-agent: *',
      'Disallow: /admin',
      'Disallow: /api',
      '',
      'User-agent: GPTBot',
      'User-agent: CCBot',
      'Disallow: /',
      '',
      'User-agent: Bingbot',
      'Crawl-delay: 5',
      '',
      'Sitemap: https://example.com/sitemap.xml',
      'Sitemap: https://cdn.example.com/other.xml',
      '',
    ].join('\n')
  )
  expect(buildRobots([{ userAgent: 'Foo' }], [], '')).toBe(
    'User-agent: Foo\nDisallow:\n'
  )
  expect(() => buildRobots([{ disallow: ['/a\nAllow: /'] }], [], '')).toThrow()
})

test('an RSS feed', () => {
  const xml = buildRss(
    {
      title: 'Blog & co',
      link: 'https://example.com/blog',
      description: 'News',
      self: 'https://example.com/rss.xml',
      language: 'en',
      ttl: 60,
    },
    [
      {
        title: 'First <post>',
        link: 'https://example.com/blog/first',
        description: 'Summary',
        content: '<p>Body ]]> here</p>',
        date: '2024-05-06 07:08:09.000Z',
        author: 'Ana',
        categories: ['a', 'b'],
      },
      {
        title: 'Second',
        link: 'https://example.com/blog/second',
        guid: 'urn:second',
      },
    ]
  )
  expect(xml).toContain('<title>Blog &amp; co</title>')
  expect(xml).toContain(
    '<atom:link href="https://example.com/rss.xml" rel="self" type="application/rss+xml"/>'
  )
  expect(xml).toContain('<language>en</language>')
  expect(xml).toContain('<ttl>60</ttl>')
  expect(xml).toContain(
    '<lastBuildDate>Mon, 06 May 2024 07:08:09 GMT</lastBuildDate>'
  )
  expect(xml).toContain('<title>First &lt;post&gt;</title>')
  expect(xml).toContain(
    '<guid isPermaLink="true">https://example.com/blog/first</guid>'
  )
  expect(xml).toContain('<guid isPermaLink="false">urn:second</guid>')
  expect(xml).toContain('<pubDate>Mon, 06 May 2024 07:08:09 GMT</pubDate>')
  expect(xml).toContain('<dc:creator>Ana</dc:creator>')
  expect(xml).toContain('<category>a</category><'.replace('><', '>\n<'))
  expect(xml).toContain(
    '<content:encoded><![CDATA[<p>Body ]]]]><![CDATA[> here</p>]]></content:encoded>'
  )
  expect(xml.endsWith('</rss>\n')).toBe(true)
})
