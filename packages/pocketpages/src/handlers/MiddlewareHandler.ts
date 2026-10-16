import { forEach, merge } from '@s-libs/micro-dash'
import * as cookie from 'cookie'
import { error as logError } from 'pocketbase-log'
import { fingerprint as applyFingerprint } from 'src/lib/fingerprint'
import { globalApi } from 'src/lib/globalApi'
import { getCache } from '../lib/cache'
import { dbg, isDebug } from '../lib/debug'
import {
  describeError,
  getErrorStatus,
  prefersJson,
  statusText,
} from '../lib/errors'
import { echo, mkMeta, mkResolve, pagesRoot } from '../lib/helpers'
import { couldBeJson, tryParseJson } from '../lib/json'
import { getPlugins } from '../lib/loadPlugins'
import {
  applyPathParams,
  canonicalPathOf,
  matchRoute,
  RouteMatch,
} from '../lib/resolveRoute'
import { createResponse } from '../lib/response'
import { parseSlots } from '../lib/slots'
import {
  ErrorContext,
  MiddlewareLoaderFunc,
  PagesMethods,
  PagesMiddlewareFunc,
  PagesNextFunc,
  PagesRequest,
  PagesRequestContext,
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
    response.html(response.status(), content)
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
  const loaded = getPlugins(cache)
  const { plugins, hasOnRequest, requestHooks, afterRenderHooks, errorHooks } =
    loaded

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
  let match: RouteMatch | null = null
  if (pathname !== undefined) {
    match = matchRoute(index, pathname)
    if (match === null && !hasOnRequest) {
      if (isDebug())
        dbg(`No route matched for ${rawUrl}, passing on to PocketBase`)
      return next()
    }
  }

  /**
   * The request URL is only parsed when something asks for it
   */
  let parsedUrl: Url | undefined
  let canonical: { match: RouteMatch; path: string } | undefined
  const request: PagesRequest = {
    event: e,
    auth: e.auth,
    method: method.toUpperCase() as PagesMethods,
    state: {},
    get pathname() {
      return parsedUrl ? parsedUrl.pathname : pathname!
    },
    get canonicalPath() {
      if (!match) return request.pathname
      if (!canonical || canonical.match !== match) {
        canonical = { match, path: canonicalPathOf(match) }
      }
      return canonical.path
    },
    get ip() {
      return e.realIP()
    },
    get secure() {
      return (
        !!e.request?.tls ||
        /^\s*https/i.test(e.request?.header.get('X-Forwarded-Proto') || '')
      )
    },
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
      const value = e.request?.header.get(name) || ''
      // Go keeps the host of the request out of the headers
      if (value === '' && name.length === 4 && name.toLowerCase() === 'host') {
        return e.request?.host || ''
      }
      return value
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

  const { response, flush } = createResponse(e)

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

  /**
   * Set once the plugins have been through the request, if there turns out to be nothing
   * for PocketPages to serve
   */
  let passOn = false
  /**
   * The context API of the page being served, for the error hooks
   */
  let api: PagesRequestContext<any> | undefined

  try {
    if (hasOnRequest) {
      for (let i = 0; i < requestHooks.length; i++) {
        const answered = requestHooks[i]!.onRequest!({
          request,
          response,
          route: match ? match.route : null,
        })
        // A plugin may have rewritten the URL to send the request somewhere else
        if (parsedUrl && parsedUrl.pathname !== pathname) {
          pathname = parsedUrl.pathname
          match = matchRoute(index, pathname)
        }
        if (answered === true) {
          if (isDebug()) dbg(`${requestHooks[i]!.name} answered the request`)
          return
        }
      }
    }

    /**
     * If it doesn't match any known route, pass it on
     */
    if (!match) {
      if (isDebug())
        dbg(`No route matched for ${rawUrl}, passing on to PocketBase`)
      passOn = true
    } else {
      serve(match)
    }
  } catch (err) {
    return handleError(err)
  }

  if (passOn) {
    // Not inside the try block: whatever goes wrong further down the chain is for
    // PocketBase to deal with
    // A callback may have sent the response itself
    if (flush() && response.sent()) return
    return next()
  }

  function serve(match: RouteMatch) {
    const { route } = match
    const { absolutePath, relativePath } = route

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

    const pageApi: PagesRequestContext<any> = (api = {
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
        // Only a redirect that actually carries a message is for one visitor;
        // a plain redirect() must stay the address the docs promise, and
        // page-cache only bypasses caching for the ones that are marked.
        if (_options?.message !== undefined) {
          parsed.query.__flash = options.message
        }
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
          ? path.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
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
    })

    plugins.forEach((plugin) =>
      plugin.onExtendContextApi?.({ api: pageApi, route })
    )

    let data = {}
    let idx = 0

    /**
     * A middleware or a loader that redirected has said all there is to say. Rendering
     * the page now would only waste time and send its output after the redirect.
     */
    const redirected = () => {
      if (!response.sent()) return false
      const status = e.response.status?.() ?? 0
      return status >= 300 && status < 400
    }

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
        const extra = middlewareFn({ ...pageApi, data })
        if (redirected()) return
        _next(extra)
      } else {
        middlewareFn({ ...pageApi, data }, _next)
      }
    }

    function done() {
      // Execute loaders. Plugins may have changed the method, the way a form that
      // can only POST asks for a DELETE. HEAD is a GET without the body: it runs what a
      // GET runs, or whatever the loaders of GET guard would not be guarding it.
      {
        const verb =
          request.method === 'HEAD' ? 'get' : request.method.toLowerCase()
        const methods = ['load', verb]
        forEach(methods, (method) => {
          const loaderFname =
            route.loaders[method as keyof typeof route.loaders]
          if (!loaderFname || redirected()) return
          if (isDebug()) dbg(`Executing loader ${loaderFname}`)
          data = merge(data, require(loaderFname)({ ...pageApi, data }))
        })
        if (redirected()) {
          if (isDebug()) dbg(`Redirected, not rendering ${relativePath}`)
          return true
        }
      }

      pageApi.data = data
      // dbg(`Final api:`, { params: api.params, data: api.data })

      let content = plugins.reduce((content, plugin) => {
        return (
          plugin.onRender?.({
            content,
            api: pageApi,
            route,
            filePath: absolutePath,
            plugins,
          }) ?? content
        )
      }, '')

      // A template cannot be stopped half way, but what it made is not sent after a
      // redirect
      if (redirected()) {
        if (isDebug()) dbg(`Redirected while rendering ${relativePath}`)
        return true
      }

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
          response.json(response.status(), parsed)
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
        pageApi.slots = res.slots
        pageApi.slot = res.slots.default || res.content
        content = plugins.reduce((content, plugin) => {
          return (
            plugin.onRender?.({
              content,
              api: pageApi,
              route,
              filePath: layoutPath,
              plugins,
            }) ?? content
          )
        }, content)
      })

      for (let i = 0; i < afterRenderHooks.length; i++) {
        const result = afterRenderHooks[i]!.onAfterRender!({
          content,
          api: pageApi,
          route,
        })
        if (typeof result === 'string') content = result
      }

      for (let i = 0; i < plugins.length; i++) {
        if (plugins[i]!.onResponse?.({ content, api: pageApi, route })) {
          return
        }
      }
      if (defaultResponder.onResponse!({ content, api: pageApi, route })) {
        return
      }
      throw new Error(`No plugin handled the response`)
    }
  }

  /**
   * Whatever went wrong while the request was handled: plugins get to answer first
   */
  function handleError(err: unknown) {
    const status = getErrorStatus(err)
    if (status >= 500) {
      logError(err)
    } else if (isDebug()) {
      // PocketBase logs every request with its status already
      dbg(`${status} while serving ${rawUrl}: ${describeError(err)}`)
    }

    const context: ErrorContext = {
      error: err,
      status,
      request,
      response,
      route: match ? match.route : null,
      api,
    }
    for (let i = 0; i < errorHooks.length; i++) {
      try {
        if (errorHooks[i]!.onError!(context) === true) return
      } catch (hookError) {
        logError(hookError)
      }
    }

    try {
      respondWithError(err, status)
    } catch (sendError) {
      // Something in the way of sending a response (a beforeSend callback...)
      logError(sendError)
      e.html(status, statusText(status))
    }
  }

  function respondWithError(err: unknown, status: number) {
    // Requests that are not for a page get what PocketBase answers with, and so do
    // the clients that ask for JSON
    const asJson = !match || prefersJson(request.header('Accept'))

    if (status < 500) {
      const message = config.debug ? describeError(err) : statusText(status)
      if (asJson) {
        return response.json(status, { status, message, data: {} })
      }
      return response.html(status, message)
    }

    // In production, don't leak error details or stack traces
    if (config.debug) {
      const message = (() => {
        const m = `${err}`
        if (m.includes('Value is not an object'))
          return `${m} - are you referencing a symbol missing from require() or resolve()?`
        return `${err}`
      })()
      if (asJson) {
        return response.json(status, { status, message, data: {} })
      }
      const stackTrace =
        err instanceof Error
          ? err.stack
              ?.replaceAll(pagesRoot, '/' + $filepath.base(pagesRoot))
              .replaceAll(__hooks, '')
          : ''
      return response.html(
        status,
        `<html><body><h1>PocketPages Error</h1><pre><code>${escapeXml(message)}\n${escapeXml(stackTrace)}</code></pre></body></html>`
      )
    }

    // Generic error message in production
    if (asJson) {
      return response.json(status, {
        status,
        message: statusText(status),
        data: {},
      })
    }
    return response.html(
      status,
      `<html><body><h1>Internal Server Error</h1><p>Something went wrong. Please try again later.</p></body></html>`
    )
  }
}
