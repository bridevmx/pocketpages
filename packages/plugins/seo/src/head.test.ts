import { expect, test } from 'bun:test'
import { breadcrumbs, buildHead, mergeSeo, titleOf } from './head'
import {
  absoluteUrl,
  cdata,
  escapeHtml,
  escapeXml,
  excerpt,
  expand,
  safeJson,
  toRfc822,
  toW3CDate,
} from './xml'

const settings = {
  baseUrl: 'https://example.com',
  titleTemplate: '{title} | {siteName}',
}

test('titles are made from a template', () => {
  expect(titleOf({ siteName: 'Acme', title: 'Pricing' }, settings)).toBe(
    'Pricing | Acme'
  )
  expect(titleOf({ siteName: 'Acme', title: 'Acme' }, settings)).toBe('Acme')
  expect(titleOf({ siteName: 'Acme' }, settings)).toBe('Acme')
  expect(
    titleOf(
      { siteName: 'Acme' },
      { ...settings, defaultTitle: 'Acme - Rockets' }
    )
  ).toBe('Acme - Rockets')
  expect(titleOf({ title: 'Pricing' }, settings)).toBe('Pricing')
  expect(titleOf({}, settings)).toBe('')
  expect(
    titleOf(
      { siteName: 'Acme', title: 'A' },
      { ...settings, titleTemplate: '{siteName}: {title} ({title})' }
    )
  ).toBe('Acme: A (A)')
})

test('what a page sets goes over what the config says', () => {
  const merged = mergeSeo(
    { siteName: 'Acme', description: 'Default', meta: { a: '1' } },
    { description: 'Mine', title: undefined, meta: { b: '2' } },
    { noindex: true }
  )
  expect(merged).toEqual({
    siteName: 'Acme',
    description: 'Mine',
    meta: { a: '1', b: '2' },
    noindex: true,
  })
})

test('a head has what search engines and social networks look for', () => {
  const head = buildHead(
    {
      siteName: 'Acme',
      title: 'Pricing',
      description: 'Plans & "prices"',
      image: '/img/cover.png',
      imageAlt: 'A rocket',
      twitter: '@acme',
    },
    settings,
    '/pricing'
  )
  expect(head).toBe(
    [
      '<title>Pricing | Acme</title>',
      '<meta name="description" content="Plans &amp; &quot;prices&quot;">',
      '<link rel="canonical" href="https://example.com/pricing">',
      '<meta property="og:site_name" content="Acme">',
      '<meta property="og:type" content="website">',
      '<meta property="og:title" content="Pricing | Acme">',
      '<meta property="og:description" content="Plans &amp; &quot;prices&quot;">',
      '<meta property="og:url" content="https://example.com/pricing">',
      '<meta property="og:image" content="https://example.com/img/cover.png">',
      '<meta property="og:image:alt" content="A rocket">',
      '<meta name="twitter:card" content="summary_large_image">',
      '<meta name="twitter:site" content="@acme">',
      '<meta name="twitter:title" content="Pricing | Acme">',
      '<meta name="twitter:description" content="Plans &amp; &quot;prices&quot;">',
      '<meta name="twitter:image" content="https://example.com/img/cover.png">',
      '<meta name="twitter:image:alt" content="A rocket">',
    ].join('\n')
  )
})

test('tags with nothing in them are left out', () => {
  const head = buildHead({ title: 'Hi' }, { ...settings, baseUrl: '' }, '/x')
  expect(head).toBe(
    [
      '<title>Hi</title>',
      '<meta property="og:type" content="website">',
      '<meta property="og:title" content="Hi">',
      '<meta name="twitter:card" content="summary">',
      '<meta name="twitter:title" content="Hi">',
    ].join('\n')
  )
})

test('the address can be changed, and pages can be kept out of search results', () => {
  const head = buildHead(
    { title: 'Hi', canonical: 'https://elsewhere.test/a', noindex: true },
    settings,
    '/b?page=2'
  )
  expect(head).toContain(
    '<link rel="canonical" href="https://elsewhere.test/a">'
  )
  expect(head).toContain('<meta name="robots" content="noindex,follow">')
  expect(buildHead({ nofollow: true }, settings, '/')).toContain(
    'content="index,nofollow"'
  )
  expect(buildHead({ noindex: true, nofollow: true }, settings, '/')).toContain(
    'content="noindex,nofollow"'
  )
})

test('articles have their own tags', () => {
  const head = buildHead(
    {
      title: 'Post',
      type: 'article',
      publishedTime: '2024-05-06T07:08:09Z',
      modifiedTime: '2024-05-07T07:08:09Z',
      author: 'Ana',
      section: 'News',
      tags: ['a', 'b'],
      meta: { 'theme-color': '#fff' },
    },
    settings,
    '/post'
  )
  expect(head).toContain('<meta property="og:type" content="article">')
  expect(head).toContain(
    '<meta property="article:published_time" content="2024-05-06T07:08:09Z">'
  )
  expect(head).toContain('<meta property="article:tag" content="a">')
  expect(head).toContain('<meta property="article:tag" content="b">')
  expect(head).toContain('<meta name="theme-color" content="#fff">')
})

test('values cannot break out of the tags', () => {
  const head = buildHead(
    {
      title: '"><script>alert(1)</script>',
      description: "x' onload='y",
      image: '/a"b.png',
    },
    settings,
    '/x"y'
  )
  expect(head).not.toContain('<script>alert')
  expect(head).not.toMatch(/content="[^"]*"[^>]*onload=/)
  expect(head).toContain('&quot;&gt;&lt;script&gt;')
})

test('structured data goes in a script that cannot be closed from the inside', () => {
  const head = buildHead(
    { title: 'Hi' },
    settings,
    '/',
    [{ '@type': 'Thing', name: '</script><script>alert(1)</script>' }],
    ['<link rel="alternate" hreflang="es" href="https://example.com/es">']
  )
  expect(head).toContain('<link rel="alternate" hreflang="es"')
  expect(head).toContain(
    '<script type="application/ld+json">{"@type":"Thing","name":"\\u003c/script\\u003e\\u003cscript\\u003ealert(1)\\u003c/script\\u003e"}</script>'
  )
  expect(head.match(/<\/script>/g)).toHaveLength(1)
})

test('a trail of pages', () => {
  expect(
    breadcrumbs('https://example.com', [
      { name: 'Home', url: '/' },
      { name: 'Blog', url: '/blog' },
    ])
  ).toEqual({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: 'https://example.com/',
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Blog',
        item: 'https://example.com/blog',
      },
    ],
  })
})

test('text for XML and HTML', () => {
  expect(escapeXml(`<a href="x">Tom & 'Jerry'</a>`)).toBe(
    '&lt;a href=&quot;x&quot;&gt;Tom &amp; &apos;Jerry&apos;&lt;/a&gt;'
  )
  expect(escapeXml('a\u0000b\u0008c\u000bd\u001fe')).toBe('abcde')
  expect(escapeXml('tab\tnew\nline\r')).toBe('tab\tnew\nline\r')
  expect(escapeHtml(`<'">&`)).toBe('&lt;&#39;&quot;&gt;&amp;')
  expect(cdata('a]]>b')).toBe('<![CDATA[a]]]]><![CDATA[>b]]>')
  expect(safeJson({ a: '</script>', b: '\u2028&' })).toBe(
    '{"a":"\\u003c/script\\u003e","b":"\\u2028\\u0026"}'
  )
})

test('addresses are made complete', () => {
  expect(absoluteUrl('https://example.com', '/a')).toBe('https://example.com/a')
  expect(absoluteUrl('https://example.com/', '/a')).toBe(
    'https://example.com/a'
  )
  expect(absoluteUrl('https://example.com', 'a/b')).toBe(
    'https://example.com/a/b'
  )
  expect(absoluteUrl('https://example.com', 'https://cdn.test/x.png')).toBe(
    'https://cdn.test/x.png'
  )
  expect(absoluteUrl('https://example.com', '//cdn.test/x.png')).toBe(
    'https://cdn.test/x.png'
  )
  expect(absoluteUrl('', '/a')).toBe('/a')
})

test('templates are filled with the values of a record', () => {
  const record: Record<string, unknown> = {
    slug: 'hello world',
    id: 5,
    empty: null,
  }
  expect(expand('/blog/{slug}', (f) => record[f])).toBe('/blog/hello%20world')
  expect(expand('/{id}/{empty}/{missing}', (f) => record[f])).toBe('/5//')
  expect(expand('/x', (f) => record[f])).toBe('/x')
  expect(
    expand(
      '/blog/{slug}',
      (f) => record[f],
      (s) => s.toUpperCase()
    )
  ).toBe('/blog/HELLO WORLD')
})

test('dates', () => {
  expect(toW3CDate('2024-05-06 07:08:09.123Z')).toBe('2024-05-06')
  expect(toW3CDate('2024-05-06 07:08:09.123Z', true)).toBe(
    '2024-05-06T07:08:09Z'
  )
  expect(toW3CDate(new Date(Date.UTC(2024, 4, 6)))).toBe('2024-05-06')
  expect(toW3CDate('2024-05-06')).toBe('2024-05-06')
  expect(toW3CDate('nonsense')).toBeUndefined()
  expect(toW3CDate('')).toBeUndefined()
  expect(toW3CDate(null)).toBeUndefined()
  expect(toRfc822('2024-05-06 07:08:09Z')).toBe('Mon, 06 May 2024 07:08:09 GMT')
  expect(toRfc822('x')).toBeUndefined()
})

test('descriptions are made from the text of a page', () => {
  expect(excerpt('<p>Hello <b>big</b>   world</p><script>x()</script>')).toBe(
    'Hello big world'
  )
  expect(excerpt('a &amp; b &lt;c&gt;')).toBe('a & b <c>')
  const long = 'word '.repeat(100)
  const short = excerpt(long, 50)
  expect(Array.from(short).length).toBeLessThanOrEqual(50)
  expect(short.endsWith('…')).toBe(true)
  expect(short).toBe('word word word word word word word word word word…')
  expect(excerpt('', 10)).toBe('')
  expect(excerpt('a'.repeat(30), 10)).toBe('aaaaaaaaa…')
})
