import { expect, test } from 'bun:test'
import { pageUrl, pageWindow, paginate, renderNav, toPage } from './paginate'

test('pages are counted from the total', () => {
  const p = paginate({ total: 95, perPage: 20, page: 3 })
  expect(p).toMatchObject({
    page: 3,
    perPage: 20,
    total: 95,
    totalPages: 5,
    offset: 40,
    limit: 20,
    from: 41,
    to: 60,
    hasPrev: true,
    hasNext: true,
    prev: 2,
    next: 4,
    outOfRange: false,
  })
})

test('the last page has what is left', () => {
  const p = paginate({ total: 95, perPage: 20, page: 5 })
  expect(p).toMatchObject({
    from: 81,
    to: 95,
    hasNext: false,
    next: null,
    prev: 4,
  })
  expect(paginate({ total: 100, perPage: 20, page: 5 })).toMatchObject({
    from: 81,
    to: 100,
    totalPages: 5,
  })
})

test('nothing to show is still one page', () => {
  expect(paginate({ total: 0, perPage: 20 })).toMatchObject({
    page: 1,
    totalPages: 1,
    from: 0,
    to: 0,
    offset: 0,
    hasPrev: false,
    hasNext: false,
    pages: [1],
  })
})

test('pages that do not exist are the last one, and say so', () => {
  const p = paginate({ total: 30, perPage: 10, page: 99 })
  expect(p).toMatchObject({
    page: 3,
    requestedPage: 99,
    outOfRange: true,
    offset: 20,
  })
})

test('anything that is not a page number is the first page', () => {
  for (const bad of [
    undefined,
    null,
    '',
    'abc',
    '-1',
    '0',
    0,
    -3,
    1.5,
    NaN,
    '1.5',
    [2],
    {},
    '1e3',
    '99999999999999999999',
  ]) {
    expect(toPage(bad)).toBe(1)
  }
  expect(toPage(7)).toBe(7)
  expect(toPage('7')).toBe(7)
  expect(toPage(' 7 ')).toBe(7)
  expect(paginate({ total: 100, perPage: 10, page: 'abc' }).page).toBe(1)
})

test('bad totals and sizes are made safe', () => {
  expect(paginate({ total: -5, perPage: 10 }).total).toBe(0)
  expect(paginate({ total: NaN, perPage: 10 }).total).toBe(0)
  expect(paginate({ total: 10.9, perPage: 10 }).total).toBe(10)
  expect(paginate({ total: 10, perPage: 0 }).perPage).toBe(1)
  expect(paginate({ total: 10, perPage: -3 }).perPage).toBe(1)
})

test('the window of pages', () => {
  expect(pageWindow(1, 1)).toEqual([1])
  expect(pageWindow(1, 5)).toEqual([1, 2, null, 5])
  expect(pageWindow(3, 5)).toEqual([1, 2, 3, 4, 5])
  expect(pageWindow(1, 20)).toEqual([1, 2, null, 20])
  expect(pageWindow(10, 20)).toEqual([1, null, 9, 10, 11, null, 20])
  expect(pageWindow(20, 20)).toEqual([1, null, 19, 20])
  expect(pageWindow(4, 20)).toEqual([1, 2, 3, 4, 5, null, 20])
  expect(pageWindow(3, 20)).toEqual([1, 2, 3, 4, null, 20])
  expect(pageWindow(17, 20)).toEqual([1, null, 16, 17, 18, 19, 20])
})

test('a gap of one page is filled in, not hidden', () => {
  expect(pageWindow(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7])
  expect(pageWindow(5, 7)).toEqual([1, null, 4, 5, 6, 7])
  expect(pageWindow(1, 4)).toEqual([1, 2, 3, 4])
  expect(pageWindow(1, 3)).toEqual([1, 2, 3])
})

test('the window can be wider', () => {
  expect(pageWindow(10, 20, 2, 1)).toEqual([
    1,
    null,
    8,
    9,
    10,
    11,
    12,
    null,
    20,
  ])
  expect(pageWindow(10, 30, 1, 2)).toEqual([
    1,
    2,
    null,
    9,
    10,
    11,
    null,
    29,
    30,
  ])
  expect(pageWindow(10, 20, 0, 1)).toEqual([1, null, 10, null, 20])
})

test('page links keep the rest of the query string as it was', () => {
  expect(pageUrl('/blog', '', 'page', 2, true)).toBe('/blog?page=2')
  expect(pageUrl('/blog', 'q=a%20b&tag=x', 'page', 3, true)).toBe(
    '/blog?q=a%20b&tag=x&page=3'
  )
  expect(pageUrl('/blog', 'page=2&q=x', 'page', 3, true)).toBe(
    '/blog?q=x&page=3'
  )
  expect(pageUrl('/blog', 'q=x&page=2&page=5', 'page', 1, true)).toBe(
    '/blog?q=x'
  )
  expect(pageUrl('/blog', 'page=2', 'page', 1, true)).toBe('/blog')
  expect(pageUrl('/blog', 'page=2', 'page', 1, false)).toBe('/blog?page=1')
  expect(pageUrl('/blog', 'pages=2&p=1', 'page', 4, true)).toBe(
    '/blog?pages=2&p=1&page=4'
  )
  expect(pageUrl('/blog', '&&q=1&', 'p', 2, true)).toBe('/blog?q=1&p=2')
  expect(pageUrl('/', 'flag', 'page', 2, true)).toBe('/?flag&page=2')
})

const link = (page: number) => `/blog?page=${page}`

test('a nav lists the pages and marks the one you are on', () => {
  const html = renderNav(paginate({ total: 200, perPage: 10, page: 10 }), link)
  expect(html).toBe(
    '<nav class="pagination" aria-label="Pagination">' +
      '<a class="page" href="/blog?page=9" rel="prev">‹ Previous</a>' +
      '<a class="page" href="/blog?page=1">1</a>' +
      '<span class="gap" aria-hidden="true">…</span>' +
      '<a class="page" href="/blog?page=9">9</a>' +
      '<a class="page current" href="/blog?page=10" aria-current="page">10</a>' +
      '<a class="page" href="/blog?page=11">11</a>' +
      '<span class="gap" aria-hidden="true">…</span>' +
      '<a class="page" href="/blog?page=20">20</a>' +
      '<a class="page" href="/blog?page=11" rel="next">Next ›</a>' +
      '</nav>'
  )
})

test('previous and next are not links at the ends', () => {
  const first = renderNav(paginate({ total: 30, perPage: 10, page: 1 }), link)
  expect(first).toContain(
    '<span class="page disabled" aria-disabled="true">‹ Previous</span>'
  )
  expect(first).toContain('rel="next"')
  const last = renderNav(paginate({ total: 30, perPage: 10, page: 3 }), link)
  expect(last).toContain(
    '<span class="page disabled" aria-disabled="true">Next ›</span>'
  )
  expect(last).toContain('rel="prev"')
})

test('there is no nav for a single page', () => {
  expect(renderNav(paginate({ total: 5, perPage: 10 }), link)).toBe('')
})

test('a nav can say it in other words and wear other classes', () => {
  const html = renderNav(paginate({ total: 200, perPage: 10, page: 2 }), link, {
    label: 'Páginas',
    prev: 'Anterior',
    next: 'Siguiente',
    classes: {
      nav: 'pager',
      item: 'btn',
      current: 'active',
      disabled: '',
      gap: '',
    },
  })
  expect(html).toContain('<nav class="pager" aria-label="Páginas">')
  expect(html).toContain(
    '<a class="btn" href="/blog?page=1" rel="prev">Anterior</a>'
  )
  expect(html).toContain(
    '<a class="btn active" href="/blog?page=2" aria-current="page">2</a>'
  )
  expect(html).toContain('>Siguiente</a>')
  expect(html).toContain('<span aria-hidden="true">…</span>')
})

test('urls and texts in a nav are escaped', () => {
  const html = renderNav(
    paginate({ total: 30, perPage: 10, page: 2 }),
    (p) => `/blog?q="x"&a=<b>&page=${p}`,
    { prev: '<b>', label: 'a"b' }
  )
  expect(html).toContain(
    'href="/blog?q=&quot;x&quot;&amp;a=&lt;b&gt;&amp;page=1"'
  )
  expect(html).toContain('&lt;b&gt;')
  expect(html).toContain('aria-label="a&quot;b"')
  expect(html).not.toContain('<b>')
})
