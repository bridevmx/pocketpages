import type {
  PagesRequest,
  PagesResponse,
  PluginFactory,
  PluginOptionsBase,
} from 'pocketpages'
import {
  DateFormats,
  dateFormatsOf,
  DateInput,
  DateNames,
  dateNamesOf,
  formatDate,
  formatNumber,
  FormatNumberOptions,
  LocaleFormat,
  NumberFormat,
  numberFormatOf,
  toDate,
} from './format'
import {
  languageOf,
  localizePath,
  matchLocale,
  normalizeLocale,
  parseAcceptLanguage,
  stripLocalePrefix,
} from './locale'
import {
  escapeHtml,
  flatten,
  interpolate,
  Message,
  Messages,
  pick,
} from './messages'

export type I18nOptions = PluginOptionsBase & {
  /** The languages of the site. The first one is the default unless `defaultLocale` says another. */
  locales: string[]
  defaultLocale: string
  /**
   * `prefix` (the default) puts the language in the address: `/es/about`. `none` leaves
   * addresses alone and goes by the cookie and the language of the browser.
   */
  strategy: 'prefix' | 'none'
  /** Put the prefix on the default language too (`/en/about`), `false` unless told otherwise */
  prefixDefault: boolean
  /** Send `/en/about` to `/about` when the default language has no prefix, `true` unless told otherwise */
  redirectDefaultPrefix: boolean
  /**
   * Send visitors who come to an address without a prefix, for the first time, to the
   * language their browser asks for. Off unless you turn it on.
   */
  autoRedirect: boolean
  /** Keep the language of the visitor in a cookie. On for `strategy: 'none'` and when `prefixDefault` or `autoRedirect` need it. */
  remember: boolean
  cookieName: string
  /** The folder with the translation files (`en.json`, `es.json`...), relative to `pb_hooks`: `locales` */
  dir: string
  /** Translations written in the config, by language. Files win over these. */
  messages: Record<string, Record<string, unknown>>
  /** Number and date formats to change, by language */
  format: Record<string, LocaleFormat>
  /** Where hreflang links point to, the `appURL` setting of PocketBase unless told otherwise */
  baseUrl: string
}

const VALID_KEYS = [
  'debug',
  'locales',
  'defaultLocale',
  'strategy',
  'prefixDefault',
  'redirectDefaultPrefix',
  'autoRedirect',
  'remember',
  'cookieName',
  'dir',
  'messages',
  'format',
  'baseUrl',
]

const RTL = ['ar', 'he', 'iw', 'fa', 'ur', 'ps', 'sd', 'yi', 'dv', 'ckb']

type Loaded = {
  messages: Messages
  numberFormat: NumberFormat
  names: DateNames
  dates: DateFormats
}

export type Translate = {
  (
    key: string,
    vars?: Record<string, unknown>,
    options?: { locale?: string }
  ): string
  /** The same, with the variables escaped for HTML, for messages that hold markup */
  html: (
    key: string,
    vars?: Record<string, unknown>,
    options?: { locale?: string }
  ) => string
  /** Whether a message exists in the language of the visitor, or the default language */
  has: (key: string) => boolean
}

export type Alternate = {
  locale: string
  /** The path of the page in that language */
  path: string
  current: boolean
}

/** What pages get as `i18n` */
export type I18n = {
  locale: string
  locales: string[]
  defaultLocale: string
  /** `ltr`, or `rtl` for Arabic, Hebrew... */
  dir: 'ltr' | 'rtl'
  t: Translate
  /** The address of `path` in a language (the one of the visitor unless told otherwise) */
  path: (path: string, locale?: string) => string
  /** The page in every language */
  alternates: () => Alternate[]
  /** `<link rel="alternate" hreflang="...">` tags for the head of the page */
  hreflang: () => string
  formatNumber: (value: number, options?: FormatNumberOptions) => string
  /** `short`, `medium`, `long`, `time` or `datetime`, or a pattern such as `D MMMM YYYY` */
  formatDate: (
    value: DateInput,
    style?: string,
    options?: { utc?: boolean }
  ) => string
}

const i18nPluginFactory: PluginFactory<I18nOptions> = (config, extra) => {
  const { globalApi, dbg } = config

  Object.keys(extra).forEach((key) => {
    if (!VALID_KEYS.includes(key)) {
      throw new Error(`pocketpages-plugin-i18n: unknown option '${key}'`)
    }
  })

  // --- options

  const locales: string[] = []
  for (const item of extra.locales ?? []) {
    const locale = normalizeLocale(String(item))
    if (!locale) {
      throw new Error(
        `pocketpages-plugin-i18n: invalid locale ${JSON.stringify(item)}`
      )
    }
    if (locales.indexOf(locale) === -1) locales.push(locale)
  }
  if (locales.length === 0) {
    throw new Error(
      'pocketpages-plugin-i18n: locales needs at least one language'
    )
  }
  const defaultLocale = extra.defaultLocale
    ? normalizeLocale(extra.defaultLocale)
    : locales[0]!
  if (!defaultLocale || locales.indexOf(defaultLocale) === -1) {
    throw new Error(
      `pocketpages-plugin-i18n: defaultLocale must be one of the locales`
    )
  }

  const strategy = extra.strategy ?? 'prefix'
  if (strategy !== 'prefix' && strategy !== 'none') {
    throw new Error(`pocketpages-plugin-i18n: unknown strategy '${strategy}'`)
  }
  const prefixDefault = extra.prefixDefault ?? false
  const redirectDefaultPrefix = extra.redirectDefaultPrefix ?? true
  const autoRedirect = extra.autoRedirect ?? false
  const remember =
    extra.remember ?? (strategy === 'none' || prefixDefault || autoRedirect)
  const cookieName = extra.cookieName ?? 'pp_lang'
  if (!/^[A-Za-z0-9_-]+$/.test(cookieName)) {
    throw new Error(
      `pocketpages-plugin-i18n: invalid cookie name ${JSON.stringify(cookieName)}`
    )
  }
  const dir = extra.dir ?? 'locales'
  const directory = dir.startsWith('/') ? dir : $filepath.join(__hooks, dir)
  const inline = extra.messages ?? {}
  const formats = extra.format ?? {}
  const useCache = config.config.cache ?? !$app.isDev()

  // --- translations

  const loadedLocales = new Map<string, Loaded>()

  const load = (locale: string): Loaded => {
    const known = loadedLocales.get(locale)
    if (known && useCache) return known

    let tree: Record<string, unknown> = {}
    const file = $filepath.join(directory, `${locale}.json`)
    try {
      tree = JSON.parse(toString($os.readFile(file)))
    } catch (e) {
      const text = `${e}`
      if (
        text.indexOf('no such file') === -1 &&
        text.indexOf('cannot find') === -1
      ) {
        throw new Error(`pocketpages-plugin-i18n: could not read ${file}: ${e}`)
      }
      dbg(`no translation file ${file}`)
    }
    const messages = flatten(inline[locale])
    flatten(tree, messages)
    const custom: LocaleFormat = {
      ...((tree._format as LocaleFormat | undefined) ?? {}),
      ...formats[locale],
    }
    const loaded: Loaded = {
      messages,
      numberFormat: numberFormatOf(locale, custom.number),
      names: dateNamesOf(locale, custom.names),
      dates: dateFormatsOf(locale, custom.dates),
    }
    loadedLocales.set(locale, loaded)
    return loaded
  }

  /** Where to look for a message, in order: the language, its main language, the default */
  const chainFor = (locale: string): string[] => {
    const chain = [locale]
    const language = languageOf(locale)
    if (language !== locale && locales.indexOf(language) !== -1)
      chain.push(language)
    if (chain.indexOf(defaultLocale) === -1) chain.push(defaultLocale)
    return chain
  }

  const find = (
    locale: string,
    key: string
  ): { message: Message; locale: string } | undefined => {
    for (const candidate of chainFor(locale)) {
      const message = load(candidate).messages.get(key)
      if (message !== undefined) return { message, locale: candidate }
    }
    return undefined
  }

  // Each missing translation is reported once. Keys can come from anywhere, so don't remember them all.
  const warned = new Set<string>()
  const MAX_WARNED = 500

  const makeTranslate = (locale: string): Translate => {
    const translate =
      (escape: boolean) =>
      (
        key: string,
        vars?: Record<string, unknown>,
        options?: { locale?: string }
      ) => {
        const wanted = options?.locale ?? locale
        const found = find(wanted, key)
        if (!found) {
          const id = `${wanted}\0${key}`
          if (warned.size < MAX_WARNED && !warned.has(id)) {
            warned.add(id)
            dbg(`missing translation: ${key} (${wanted})`)
          }
          return key
        }
        const count = typeof vars?.count === 'number' ? vars.count : undefined
        const text = pick(found.message, found.locale, count)
        if (text === undefined) return key
        return interpolate(text, vars, escape ? escapeHtml : undefined)
      }
    const t = translate(false) as Translate
    t.html = translate(true)
    t.has = (key) => find(locale, key) !== undefined
    return t
  }

  // --- where the visitor is

  const isPage = (route: unknown): route is { isStatic: boolean } =>
    !!route && !(route as { isStatic: boolean }).isStatic

  const baseUrl = () =>
    (extra.baseUrl ?? $app.settings().meta.appURL ?? '').replace(/\/+$/, '')

  const rememberLocale = (
    request: PagesRequest,
    response: PagesResponse,
    locale: string
  ) => {
    if (!remember || request.cookies(cookieName) === locale) return
    response.cookie(cookieName, locale, {
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
      secure: request.secure,
    })
  }

  /** What the browser tells about the languages its user reads */
  const preferred = (request: PagesRequest): string | undefined => {
    const fromCookie = request.cookies<string>(cookieName)
    if (typeof fromCookie === 'string') {
      const known = matchLocale([fromCookie], locales)
      if (known) return known
    }
    return matchLocale(
      parseAcceptLanguage(request.header('Accept-Language')),
      locales
    )
  }

  type State = {
    locale: string
    path: (path: string, locale?: string) => string
  }

  return {
    name: 'i18n',

    onRequest: ({ request, response, route }) => {
      // `route` is the one of the address as it came in: a page of another language has
      // none yet, the address is rewritten below and PocketPages looks again
      const page = isPage(route)
      const found =
        strategy === 'prefix'
          ? stripLocalePrefix(request.pathname, locales)
          : undefined

      // Most requests that get here are not for pages and have no language in them
      if (!page && !found?.locale) return

      let locale: string = defaultLocale
      let rewritten = false
      const original = request.event.request!.url!

      if (found) {
        const safeToRedirect =
          request.method === 'GET' || request.method === 'HEAD'
        const query = original.rawQuery ? `?${original.rawQuery}` : ''

        if (found.locale) {
          locale = found.locale
          if (
            locale === defaultLocale &&
            !prefixDefault &&
            redirectDefaultPrefix &&
            safeToRedirect
          ) {
            // One address for each page
            response.redirect(found.path + query, 301)
            return true
          }
          request.url = globalApi.url(found.path + query)
          rewritten = true
          rememberLocale(request, response, locale)
        } else if (prefixDefault || (autoRedirect && safeToRedirect)) {
          const wanted = prefixDefault
            ? (preferred(request) ?? defaultLocale)
            : request.cookies(cookieName)
              ? undefined
              : matchLocale(
                  parseAcceptLanguage(request.header('Accept-Language')),
                  locales
                )
          if (
            wanted &&
            safeToRedirect &&
            (prefixDefault || wanted !== defaultLocale)
          ) {
            response.addHeader('Vary', 'Accept-Language')
            response.addHeader('Vary', 'Cookie')
            response.redirect(
              localizePath(
                request.pathname,
                wanted,
                defaultLocale,
                prefixDefault
              ) + query,
              302
            )
            return true
          }
        }
      } else {
        locale = preferred(request) ?? defaultLocale
        response.addHeader('Vary', 'Accept-Language')
        response.addHeader('Vary', 'Cookie')
        rememberLocale(request, response, locale)
      }

      const state: State = {
        locale,
        path: (path, to = locale) =>
          strategy === 'none'
            ? path
            : localizePath(path, to, defaultLocale, prefixDefault),
      }
      request.state.i18n = state
      response.header('Content-Language', locale)
      if (rewritten) dbg(`${original.path} → ${request.pathname} (${locale})`)
    },

    onExtendContextApi: ({ api }) => {
      const { request } = api
      const state = (request.state.i18n as State | undefined) ?? {
        locale: defaultLocale,
        path: (path: string) => path,
      }
      const locale = state.locale
      const t = makeTranslate(locale)
      const path = state.path
      const loaded = () => load(locale)

      const alternates = (): Alternate[] =>
        locales.map((l) => ({
          locale: l,
          path:
            strategy === 'none' ? request.pathname : path(request.pathname, l),
          current: l === locale,
        }))

      const i18n: I18n = {
        locale,
        locales: locales.slice(),
        defaultLocale,
        dir: RTL.indexOf(languageOf(locale)) !== -1 ? 'rtl' : 'ltr',
        t,
        path,
        alternates,
        hreflang: () => {
          // Only a site with an address for each language has anything to say
          if (strategy === 'none') return ''
          const base = baseUrl()
          const tags = alternates().map(
            (a) =>
              `<link rel="alternate" hreflang="${escapeHtml(a.locale)}" href="${escapeHtml(base + a.path)}">`
          )
          tags.push(
            `<link rel="alternate" hreflang="x-default" href="${escapeHtml(base + path(request.pathname, defaultLocale))}">`
          )
          return tags.join('\n')
        },
        formatNumber: (value, options) =>
          formatNumber(value, loaded().numberFormat, options),
        formatDate: (value, style = 'medium', options) => {
          const date = toDate(value)
          if (!date) return ''
          const { dates, names } = loaded()
          const pattern =
            style === 'datetime'
              ? `${dates.medium} ${dates.time}`
              : style in dates
                ? dates[style as keyof DateFormats]
                : style
          return formatDate(date, pattern, names, options?.utc ?? true)
        },
      }

      api.i18n = i18n
      api.t = t
      api.locale = locale
      api.localePath = path
    },
  }
}

export default i18nPluginFactory
