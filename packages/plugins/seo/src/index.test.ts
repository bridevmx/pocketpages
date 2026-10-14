import { expect, test } from 'bun:test'
import { pathMatcher } from '../../../pocketpages/src/lib/pathMatch'

const g = globalThis as any
g.$app = {
  isDev: () => false,
  settings: () => ({ meta: { appURL: 'https://example.com' } }),
  store: () => ({ get: () => null, set: () => {}, remove: () => {} }),
}

const { default: factory } = await import('./index')

const head = (path: string, rawQuery = '') => {
  const plugin = factory(
    {
      globalApi: { pathMatcher },
      dbg: () => {},
      config: { cache: false, plugins: [] },
      routes: [],
    } as any,
    { debug: false, siteName: 'Example' }
  )
  const api: any = {
    request: {
      event: {
        request: {
          url: {
            // Go: the path is decoded, the escaped path is the one that was asked for
            path: decodeURIComponent(path),
            escapedPath: () => path,
            rawQuery,
          },
        },
      },
    },
  }
  plugin.onExtendContextApi!({ api, route: {} as any })
  return api.seo.head() as string
}

test('the canonical address is the one that was asked for', () => {
  const html = head('/blog/a-post', 'page=2')
  expect(html).toContain(
    '<link rel="canonical" href="https://example.com/blog/a-post">'
  )
  expect(html).toContain('content="https://example.com/blog/a-post"')
})

test('an address that decodes to somewhere else stays on the site', () => {
  // `/%2Fevil.example/x` is `//evil.example/x` once decoded, which is an address
  // elsewhere
  for (const path of ['/%2Fevil.example/x', '/%5Cevil.example/x']) {
    const html = head(path)
    expect(html).not.toContain('https://evil.example')
    expect(html).toContain(`href="https://example.com${path}"`)
  }
  // Even a path that really starts with two slashes
  expect(head('//evil.example/x')).toContain(
    'href="https://example.com/evil.example/x"'
  )
})
