import { expect, test } from 'bun:test'

const { default: factory } = await import('./index')

const make = (options: Record<string, any> = {}) =>
  factory({ globalApi: {}, dbg: () => {} } as any, { debug: false, ...options })

const api = (
  path: string,
  query: string,
  params: Record<string, unknown> = {},
  options = {}
) => {
  const plugin = make(options)
  const api: any = {
    params,
    request: { event: { request: { url: { path, rawQuery: query } } } },
  }
  plugin.onExtendContextApi!({ api, route: {} as any })
  return api
}

test('unknown options are refused', () => {
  expect(() => make({ perpage: 10 })).toThrow("unknown option 'perpage'")
  expect(() => make({ pageParam: 'a b' })).toThrow('invalid parameter name')
})

test('the page comes from the query string', () => {
  const a = api('/blog', 'page=3', { page: 3 })
  const p = a.paginate({ total: 95 })
  expect(p).toMatchObject({
    page: 3,
    perPage: 20,
    offset: 40,
    limit: 20,
    totalPages: 5,
  })
  expect(p.url(4)).toBe('/blog?page=4')
  expect(p.prevUrl).toBe('/blog?page=2')
  expect(p.nextUrl).toBe('/blog?page=4')
  expect(p.url(1)).toBe('/blog')
})

test('other parameters of the query string stay', () => {
  const a = api('/blog/', 'q=hello%20world&page=2', {
    q: 'hello world',
    page: 2,
  })
  const p = a.paginate({ total: 100, perPage: 10 })
  expect(p.url(3)).toBe('/blog/?q=hello%20world&page=3')
  expect(p.url(1)).toBe('/blog/?q=hello%20world')
})

test('links follow the address the visitor used', () => {
  // A plugin may have rewritten the URL the page is served from; links must not
  const a = api('/es/blog', '', {})
  expect(a.paginate({ total: 100, perPage: 10 }).url(2)).toBe('/es/blog?page=2')
})

test('the page and size can be given by the page', () => {
  const a = api('/x', 'page=9', { page: 9 })
  expect(a.paginate({ total: 100, perPage: 10, page: 2 }).page).toBe(2)
  expect(a.paginate({ total: 100, perPage: 5 }).perPage).toBe(5)
})

test('visitors choose how many items per page only if allowed', () => {
  const a = api('/x', 'size=50', { size: 50 })
  expect(a.paginate({ total: 500 }).perPage).toBe(20)
  expect(a.paginate({ total: 500, perPageParam: 'size' }).perPage).toBe(50)
  const huge = api('/x', 'size=5000', { size: 5000 })
  expect(huge.paginate({ total: 9000, perPageParam: 'size' }).perPage).toBe(100)
  const junk = api('/x', 'size=abc', { size: 'abc' })
  expect(junk.paginate({ total: 500, perPageParam: 'size' }).perPage).toBe(1)
})

test('options of the plugin are the defaults', () => {
  const a = api(
    '/x',
    'p=2',
    { p: 2 },
    { pageParam: 'p', perPage: 5, maxPerPage: 10, omitFirstPage: false }
  )
  const p = a.paginate({ total: 100 })
  expect(p).toMatchObject({ page: 2, perPage: 5 })
  expect(p.url(1)).toBe('/x?p=1')
  expect(p.url(3)).toBe('/x?p=3')
})

test('the nav is made from the same links', () => {
  const a = api('/blog', 'page=2', { page: 2 })
  const html = a.paginate({ total: 30, perPage: 10 }).nav({ prev: 'Back' })
  expect(html).toContain('href="/blog" rel="prev">Back</a>')
  expect(html).toContain('href="/blog?page=3" rel="next"')
  expect(a.paginate({ total: 5 }).nav()).toBe('')
})
