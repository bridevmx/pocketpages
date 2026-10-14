import { absoluteUrl, escapeXml } from './xml'

export type SitemapEntry = {
  /** The address, complete */
  loc: string
  /** `2024-05-06` */
  lastmod?: string
  changefreq?:
    | 'always'
    | 'hourly'
    | 'daily'
    | 'weekly'
    | 'monthly'
    | 'yearly'
    | 'never'
  /** From 0 to 1 */
  priority?: number
  /** The same page in other languages, itself included */
  alternates?: Array<{ hreflang: string; href: string }>
}

/** The most addresses a sitemap can list */
export const MAX_SITEMAP_ENTRIES = 50000

export const buildSitemap = (entries: SitemapEntry[]): string => {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
  ]
  const count = Math.min(entries.length, MAX_SITEMAP_ENTRIES)
  for (let i = 0; i < count; i++) {
    const entry = entries[i]!
    lines.push('<url>')
    lines.push(`<loc>${escapeXml(entry.loc)}</loc>`)
    if (entry.lastmod)
      lines.push(`<lastmod>${escapeXml(entry.lastmod)}</lastmod>`)
    if (entry.changefreq)
      lines.push(`<changefreq>${entry.changefreq}</changefreq>`)
    if (entry.priority !== undefined) {
      const priority = Math.max(0, Math.min(1, entry.priority))
      lines.push(`<priority>${priority.toFixed(1)}</priority>`)
    }
    for (const alternate of entry.alternates ?? []) {
      lines.push(
        `<xhtml:link rel="alternate" hreflang="${escapeXml(alternate.hreflang)}" href="${escapeXml(alternate.href)}"/>`
      )
    }
    lines.push('</url>')
  }
  lines.push('</urlset>')
  return lines.join('\n') + '\n'
}

type RouteLike = {
  isStatic: boolean
  segments: Array<{ nodeName: string; paramName?: string }>
}

/**
 * The address of a page, `undefined` for those that can't be listed because the address
 * has a `[param]` in it, and for files
 */
export const routePath = (route: RouteLike): string | undefined => {
  if (route.isStatic) return undefined
  const names: string[] = []
  for (const segment of route.segments) {
    if (segment.paramName) return undefined
    names.push(segment.nodeName)
  }
  if (names[names.length - 1] === 'index') names.pop()
  return `/${names.join('/')}`
}

/** The pages of the site that have an address of their own, without duplicates */
export const pagePaths = (
  routes: RouteLike[],
  isExcluded: (path: string) => boolean
): string[] => {
  const seen = new Set<string>()
  const paths: string[] = []
  for (const route of routes) {
    const path = routePath(route)
    if (path === undefined || seen.has(path) || isExcluded(path)) continue
    seen.add(path)
    paths.push(path)
  }
  return paths.sort()
}

export type I18nSettings = {
  locales: string[]
  defaultLocale: string
  prefixDefault: boolean
}

const I18N_PLUGIN = 'pocketpages-plugin-i18n'

/**
 * Looks in the config of the app for the i18n plugin, to list the pages in every
 * language. Plugins are written as a name, or as an object with the name and options.
 */
export const detectI18n = (plugins: unknown[]): I18nSettings | undefined => {
  for (const plugin of plugins) {
    if (!plugin || typeof plugin !== 'object') continue
    const options = plugin as Record<string, unknown>
    if (options.name !== I18N_PLUGIN) continue
    const locales = Array.isArray(options.locales)
      ? options.locales.map(String)
      : []
    if (locales.length === 0 || options.strategy === 'none') return undefined
    return {
      locales,
      defaultLocale:
        typeof options.defaultLocale === 'string'
          ? options.defaultLocale
          : locales[0]!,
      prefixDefault: options.prefixDefault === true,
    }
  }
  return undefined
}

/**
 * The address of `path` in a language, the way the i18n plugin makes it
 */
export const localized = (
  path: string,
  locale: string,
  i18n: I18nSettings
): string => {
  if (locale === i18n.defaultLocale && !i18n.prefixDefault) return path
  return path === '/' ? `/${locale}` : `/${locale}${path}`
}

export type PathEntry = Omit<SitemapEntry, 'loc' | 'alternates'> & {
  path: string
  /** List it in every language (the default when the site has more than one) */
  localized?: boolean
}

/**
 * Entries for the paths: one for each language, each of them pointing at the others
 */
export const toEntries = (
  base: string,
  paths: PathEntry[],
  i18n: I18nSettings | undefined
): SitemapEntry[] => {
  const entries: SitemapEntry[] = []
  for (const item of paths) {
    const { path, localized: wantsLocales, ...rest } = item
    if (!i18n || wantsLocales === false) {
      entries.push({ ...rest, loc: absoluteUrl(base, path) })
      continue
    }
    const alternates = i18n.locales.map((locale) => ({
      hreflang: locale,
      href: absoluteUrl(base, localized(path, locale, i18n)),
    }))
    alternates.push({
      hreflang: 'x-default',
      href: absoluteUrl(base, localized(path, i18n.defaultLocale, i18n)),
    })
    for (const locale of i18n.locales) {
      entries.push({
        ...rest,
        loc: absoluteUrl(base, localized(path, locale, i18n)),
        alternates,
      })
    }
  }
  return entries
}
