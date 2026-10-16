export type PageItem = number | null

export type PaginateInput = {
  /** How many items there are in all */
  total: number
  /** The page asked for. Anything that is not a positive whole number is the first page. */
  page?: unknown
  perPage: number
  /** Pages shown on each side of the current one, 1 unless told otherwise */
  siblings?: number
  /** Pages always shown at each end, 1 unless told otherwise */
  boundaries?: number
}

export type PageNumbers = {
  /** The page being shown, never beyond the last one */
  page: number
  /** The page that was asked for. `outOfRange` tells when it was not shown. */
  requestedPage: number
  outOfRange: boolean
  perPage: number
  total: number
  /** At least 1, even with no items */
  totalPages: number
  /** How many items to skip, for the database */
  offset: number
  /** How many items to get, for the database */
  limit: number
  /** Number of the first item of the page (1-based), `0` when there are none */
  from: number
  /** Number of the last item of the page, `0` when there are none */
  to: number
  hasPrev: boolean
  hasNext: boolean
  prev: number | null
  next: number | null
  /**
   * The page numbers to link to, with `null` where pages are left out:
   * `[1, null, 9, 10, 11, null, 20]`
   */
  pages: PageItem[]
}

export const toPage = (value: unknown): number => {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\s*\d+\s*$/.test(value)
        ? Number(value)
        : NaN
  return Number.isSafeInteger(n) && n >= 1 ? n : 1
}

/**
 * Which pages to link to: the ends, and the ones around the current page. A gap of one
 * page is filled with that page, an ellipsis would take as much room.
 */
export const pageWindow = (
  page: number,
  totalPages: number,
  siblings = 1,
  boundaries = 1
): PageItem[] => {
  const wanted = new Set<number>()
  for (let i = 1; i <= Math.min(boundaries, totalPages); i++) wanted.add(i)
  for (let i = Math.max(1, totalPages - boundaries + 1); i <= totalPages; i++) {
    wanted.add(i)
  }
  for (
    let i = Math.max(1, page - siblings);
    i <= Math.min(totalPages, page + siblings);
    i++
  ) {
    wanted.add(i)
  }
  const sorted = Array.from(wanted).sort((a, b) => a - b)
  const items: PageItem[] = []
  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i]!
    const before = sorted[i - 1]
    if (before !== undefined && current - before > 1) {
      items.push(current - before === 2 ? current - 1 : null)
    }
    items.push(current)
  }
  return items
}

export const paginate = (input: PaginateInput): PageNumbers => {
  const perPage = Math.max(1, Math.floor(input.perPage))
  const total = Math.max(0, Math.floor(Number(input.total) || 0))
  const totalPages = Math.max(1, Math.ceil(total / perPage))
  const requestedPage = toPage(input.page)
  const page = Math.min(requestedPage, totalPages)
  const offset = (page - 1) * perPage
  const from = total === 0 ? 0 : offset + 1
  const to = Math.min(total, offset + perPage)
  return {
    page,
    requestedPage,
    outOfRange: requestedPage > totalPages,
    perPage,
    total,
    totalPages,
    offset,
    limit: perPage,
    from,
    to,
    hasPrev: page > 1,
    hasNext: page < totalPages,
    prev: page > 1 ? page - 1 : null,
    next: page < totalPages ? page + 1 : null,
    pages: pageWindow(page, totalPages, input.siblings, input.boundaries),
  }
}

const isParam = (pair: string, name: string) =>
  pair === name || pair.startsWith(`${name}=`)

/**
 * The URL of a page of the same listing: the path and the query string as they are,
 * apart from the page number.
 */
export const pageUrl = (
  pathname: string,
  rawQuery: string,
  param: string,
  page: number,
  omitFirstPage: boolean
): string => {
  const kept = rawQuery
    ? rawQuery.split('&').filter((pair) => pair && !isParam(pair, param))
    : []
  if (!(omitFirstPage && page === 1)) {
    kept.push(`${param}=${page}`)
  }
  return kept.length > 0 ? `${pathname}?${kept.join('&')}` : pathname
}

export type NavOptions = {
  /** `aria-label` of the `<nav>` element, "Pagination" */
  label?: string
  /** Text of the link to the previous page, "‹ Previous" */
  prev?: string
  /** Text of the link to the next page, "Next ›" */
  next?: string
  /** Class names. Leave out the ones you do not need. */
  classes?: {
    nav?: string
    item?: string
    current?: string
    disabled?: string
    gap?: string
  }
}

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/**
 * Links to the pages as an accessible `<nav>`, ready to put in a page
 */
export const renderNav = (
  numbers: PageNumbers,
  urlFor: (page: number) => string,
  options: NavOptions = {}
): string => {
  if (numbers.totalPages <= 1) return ''
  const classes = {
    nav: 'pagination',
    item: 'page',
    current: 'current',
    disabled: 'disabled',
    gap: 'gap',
    ...options.classes,
  }
  const cls = (...names: Array<string | false | undefined>) => {
    const list = names.filter(Boolean).join(' ')
    return list ? ` class="${escapeHtml(list)}"` : ''
  }
  const parts: string[] = []

  const prevText = escapeHtml(options.prev ?? '‹ Previous')
  parts.push(
    numbers.prev === null
      ? `<span${cls(classes.item, classes.disabled)} aria-disabled="true">${prevText}</span>`
      : `<a${cls(classes.item)} href="${escapeHtml(urlFor(numbers.prev))}" rel="prev">${prevText}</a>`
  )
  for (const item of numbers.pages) {
    if (item === null) {
      parts.push(`<span${cls(classes.gap)} aria-hidden="true">…</span>`)
    } else if (item === numbers.page) {
      parts.push(
        `<a${cls(classes.item, classes.current)} href="${escapeHtml(urlFor(item))}" aria-current="page">${item}</a>`
      )
    } else {
      parts.push(
        `<a${cls(classes.item)} href="${escapeHtml(urlFor(item))}">${item}</a>`
      )
    }
  }
  const nextText = escapeHtml(options.next ?? 'Next ›')
  parts.push(
    numbers.next === null
      ? `<span${cls(classes.item, classes.disabled)} aria-disabled="true">${nextText}</span>`
      : `<a${cls(classes.item)} href="${escapeHtml(urlFor(numbers.next))}" rel="next">${nextText}</a>`
  )

  return `<nav${cls(classes.nav)} aria-label="${escapeHtml(options.label ?? 'Pagination')}">${parts.join('')}</nav>`
}
