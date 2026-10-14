import { Route } from '../handlers/AfterBootstrapHandler'
import { fingerprint } from './fingerprint'
import { PagesParams, Url } from './types'

export type ResolvedRoute = {
  route: Route
  params: PagesParams
  /**
   * True when the URL matched through the content fingerprint of a static file
   * (`app.<sha256>.css`) instead of the plain file name.
   */
  fingerprinted?: boolean
}

type IndexedRoute = {
  route: Route
  /** Position in the specificity ordering, lower wins */
  order: number
}

/**
 * A node of the route tree: the routes whose first N segments are the path from the
 * root down to here.
 */
type RouteNode = {
  /** Where each literal segment leads */
  statics: Map<string, RouteNode> | undefined
  /** Where a `[param]` segment leads, whatever its name */
  param: RouteNode | undefined
  /** Routes that end at this node */
  routes: IndexedRoute[] | undefined
  /**
   * Static files that end one segment below this node, by their fingerprinted file
   * name (`app.<sha256>.css`), which is how URLs refer to them
   */
  fingerprinted: Map<string, IndexedRoute[]> | undefined
}

/**
 * Routes organised as a tree on their segments, so that looking a URL up costs about as
 * much as the URL has segments, however many routes there are.
 */
export type RouteIndex = {
  root: RouteNode
}

export type RouteMatch = {
  route: Route
  /** The request path split in segments, used to pick up `[param]` values */
  parts: string[]
  fingerprinted: boolean
}

const newNode = (): RouteNode => ({
  statics: undefined,
  param: undefined,
  routes: undefined,
  fingerprinted: undefined,
})

/**
 * Routes with more literal segments are tried first, so that `products/new` wins over
 * `products/[id]`. Ties keep their original order.
 */
const getSpecificity = (route: Route) => {
  let specificity = 0
  for (let i = 0; i < route.segments.length; i++) {
    specificity += route.segments[i]!.paramName ? 1 : 10
  }
  return specificity
}

export const buildRouteIndex = (routes: Route[]): RouteIndex => {
  const sorted = routes
    .map((route, position) => ({
      route,
      position,
      specificity: getSpecificity(route),
    }))
    .sort((a, b) => b.specificity - a.specificity || a.position - b.position)

  const root = newNode()
  sorted.forEach(({ route }, order) => {
    const indexed: IndexedRoute = { route, order }
    const { segments } = route
    let node = root
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]!
      if (segment.paramName) {
        if (!node.param) node.param = newNode()
        node = node.param
        continue
      }
      if (i === segments.length - 1 && route.isStatic) {
        const name = fingerprint(segment.nodeName, route.fingerprint)
        if (!node.fingerprinted) node.fingerprinted = new Map()
        const list = node.fingerprinted.get(name)
        if (list) {
          list.push(indexed)
        } else {
          node.fingerprinted.set(name, [indexed])
        }
      }
      if (!node.statics) node.statics = new Map()
      let child = node.statics.get(segment.nodeName)
      if (!child) {
        child = newNode()
        node.statics.set(segment.nodeName, child)
      }
      node = child
    }
    if (!node.routes) node.routes = []
    node.routes.push(indexed)
  })

  return { root }
}

const splitPath = (path: string) =>
  (path.indexOf('\\') === -1 ? path : $filepath.toSlash(path))
    .split('/')
    .filter((p) => p)

type Search = {
  parts: string[]
  best: IndexedRoute | undefined
  fingerprinted: boolean
}

const consider = (search: Search, candidate: IndexedRoute, via: boolean) => {
  if (!search.best || candidate.order < search.best.order) {
    search.best = candidate
    search.fingerprinted = via
  }
}

/**
 * Walks every way `parts` can be matched, keeping the most specific route found. A
 * route matches when its segments match the first segments of the path (the path may
 * continue past them), `[param]` segments match anything, even a path that ran out.
 */
const visit = (search: Search, node: RouteNode, depth: number) => {
  if (node.routes) {
    for (let i = 0; i < node.routes.length; i++) {
      consider(search, node.routes[i]!, false)
    }
  }
  const part = search.parts[depth]
  if (part !== undefined) {
    const child = node.statics?.get(part)
    if (child) visit(search, child, depth + 1)
    const fingerprinted = node.fingerprinted?.get(part)
    if (fingerprinted) {
      for (let i = 0; i < fingerprinted.length; i++) {
        consider(search, fingerprinted[i]!, true)
      }
    }
  }
  if (node.param) visit(search, node.param, depth + 1)
}

const matchParts = (index: RouteIndex, parts: string[]): RouteMatch | null => {
  // Most requests that get here are not for a page. Nothing at the root can match them
  // when there is no [param] first segment and no route has the first segment of the
  // path as its own, so there is nothing to search.
  const { root } = index
  if (!root.param && !root.routes) {
    const first = parts[0]
    if (
      first === undefined ||
      (!root.statics?.has(first) && !root.fingerprinted?.has(first))
    ) {
      return null
    }
  }

  const search: Search = { parts, best: undefined, fingerprinted: false }
  visit(search, root, 0)
  return search.best
    ? {
        route: search.best.route,
        parts,
        fingerprinted: search.fingerprinted,
      }
    : null
}

/**
 * Finds the route that handles `pathname` (the path of the request URL, starting with
 * `/`). `docs/guide` is looked up as `docs/guide` first and as `docs/guide/index` next.
 */
export const matchRoute = (
  index: RouteIndex,
  pathname: string
): RouteMatch | null => {
  const urlPath = pathname.slice(1)
  const first = urlPath || 'index'
  const parts = splitPath(first)
  const match = matchParts(index, parts)
  if (match || first === 'index') return match
  // `${urlPath}/index` splits into the same segments plus `index`
  return matchParts(index, parts.concat('index'))
}

/**
 * The address a route is known by: `/account` for requests to `/account`, `/account/index`
 * and `/account/anything`, with the values of its `[param]` segments in place.
 *
 * Several URLs lead to one route: the path may continue past the segments of the route,
 * `index` can be spelled out, and static files also answer to their fingerprinted name.
 * Rules about who may go where have to hold for this address as well as for the URL, or
 * `/account/index` would not be covered by a rule for `/account`.
 */
export const canonicalPathOf = (match: RouteMatch): string => {
  const { segments } = match.route
  // A `[param]` that found no part in the path leaves the address shorter
  const used = match.parts.slice(0, segments.length)
  if (used.length === segments.length && used.length > 0) {
    const last = segments[segments.length - 1]!
    if (match.route.isStatic) {
      used[used.length - 1] = last.nodeName
    } else if (!last.paramName && last.nodeName === 'index') {
      used.pop()
    }
  }
  return '/' + used.join('/')
}

/**
 * `canonicalPathOf()` for a URL path: the path itself when no route claims it
 */
export const canonicalPathFor = (
  index: RouteIndex,
  pathname: string
): string => {
  const match = matchRoute(index, pathname)
  return match ? canonicalPathOf(match) : pathname
}

/**
 * Copies the values of the `[param]` segments of a matched route into `params`.
 */
export const applyPathParams = (match: RouteMatch, params: PagesParams) => {
  const { segments } = match.route
  for (let i = 0; i < segments.length; i++) {
    const { paramName } = segments[i]!
    if (paramName) {
      params[paramName] = match.parts[i]!
    }
  }
}

const indexes = new WeakMap<Route[], RouteIndex>()

/**
 * Resolves `url` against `routes`. Path params are merged into (and returned as)
 * `url.query`.
 */
export const resolveRoute = (
  url: Url,
  routes: Route[]
): ResolvedRoute | null => {
  let index = indexes.get(routes)
  if (!index) {
    index = buildRouteIndex(routes)
    indexes.set(routes, index)
  }
  const match = matchRoute(index, url.pathname)
  if (!match) return null

  const params: PagesParams = url.query
  applyPathParams(match, params)
  return { route: match.route, params, fingerprinted: match.fingerprinted }
}
