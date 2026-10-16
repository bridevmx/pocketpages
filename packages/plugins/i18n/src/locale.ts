const LOCALE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/

/**
 * `es_MX` and `es-mx` are `es-MX`: the language in lower case, the region in upper
 * case, the way browsers send them.
 */
export const normalizeLocale = (value: string): string | undefined => {
  const parts = value.trim().replace(/_/g, '-').split('-')
  if (parts.length === 0 || !parts[0]) return undefined
  const normalized = parts
    .map((part, i) => {
      if (i === 0) return part.toLowerCase()
      if (part.length === 2) return part.toUpperCase()
      if (part.length === 4)
        return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
      return part
    })
    .join('-')
  return LOCALE.test(normalized) ? normalized : undefined
}

export const languageOf = (locale: string): string =>
  locale.split('-')[0]!.toLowerCase()

/**
 * The languages a browser asks for in `Accept-Language`, the ones it likes best first
 */
export const parseAcceptLanguage = (header: string): string[] => {
  if (!header) return []
  const found: Array<{ locale: string; q: number; index: number }> = []
  const parts = header.split(',')
  for (let i = 0; i < parts.length; i++) {
    const [tag, ...params] = parts[i]!.trim().split(';')
    if (!tag || tag === '*') continue
    let q = 1
    for (const param of params) {
      const m = /^\s*q\s*=\s*([0-9.]+)\s*$/.exec(param)
      if (m) q = Number(m[1])
    }
    const locale = normalizeLocale(tag)
    if (locale && q > 0 && Number.isFinite(q))
      found.push({ locale, q, index: i })
  }
  return found
    .sort((a, b) => b.q - a.q || a.index - b.index)
    .map((f) => f.locale)
}

/**
 * The supported locale that best fits what was asked for: the same locale, or the
 * language of it (`es-MX` is served by `es`), or another region of the language
 */
export const matchLocale = (
  wanted: string[],
  supported: string[]
): string | undefined => {
  for (const locale of wanted) {
    const exact = supported.find(
      (s) => s.toLowerCase() === locale.toLowerCase()
    )
    if (exact) return exact
    const language = languageOf(locale)
    const sameLanguage = supported.find((s) => s.toLowerCase() === language)
    if (sameLanguage) return sameLanguage
    const sibling = supported.find((s) => languageOf(s) === language)
    if (sibling) return sibling
  }
  return undefined
}

/**
 * `/es/about` is `about` in `es`. Only whole segments count: `/espanol` is not `/es`.
 */
export const stripLocalePrefix = (
  pathname: string,
  locales: string[]
): { locale: string | undefined; path: string } => {
  if (pathname.charCodeAt(0) !== 47 /* / */)
    return { locale: undefined, path: pathname }
  const end = pathname.indexOf('/', 1)
  const first = end === -1 ? pathname.slice(1) : pathname.slice(1, end)
  if (!first) return { locale: undefined, path: pathname }
  const locale = locales.find((l) => l.toLowerCase() === first.toLowerCase())
  if (!locale) return { locale: undefined, path: pathname }
  return { locale, path: end === -1 ? '/' : pathname.slice(end) }
}

/**
 * The address of `path` in `locale`: `/about` is `/es/about`, unless the locale is the
 * default one and that goes without a prefix.
 */
export const localizePath = (
  path: string,
  locale: string,
  defaultLocale: string,
  prefixDefault: boolean
): string => {
  // Addresses elsewhere, and anchors, are not ours to change
  if (!path.startsWith('/') || path.startsWith('//')) return path
  if (locale === defaultLocale && !prefixDefault) return path
  if (path === '/') return `/${locale}`
  return `/${locale}${path}`
}
