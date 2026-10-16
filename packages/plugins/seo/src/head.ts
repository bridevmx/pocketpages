import { absoluteUrl, escapeHtml, safeJson } from './xml'

export type SeoData = {
  title?: string
  description?: string
  /** The address of the page, `/blog/a-post` or complete. The path of the request unless told otherwise. */
  canonical?: string
  /** An image for when the page is shared, `/img/cover.png` or complete */
  image?: string
  imageAlt?: string
  /** `website` (the default), `article`, `profile`... for Open Graph */
  type?: string
  siteName?: string
  /** `en_US` and the like, for Open Graph */
  locale?: string
  /** Keep the page out of search results */
  noindex?: boolean
  /** Do not follow its links either */
  nofollow?: boolean
  /** The handle of the site on Twitter/X: `@example` */
  twitter?: string
  /** The handle of the author on Twitter/X */
  twitterCreator?: string
  /** `summary` or `summary_large_image`, the second when there is an image */
  twitterCard?: string
  // Articles
  publishedTime?: string
  modifiedTime?: string
  author?: string
  section?: string
  tags?: string[]
  /** Anything else you want as a `<meta>`: `{ 'theme-color': '#fff' }` */
  meta?: Record<string, string>
}

export type SeoSettings = {
  baseUrl: string
  /** `{title}` and `{siteName}` are filled in. `{title} | {siteName}` unless told otherwise. */
  titleTemplate: string
  defaultTitle?: string
}

/** Settings that are the same for every page, in the config, and what each page sets over them */
export const mergeSeo = (base: SeoData, ...more: SeoData[]): SeoData => {
  const merged: Record<string, unknown> = { ...base }
  for (const data of more) {
    for (const key of Object.keys(data)) {
      const value = (data as Record<string, unknown>)[key]
      if (value === undefined) continue
      if (key === 'meta' && merged.meta) {
        merged.meta = { ...(merged.meta as object), ...(value as object) }
      } else {
        merged[key] = value
      }
    }
  }
  return merged as SeoData
}

export const titleOf = (data: SeoData, settings: SeoSettings): string => {
  const site = data.siteName ?? ''
  if (!data.title)
    return data.title === undefined ? (settings.defaultTitle ?? site) : site
  if (!site || data.title === site) return data.title
  return settings.titleTemplate
    .replace(/\{title\}/g, data.title)
    .replace(/\{siteName\}/g, site)
}

const tag = (name: string, attribute: 'name' | 'property', content: unknown) =>
  content === undefined || content === null || content === ''
    ? ''
    : `<meta ${attribute}="${escapeHtml(name)}" content="${escapeHtml(content)}">`

/**
 * The tags for the `<head>` of a page
 */
export const buildHead = (
  data: SeoData,
  settings: SeoSettings,
  path: string,
  jsonLd: unknown[] = [],
  extra: string[] = []
): string => {
  const title = titleOf(data, settings)
  const canonical = absoluteUrl(settings.baseUrl, data.canonical ?? path)
  const image = data.image
    ? absoluteUrl(settings.baseUrl, data.image)
    : undefined
  const lines: string[] = []
  const add = (line: string) => {
    if (line) lines.push(line)
  }

  if (title) lines.push(`<title>${escapeHtml(title)}</title>`)
  add(tag('description', 'name', data.description))
  if (settings.baseUrl || data.canonical) {
    lines.push(`<link rel="canonical" href="${escapeHtml(canonical)}">`)
  }
  if (data.noindex || data.nofollow) {
    const directives = [
      data.noindex ? 'noindex' : 'index',
      data.nofollow ? 'nofollow' : 'follow',
    ]
    add(tag('robots', 'name', directives.join(',')))
  }

  // Open Graph
  add(tag('og:site_name', 'property', data.siteName))
  add(tag('og:type', 'property', data.type ?? 'website'))
  add(tag('og:title', 'property', title))
  add(tag('og:description', 'property', data.description))
  if (settings.baseUrl || data.canonical)
    add(tag('og:url', 'property', canonical))
  add(tag('og:image', 'property', image))
  add(tag('og:image:alt', 'property', image ? data.imageAlt : undefined))
  add(tag('og:locale', 'property', data.locale))

  // Twitter
  add(
    tag(
      'twitter:card',
      'name',
      data.twitterCard ?? (image ? 'summary_large_image' : 'summary')
    )
  )
  add(tag('twitter:site', 'name', data.twitter))
  add(tag('twitter:creator', 'name', data.twitterCreator))
  add(tag('twitter:title', 'name', title))
  add(tag('twitter:description', 'name', data.description))
  add(tag('twitter:image', 'name', image))
  add(tag('twitter:image:alt', 'name', image ? data.imageAlt : undefined))

  // Articles
  add(tag('article:published_time', 'property', data.publishedTime))
  add(tag('article:modified_time', 'property', data.modifiedTime))
  add(tag('article:author', 'property', data.author))
  add(tag('article:section', 'property', data.section))
  for (const t of data.tags ?? []) add(tag('article:tag', 'property', t))

  for (const name of Object.keys(data.meta ?? {})) {
    add(tag(name, 'name', data.meta![name]))
  }
  for (const line of extra) add(line)
  for (const item of jsonLd) {
    lines.push(`<script type="application/ld+json">${safeJson(item)}</script>`)
  }
  return lines.join('\n')
}

export type Crumb = { name: string; url: string }

/** A trail of pages for search engines to show instead of the address */
export const breadcrumbs = (baseUrl: string, items: Crumb[]) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map((item, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: item.name,
    item: absoluteUrl(baseUrl, item.url),
  })),
})
