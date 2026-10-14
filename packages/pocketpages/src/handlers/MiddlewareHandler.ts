import { forEach, merge } from '@s-libs/micro-dash'
import type { SerializeOptions } from 'cookie'
import * as cookie from 'cookie'
import { error } from 'pocketbase-log'
import { stringify } from 'pocketbase-stringify'
import { fingerprint as applyFingerprint } from 'src/lib/fingerprint'
import { globalApi } from 'src/lib/globalApi'
import { getCache } from '../lib/cache'
import { dbg, isDebug } from '../lib/debug'
import { echo, mkMeta, mkResolve, pagesRoot } from '../lib/helpers'
import { couldBeJson, tryParseJson } from '../lib/json'
import { getPlugins } from '../lib/loadPlugins'
import { applyPathParams, matchRoute, RouteMatch } from '../lib/resolveRoute'
import { parseSlots } from '../lib/slots'
import {
  MiddlewareLoaderFunc,
  PagesMethods,
  PagesMiddlewareFunc,
  PagesNextFunc,
  PagesRequest,
  PagesRequestContext,
  PagesResponse,
  Plugin,
  RedirectOptions,
  Url,
} from '../lib/types'
import { quickPathname } from '../lib/url'

export { parseSlots }

const escapeXml = (unsafe: string = '') => {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '&':
        return '&amp;'
      case "'":
        return '&apos;'
      case '"':
        return '&quot;'
      default:
        return c
    }
  })
}

const defaultResponder: Plugin = {
  name: 'builtin',
  onResponse: ({ content, api, route }) => {
    const { response } = api
    response.html(200, content)
    return true
  },
}

/**
 * Served for URLs that carry the content hash of the file: they never change, so the
 * browser and any CDN in front can keep them for good.
 */
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'

const MAX_REMEMBERED_ASSETS = 5000

export const MiddlewareHandler: PagesMiddlewareFunc = (e) => {
  const next: PagesNextFunc = () => {
    e.next()
  }
  if (!e.request) {
    dbg(`No request, passing on to PocketBase`)
    return next()
  }

  const { method, url } = e.request

  // dbg({ method, url })

  if (!url) {
    dbg(`No URL, passing on to PocketBase`)
    return next()
  }

  const cache = getCache()
  const { config, index } = cache
  const { plugins, hasOnRequest } = getPlugins(cache)

  const rawUrl = url.string()
  if (isDebug()) {
    dbg(`Pages middleware request: ${method} ${rawUrl}`)
  }

  /**
   * Most requests that reach this middleware are not for a page at all (PocketBase API
   * calls, the admin UI, files...). When no plugin wants to look at those, a URL that
   * no route claims goes straight back to PocketBase without building anything.
   */
  let pathname = quickPathname(rawUrl)
  let match: RouteMatch | null | undefined =
    pathname === undefined ? undefined : matchRoute(index, pathname)
  if (match === null && !hasOnRequest) {
    if (isDebug())
      dbg(`No route matched for ${rawUrl}, passing on to PocketBase`)
    return next()
  }

  /**
   * The request URL is only parsed when something asks for it
   */
  let parsedUrl: Url | undefined
  const request: PagesRequest = {
    event: e,
    auth: e.auth,
    method: method.toUpperCase() as PagesMethods,
    get url() {
      if (!parsedUrl) {
        parsedUrl = globalApi.url(rawUrl)
      }
      return parsedUrl
    },
    set url(value: Url) {
      parsedUrl = value
    },
    formData: () => e.requestInfo().body,
    body: () => e.requestInfo().body,
    header: (name: string) => {
      return e.request?.header.get(name) || ''
    },
    cookies: (() => {
      let parsed: Record<string, any>

      const cookieFunc = <T = Record<string, any>>(name?: string): T => {
        if (!parsed) {
          const cookieHeader = request.header('Cookie')
          const rawParsed = cookie.parse(cookieHeader || '')
          // Parse all values once during initialization
          parsed = Object.fromEntries(
            Object.entries(rawParsed).map(([key, value]) => [
              key,
              tryParseJson(value),
            ])
          )
        }

        if (name === undefined) {
          return parsed as T
        }
        return parsed[name] as T
      }

      return cookieFunc as {
        <T = Record<string, any>>(): T
        <T>(name: string): T
      }
    })(),
  }

  const response: PagesResponse = {
    file: (path: string) => {
      return e.fileFS($os.dirFS($filepath.dir(path)), $filepath.base(path))
    },
    write: (s: string) => {
      e.response.write(s)
    },
    redirect: (path: string, status = 302) => {
      e.redirect(status, path)
    },
    json: (status: number, data: any) => {
      e.json(status, data)
    },
    html: (status: number, data: string) => {
      e.html(status, data)
    },
    header: (name: string, value?: string) => {
      if (value === undefined) {
        return e.response.header().get(name) || ''
      }
      if (isDebug()) dbg(`header: ${name} ${value}`)
      e.response.header().set(name, value)
      return value
    },
    cookie: <T>(
      name: string,
      value: T,
      options: Partial<SerializeOptions> = {}
    ) => {
      const _options = {
        path: '/',
        ...options,
      }
      const stringifiedValue = (() => {
        if (typeof value !== 'string') {
          return stringify(value)
        }
        return value
      })()
      const serialized = cookie.serialize(name, stringifiedValue, _options)
      response.header(`Set-Cookie`, serialized)
      return serialized
    },
  }

  if (pathname === undefined) {
    // Not a plain path, let the URL parser work out what it is
    pathname = request.url.pathname
    match = matchRoute(index, pathname)
    if (!match && !hasOnRequest) {
      if (isDebug())
        dbg(`No route matched for ${rawUrl}, passing on to PocketBase`)
      return next()
    }
  }

  if (hasOnRequest) {
    plugins.forEach((plugin) =>
      plugin.onRequest?.({
        request,
        response,
        route: match ? match.route : null,
      })
    )
    // A plugin may have rewritten the URL to send the request somewhere else
    if (parsedUrl && parsedUrl.pathname !== pathname) {
      match = matchRoute(index, parsedUrl.pathname)
    }
  }

  /**
   * If it doesn't match any known route, pass it on
   */
  if (!match) {
    // Otherwise, pass it on to PocketBase to handle
    if (isDebug())
      dbg(`No route matched for ${rawUrl}, passing on to PocketBase`)
    return next()
  }

  const { route } = match
  const { absolutePath, relativePath } = route

  try {
    /**
     * If the file exists but no plugin handles it, serve statically
     */
    if (route.isStatic) {
      if (isDebug()) dbg(`Serving static file ${absolutePath}`)
      if (match.fingerprinted && !response.header('Cache-Control')) {
        response.header('Cache-Control', IMMUTABLE_CACHE_CONTROL)
      }
      return response.file(absolutePath)
    }

    /*
    At this point, we have a route PocketPages needs to handle.
    */
    // dbg(`Found a matching route`, { resolvedRoute })

    // The query string (and the values of any [param] segments)
    const params = request.url.query
    applyPathParams(match, params)

    const api: PagesRequestContext<any> = {
      ...globalApi,
      params,
      echo: (...args) => {
        const s = echo(...args)
        response.write(s)
        if (isDebug()) dbg(`echo: ${s}`)
        return s
      },
      formData: request.formData,
      body: request.body,
      auth: request.auth,
      request,
      response,
      redirect: (path, _options) => {
        const options: RedirectOptions = {
          status: 302,
          message: '',
          ..._options,
        }
        const parsed = globalApi.url(path)
        parsed.query.__flash = options.message
        response.redirect(parsed.toString(), options.status)
      },
      slot: '',
      slots: {},
      asset: (path) => {
        // What asset() returns depends on the route and the path only
        const assetKey = `${relativePath}\0${path}`
        const known = cache.assets.get(assetKey)
        if (known !== undefined) return known

        const shortAssetPath = path.startsWith('/')
          ? path
          : $filepath.join(route.assetPrefix, path)
        const fullAssetPath = path.startsWith('/')
          ? path
          : $filepath.join(
              ...route.segments.slice(0, -2).map((s) => s.nodeName),
              route.assetPrefix,
              path
            )
        const assetMatch = matchRoute(
          index,
          globalApi.url(fullAssetPath).pathname
        )
        // dbg({ fullAssetPath, shortAssetPath, assetRoute })
        const assetPath = assetMatch
          ? applyFingerprint(shortAssetPath, assetMatch.route.fingerprint)
          : `${shortAssetPath}`
        // The paths come from the page, which may build them from data
        if (cache.assets.size >= MAX_REMEMBERED_ASSETS) {
          cache.assets.clear()
        }
        cache.assets.set(assetKey, assetPath)
        return assetPath
      },
      meta: mkMeta(),
      resolve: mkResolve($filepath.dir(absolutePath)),
    }

    plugins.forEach((plugin) => plugin.onExtendContextApi?.({ api, route }))

    let data = {}
    let idx = 0

    _next()

    function _next(extra: object = {}) {
      data = merge(data, extra)

      if (idx >= route.middlewares.length) {
        return done()
      }

      const maybeMiddleware = route.middlewares[idx++] as string
      const middlewareFn: MiddlewareLoaderFunc = require(maybeMiddleware)

      if (isDebug()) dbg(`Executing middleware ${maybeMiddleware}`)
      if (middlewareFn.length < 2) {
        _next(middlewareFn({ ...api, data }))
      } else {
        middlewareFn({ ...api, data }, _next)
      }
    }

    function done() {
      // Execute loaders
      {
        const methods = ['load', method.toLowerCase(), method]
        forEach(methods, (method) => {
          const loaderFname =
            route.loaders[method as keyof typeof route.loaders]
          if (!loaderFname) return
          if (isDebug()) dbg(`Executing loader ${loaderFname}`)
          data = merge(data, require(loaderFname)({ ...api, data }))
        })
      }

      api.data = data
      // dbg(`Final api:`, { params: api.params, data: api.data })

      let content = plugins.reduce((content, plugin) => {
        return (
          plugin.onRender?.({
            content,
            api,
            route,
            filePath: absolutePath,
            plugins,
          }) ?? content
        )
      }, '')

      // If the content type is not text/html, we don't need to parse it or render it in a layout
      const contentType = response.header('Content-Type')
      if (isDebug()) dbg(`Content-Type: ${contentType}`)
      if (contentType && contentType !== 'text/html') {
        if (isDebug()) dbg(`Skipping layout for non-HTML content`, content)
        return true
      }

      // Only content that looks like JSON is worth parsing (and failing to parse)
      if (typeof content !== 'string' || couldBeJson(content)) {
        try {
          if (isDebug()) dbg(`Attempting to parse as JSON`)
          const parsed = JSON.parse(content)
          response.json(200, parsed)
          return true
        } catch (e) {
          if (isDebug()) dbg(`Not JSON`)
        }
      }

      /**
       * Render the content in the layout
       */
      route.layouts.forEach((layoutPath) => {
        const res = parseSlots(content)
        api.slots = res.slots
        api.slot = res.slots.default || res.content
        content = plugins.reduce((content, plugin) => {
          return (
            plugin.onRender?.({
              content,
              api,
              route,
              filePath: layoutPath,
              plugins,
            }) ?? content
          )
        }, content)
      })

      for (const plugin of [...plugins, defaultResponder]) {
        if (plugin.onResponse?.({ content, api, route })) {
          return
        }
      }
      throw new Error(`No plugin handled the response`)
    }
  } catch (e) {
    error(e)

    if (e instanceof BadRequestError) {
      const message = config.debug ? `${e}` : 'Bad Request'
      return response.html(400, message)
    }

    // In production, don't leak error details or stack traces
    if (config.debug) {
      const message = (() => {
        const m = `${e}`
        if (m.includes('Value is not an object'))
          return `${m} - are you referencing a symbol missing from require() or resolve()?`
        return `${e}`
      })()
      const stackTrace =
        e instanceof Error
          ? e.stack
              ?.replaceAll(pagesRoot, '/' + $filepath.base(pagesRoot))
              .replaceAll(__hooks, '')
          : ''
      return response.html(
        500,
        `<html><body><h1>PocketPages Error</h1><pre><code>${escapeXml(message)}\n${escapeXml(stackTrace)}</code></pre></body></html>`
      )
    } else {
      // Generic error message in production
      return response.html(
        500,
        `<html><body><h1>Internal Server Error</h1><p>Something went wrong. Please try again later.</p></body></html>`
      )
    }
  }
}
