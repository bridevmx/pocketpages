import { expect, test } from 'bun:test'
import { fingerprint } from './fingerprint'
import { buildRouteIndex, matchRoute, resolveRoute } from './resolveRoute'

globalThis.$filepath = {
  toSlash: (s: string) => s.replace(/\\/g, '/'),
} as any

/**
 * What routing is meant to do, written the slow way: every page has one address, which
 * is the segments of its file, `index` left out. Routes with more literal segments win.
 */
const referenceResolve = (pathname: string, routes: any[]) => {
  if (pathname.includes('\\')) return null
  const urlPath = pathname.slice(1)
  const slash = urlPath.endsWith('/')
  if (urlPath.startsWith('/') || urlPath.includes('//')) return null
  const urlParts = urlPath.split('/').filter((p) => p)

  const specificity = (route: any) =>
    route.segments.reduce(
      (acc: number, segment: any) => acc + (segment.paramName ? 1 : 10),
      0
    )
  const sortedRoutes = routes
    .map((route, position) => ({ route, position }))
    .sort(
      (a, b) =>
        specificity(b.route) - specificity(a.route) || a.position - b.position
    )
    .map((r) => r.route)

  const isIndexPage = (route: any) => {
    const last = route.segments[route.segments.length - 1]
    return (
      !!last && !route.isStatic && !last.paramName && last.nodeName === 'index'
    )
  }

  for (const asIndex of [false, true]) {
    const parts = asIndex ? urlParts.concat('index') : urlParts
    for (const route of sortedRoutes) {
      if (isIndexPage(route) !== asIndex) continue
      if (route.segments.length !== parts.length) continue
      const matched = route.segments.every((segment: any, i: number) => {
        if (segment.paramName) return true
        const last = i === route.segments.length - 1
        return (
          segment.nodeName === parts[i] ||
          (last &&
            route.isStatic &&
            fingerprint(segment.nodeName, route.fingerprint) === parts[i])
        )
      })
      if (matched) {
        const params: Record<string, any> = {}
        route.segments.forEach((segment: any, i: number) => {
          if (segment.paramName) params[segment.paramName] = parts[i]!
        })
        // `/app.css/` is not a way to write the file
        if (slash && route.isStatic) return null
        return { route, params }
      }
    }
  }
  return null
}

// Small deterministic PRNG so failures can be reproduced
const mulberry32 = (seed: number) => () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const NAMES = ['a', 'b', 'c', 'index', 'new', 'x.css', 'img.png']
const PARAMS = ['id', 'slug']

const makeRoutes = (random: () => number) => {
  const count = 1 + Math.floor(random() * 12)
  const routes: any[] = []
  for (let r = 0; r < count; r++) {
    const length = Math.floor(random() * 4) // zero segment routes are legal too
    const segments: any[] = []
    for (let i = 0; i < length; i++) {
      if (random() < 0.3) {
        const paramName = PARAMS[Math.floor(random() * PARAMS.length)]!
        segments.push({ nodeName: `[${paramName}]`, paramName })
      } else {
        segments.push({ nodeName: NAMES[Math.floor(random() * NAMES.length)]! })
      }
    }
    routes.push({
      relativePath: `route-${r}`,
      segments,
      isStatic: random() < 0.5,
      fingerprint: ['f1', 'f2'][Math.floor(random() * 2)]!,
    })
  }
  return routes
}

const makePath = (random: () => number, routes: any[]) => {
  const length = Math.floor(random() * 5)
  const parts: string[] = []
  for (let i = 0; i < length; i++) {
    const pick = random()
    if (pick < 0.15) {
      // A fingerprinted file name, as asset() would generate
      const route = routes[Math.floor(random() * routes.length)]!
      const last = route.segments[route.segments.length - 1]
      parts.push(
        last && !last.paramName
          ? fingerprint(last.nodeName, route.fingerprint)
          : 'x'
      )
    } else if (pick < 0.3) {
      parts.push(['v1', '42', 'hello'][Math.floor(random() * 3)]!)
    } else {
      parts.push(NAMES[Math.floor(random() * NAMES.length)]!)
    }
  }
  const trailing = random() < 0.15 ? '/' : ''
  const doubled = random() < 0.1 ? '/' : ''
  return '/' + parts.join('/' + doubled) + trailing
}

test('the route index resolves exactly like the plain description of routing', () => {
  let checked = 0
  let matched = 0
  for (let seed = 1; seed <= 400; seed++) {
    const random = mulberry32(seed)
    const routes = makeRoutes(random)
    const index = buildRouteIndex(routes)
    for (let n = 0; n < 60; n++) {
      const pathname = makePath(random, routes)
      const expected = referenceResolve(pathname, routes)
      const actual = resolveRoute({ pathname, query: {} } as any, routes)
      checked++
      if (expected) matched++
      expect(actual?.route.relativePath ?? null).toBe(
        expected?.route.relativePath ?? null
      )
      if (expected) {
        // [param] values are merged into the query, nothing else may be in there
        expect({ ...actual!.params }).toEqual(expected.params)
      }
      // The index itself, without going through resolveRoute()
      expect(matchRoute(index, pathname)?.route.relativePath ?? null).toBe(
        expected?.route.relativePath ?? null
      )
    }
  }
  // Make sure the generated cases are not all misses
  expect(matched).toBeGreaterThan(checked / 10)
})

test('path params are merged into the query without disturbing it', () => {
  const routes = [
    {
      relativePath: 'posts/[id]',
      segments: [{ nodeName: 'posts' }, { nodeName: '[id]', paramName: 'id' }],
      isStatic: false,
      fingerprint: 'f',
    },
  ]
  const query = { page: 2, id: 'overridden' }
  const result = resolveRoute(
    { pathname: '/posts/7', query } as any,
    routes as any
  )
  expect(result!.params).toBe(query)
  expect(query).toEqual({ page: 2, id: '7' })
})

test('reports whether a static file was reached through its fingerprint', () => {
  const routes = [
    {
      relativePath: 'assets/app.css',
      segments: [{ nodeName: 'assets' }, { nodeName: 'app.css' }],
      isStatic: true,
      fingerprint: 'abc123',
    },
  ]
  const plain = resolveRoute(
    { pathname: '/assets/app.css', query: {} } as any,
    routes as any
  )
  const hashed = resolveRoute(
    { pathname: '/assets/app.abc123.css', query: {} } as any,
    routes as any
  )
  const stale = resolveRoute(
    { pathname: '/assets/app.nope.css', query: {} } as any,
    routes as any
  )
  expect(plain?.fingerprinted).toBe(false)
  expect(hashed?.fingerprinted).toBe(true)
  expect(stale).toBeNull()
})
