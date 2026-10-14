const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
}

/**
 * Text for XML and HTML attributes and elements. Control characters that XML cannot
 * hold at all are dropped.
 */
export const escapeXml = (value: unknown): string =>
  String(value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[&<>"']/g, (c) => XML_ESCAPES[c]!)

/** The same characters the HTML escaping of templates handles */
export const escapeHtml = (value: unknown): string =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/** Text that may hold markup, in a CDATA section (`]]>` is cut in two so it can't end it) */
export const cdata = (value: unknown): string =>
  `<![CDATA[${String(value).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`

/**
 * JSON for the inside of a `<script>`: nothing in it can close the script or open a
 * comment
 */
export const safeJson = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')

/** `https://example.com` and `/blog/a` are `https://example.com/blog/a` */
export const absoluteUrl = (base: string, url: string): string => {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return url
  if (url.startsWith('//'))
    return `${/^https?:/.exec(base)?.[0] ?? 'https:'}${url}`
  const root = base.replace(/\/+$/, '')
  return url.startsWith('/') ? root + url : `${root}/${url}`
}

/**
 * Fills `{field}` in a template (`/blog/{slug}`) with the values of a record. Values are
 * made safe for a URL path.
 */
export const expand = (
  template: string,
  get: (field: string) => unknown,
  encode: (value: string) => string = encodeURIComponent
): string =>
  template.replace(/\{(\w+)\}/g, (whole, field: string) => {
    const value = get(field)
    return value === undefined || value === null ? '' : encode(String(value))
  })

/** A date as `2024-05-06`, or as `2024-05-06T07:08:09Z` with a time, for what feeds and sitemaps want */
export const toW3CDate = (
  value: unknown,
  withTime = false
): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined
  let date: Date
  if (value instanceof Date) {
    date = value
  } else if (typeof value === 'number') {
    date = new Date(value)
  } else {
    const s = String(value).trim()
    date = new Date(/^\d{4}-\d{2}-\d{2} \d/.test(s) ? s.replace(' ', 'T') : s)
  }
  if (Number.isNaN(date.getTime())) return undefined
  const iso = date.toISOString()
  return withTime ? `${iso.slice(0, 19)}Z` : iso.slice(0, 10)
}

/** Dates in the format RSS wants: `Mon, 06 May 2024 07:08:09 GMT` */
export const toRfc822 = (value: unknown): string | undefined => {
  const w3c = toW3CDate(value, true)
  return w3c ? new Date(w3c).toUTCString() : undefined
}

/**
 * The text of a page for a description: tags and extra white space gone, cut where a
 * word ends
 */
export const excerpt = (html: string, max = 160): string => {
  const text = String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  const chars = Array.from(text)
  if (chars.length <= max) return text
  const cut = chars.slice(0, max - 1).join('')
  // Cut where a word ends, unless that would throw most of it away
  const wordEnds = chars[max - 1] === ' '
  const space = cut.lastIndexOf(' ')
  const kept = wordEnds || space <= max * 0.6 ? cut : cut.slice(0, space)
  return `${kept.replace(/[\s,.;:!-]+$/, '')}…`
}
