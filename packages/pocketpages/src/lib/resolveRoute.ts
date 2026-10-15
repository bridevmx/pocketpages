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
  /** A page named `index`, which answers for its folder: `docs/index.ejs` is `/docs` */
  isIndex: boolean
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
    const indexed: IndexedRoute = { route, order, isIndex: isIndexPage(route) }
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

const splitPath = (path: string) => path.split('/').filter((p) => p)

type Search = {
  parts: string[]
  /** Best route whose segments are the parts of the path */
  best: IndexedRoute | undefined
  fingerprinted: boolean
  /** Best `index` page of the folder the path names */
  bestIndex: IndexedRoute | undefined
}

/** `docs/index.ejs`, which answers for `/docs` and never for `/docs/index` */
const isIndexPage = (route: Route) => {
  const last = route.segments[route.segments.length - 1]
  return (
    !!last && !route.isStatic && !last.paramName && last.nodeName === 'index'
  )
}

const consider = (search: Search, candidate: IndexedRoute, via: boolean) => {
  if (!search.best || candidate.order < search.best.order) {
    search.best = candidate
    search.fingerprinted = via
  }
}

/**
 * Walks every way `parts` can be matched, keeping the most specific route found. A
 * route matches when its segments are the segments of the path, all of them: the path
 * can't have more, and `[param]` segments need a part to take. At the end of the path,
 * the `index` page of the folder it names matches too, but only when no other route does.
 */
const visit = (search: Search, node: RouteNode, depth: number) => {
  const { parts } = search
  if (depth === parts.length) {
    if (node.routes) {
      for (let i = 0; i < node.routes.length; i++) {
        const candidate = node.routes[i]!
        if (!candidate.isIndex) consider(search, candidate, false)
      }
    }
    const folder = node.statics?.get('index')
    if (folder?.routes) {
      for (let i = 0; i < folder.routes.length; i++) {
        const candidate = folder.routes[i]!
        if (
          candidate.isIndex &&
          (!search.bestIndex || candidate.order < search.bestIndex.order)
        ) {
          search.bestIndex = candidate
        }
      }
    }
    return
  }
  const part = parts[depth]!
  const child = node.statics?.get(part)
  if (child) visit(search, child, depth + 1)
  if (depth === parts.length - 1) {
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
      first === undefined
        ? !root.statics?.has('index')
        : !root.statics?.has(first) && !root.fingerprinted?.has(first)
    ) {
      return null
    }
  }

  const search: Search = {
    parts,
    best: undefined,
    fingerprinted: false,
    bestIndex: undefined,
  }
  visit(search, root, 0)
  const found = search.best ?? search.bestIndex
  return found
    ? {
        route: found.route,
        parts,
        fingerprinted: search.best !== undefined && search.fingerprinted,
      }
    : null
}

/**
 * Finds the route that handles `pathname` (the path of the request URL, starting with
 * `/`). `/docs/guide` is `docs/guide` or else `docs/guide/index`, and nothing else is:
 * every page has one address, so `/docs/guide/index`, `/docs/guide/more`, an empty
 * `[param]`, `//`, and `\` are all a 404. A trailing `/` is ignored.
 */
export const matchRoute = (
  index: RouteIndex,
  pathname: string
): RouteMatch | null => {
  if (pathname.indexOf('\\') !== -1) return null
  const urlPath = pathname.slice(1)
  // A trailing slash is ignored, but only one, and `//` is not a way to write `/`
  const slash = urlPath.endsWith('/')
  if (urlPath.indexOf('//') !== -1 || urlPath.startsWith('/')) return null
  const parts = splitPath(urlPath)
  const match = matchParts(index, parts)
  // `/app.css/` is not a way to write the file: only pages are known by their folder
  if (match && slash && match.route.isStatic) return null
  return match
}

/**
 * The address a route is known by: `/account` for requests to `/account` and
 * `/account/`, with the values of its `[param]` segments in place.
 *
 * Every page has one address. Static files are the exception: they also answer to their
 * fingerprinted name (`app.<sha256>.css`), and this is the plain one. Rules about who
 * may go where are written for this address.
 */
export const canonicalPathOf = (match: RouteMatch): string => {
  const { segments } = match.route
  const used = match.parts.slice()
  if (used.length > 0) {
    if (match.route.isStatic) {
      used[used.length - 1] = segments[segments.length - 1]!.nodeName
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
