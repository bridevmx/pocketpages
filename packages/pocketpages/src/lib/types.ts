import { SerializeOptions } from 'cookie'
import * as log from 'pocketbase-log'
import { stringify } from 'pocketbase-stringify'
import { default as parse } from 'url-parse'
import { Route } from '../handlers/AfterBootstrapHandler'

export type PageDataLoaderFunc<TData = any> = (
  api: Omit<PagesRequestContext<TData>, 'data'>
) => object

export type MiddlewareNextFunc = (data?: object) => void

export type MiddlewareLoaderFunc<TData = any> = (
  api: PagesRequestContext<TData>,
  next?: MiddlewareNextFunc
) => object

export type PagesParams = Record<string, string | string[] | undefined>

export type Url = ReturnType<typeof parse<PagesParams>>
export type PagesGlobalContext = {
  url: (url: string) => Url
  stringify: typeof stringify
  env: (key: string) => string
  store: {
    <T>(name: string, value: T): T
    (name: string): any
  }
  /**
   * A key of 64 hexadecimal characters that belongs to this app and to `purpose`,
   * stable across restarts. It comes from the `POCKETPAGES_SECRET` environment
   * variable when that is set, and from the secret PocketBase signs the tokens of
   * superusers with otherwise. Keys made for different purposes are unrelated.
   */
  secret: (purpose: string) => string
  /**
   * Returns `value.signature`. Anyone can read the value, only this app can have
   * produced the signature.
   */
  sign: (value: string, purpose?: string) => string
  /**
   * The value that `sign()` was given, or `undefined` when the signature is not the
   * one this app would have made for `purpose`
   */
  unsign: (signed: string, purpose?: string) => string | undefined
  /**
   * Makes a function that tells whether a URL path matches any of the patterns, where
   * `*` stands for one segment and `**` for any number of them: `/blog/**` matches
   * `/blog`, `/blog/` and `/blog/2024/a-post`. Make it once, not for every request.
   */
  pathMatcher: (patterns: string | string[]) => (pathname: string) => boolean
} & typeof log

export type ResolveOptions = {
  mode: 'raw' | 'require' | 'script' | 'style'
}

export type RedirectOptions = {
  status: number
  message: string
}

export type PagesRequestContext<TData = any> = {
  asset: (path: string) => string
  auth?: core.Record
  data?: TData
  echo: (...args: any[]) => string
  formData: Record<string, any>
  body: () => Record<string, any> | string
  meta: (key: string, value?: string) => string | undefined
  params: PagesParams
  redirect: (path: string, options?: Partial<RedirectOptions>) => void
  request: PagesRequest
  resolve: (path: string, options?: Partial<ResolveOptions>) => any
  response: PagesResponse
  slot: string
  slots: Record<string, string>
} & PagesGlobalContext

export type PluginFactoryConfig = {
  pagesRoot: string
  config: PagesConfig
  globalApi: PagesGlobalContext & { [_: string]: any }
  routes: Route[]
  dbg: typeof log.dbg
}

export type PluginContextBase = {
  route: Route
}

export type HandlesContext = {
  route: Route
  filePath: string
}

export type RenderContext = PluginContextBase & {
  api: PagesRequestContext
  content: string
  filePath: string
  plugins: Plugin[]
}

export type ExtendContextApiContext = PluginContextBase & {
  api: PagesRequestContext & { [_: string]: any }
}

export type AfterRenderContext = PluginContextBase & {
  api: PagesRequestContext
  /** The page, with all of its layouts applied */
  content: string
}

export type ResponseContext = PluginContextBase & {
  api: PagesRequestContext
  content: string
}

export type ErrorContext = {
  /** Whatever was thrown */
  error: unknown
  /**
   * The HTTP status the error stands for: the one of PocketBase's error classes
   * (`NotFoundError`, `ForbiddenError`, `new ApiError(418, ...)`...), 500 for anything
   * else
   */
  status: number
  request: PagesRequest
  response: PagesResponse
  /** `null` when no route matches the request */
  route: Route | null
  /**
   * The context API pages get. Only there when the error happened while a page was
   * being served, after the plugins had extended it.
   */
  api?: PagesRequestContext
}

export type RequestContext = {
  request: PagesRequest
  response: PagesResponse
  /**
   * The route this request is going to be served by, `null` when none matches (the
   * request then goes on to PocketBase), and `undefined` if the core could not tell.
   */
  route?: Route | null
}

export type Plugin = {
  name: string
  /**
   * Return `true` when the plugin has answered the request itself. Nothing else runs
   * for it then: the plugins after this one, the page, PocketBase.
   */
  onRequest?: (context: RequestContext) => void | boolean
  onRender?: (context: RenderContext) => string
  handles?: (context: HandlesContext) => boolean
  onExtendContextApi?: (context: ExtendContextApiContext) => void
  /**
   * Called with the HTML of a page once its layouts are applied, right before it is
   * sent. Return the HTML to send instead, or nothing to leave it as it is.
   */
  onAfterRender?: (context: AfterRenderContext) => string | void
  onResponse?: (context: ResponseContext) => boolean
  /**
   * Called when something went wrong while serving a request. Return `true` once the
   * plugin has sent a response, or nothing to leave it to the next plugin and, if none
   * does, to PocketPages.
   */
  onError?: (context: ErrorContext) => void | boolean
}

export type PluginOptionsBase = {
  debug: boolean
}

export type PluginFactory<
  TExtra extends PluginOptionsBase = PluginOptionsBase,
> = (
  config: PluginFactoryConfig,
  extra: Partial<TExtra> & PluginOptionsBase
) => Plugin

export type PluginOptions = {
  [key: string]: any
} & PluginOptionsBase

export type PluginConfigItem = {
  fn: PluginFactory
} & PluginOptions

export type PluginConfigItemShortHand =
  | string
  | ({ name: string; [key: string]: any } & PluginOptionsBase)
  | PluginFactory
  | Partial<PluginConfigItem>

export type PagesConfig = {
  plugins: PluginConfigItemShortHand[]
  debug: boolean | 'verbose'
  /**
   * Remember file lookups and file contents (templates, `resolve()`d modules) instead
   * of going to the disk on every request. Defaults to `true` unless PocketBase runs
   * with `--dev`.
   */
  cache?: boolean
}

export type Cache = { routes: Route[]; config: PagesConfig }

export type PagesMethods =
  | 'GET'
  | 'HEAD'
  | 'POST'
  | 'PUT'
  | 'DELETE'
  | 'PATCH'
  | 'OPTIONS'

export type PagesRequest = {
  event: core.RequestEvent
  auth?: core.Record
  authToken?: string
  /**
   * The method pages and loaders are picked by. Plugins may change it (an HTML form can
   * only send `GET` and `POST`, so a hidden field is how it asks for `DELETE`).
   */
  method: PagesMethods
  /**
   * Room for plugins to leave things for each other, and for the pages, during one
   * request. Starts empty. Use the name of your plugin as key.
   */
  state: Record<string, any>
  /**
   * The path of the URL (`/blog/a-post`), without the query string. Much cheaper than
   * `url.pathname`, which has the whole URL parsed. It follows `url` when a plugin
   * replaces it.
   */
  readonly pathname: string
  /**
   * The address of the client, as PocketBase works it out. It looks at the headers of
   * the proxies you list as trusted in the settings, and at nothing else.
   */
  readonly ip: string
  /** True when the request came in over HTTPS, directly or through a proxy that says so */
  readonly secure: boolean
  url: Url
  formData: () => Record<string, any>
  body: () => Record<string, any> | string
  header: (name: string) => string
  cookies: {
    (): Record<string, string | undefined>
    <T>(name: string): T | undefined
  }
}

export type PagesResponse = {
  file: (path: string) => void
  write: (s: string) => void
  redirect: (path: string, status?: number) => void
  json: (status: number, data: any) => void
  html: (status: number, data: string) => void
  /** Plain text, or the type set with `header('Content-Type', ...)` */
  text: (status: number, data: string) => void
  /** Only a status and headers, 204 unless told otherwise (304 is the other usual one) */
  noContent: (status?: number) => void
  header: (name: string, value?: string) => string | undefined
  /**
   * Adds a header without replacing the ones with the same name already there, for the
   * headers that can be sent more than once (`Link`, `Vary`...)
   */
  addHeader: (name: string, value: string) => void
  /**
   * Cookies set during a request are all sent. Setting a cookie again replaces the one
   * set earlier with the same name.
   */
  cookie: <T>(
    name: string,
    value: T,
    options?: Partial<SerializeOptions>
  ) => void
  /**
   * Runs `callback` right before the response goes out, so that cookies and headers
   * can still be set after the page has rendered (a session that changed while the page
   * was running is saved this way). It also runs when the request is handed to
   * PocketBase. Callbacks run in the order they were added, each of them once.
   */
  beforeSend: (callback: () => void) => void
  /** True once something has been written, a redirect or `echo()` for instance */
  sent: () => boolean
  /**
   * The status of the page when it is sent, `200` unless changed (a form that did not
   * validate is a `422`, a post that is not there a `404`). Called without a code it
   * only tells what it is now.
   */
  status: (code?: number) => number
}
export type PagesInitializerFunc = (e: core.BootstrapEvent) => void
export type PagesNextFunc = () => void

export type PagesMiddlewareFunc = (e: core.RequestEvent) => void
