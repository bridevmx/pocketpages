import type { PluginFactory, PluginOptionsBase } from 'pocketpages'
import {
  NavOptions,
  PageNumbers,
  pageUrl,
  paginate,
  renderNav,
  toPage,
} from './paginate'

export { pageWindow } from './paginate'
export type { NavOptions, PageItem, PageNumbers } from './paginate'

export type PaginationOptions = PluginOptionsBase & {
  /** Items per page, 20 unless told otherwise */
  perPage: number
  /** The most a visitor can ask for with `perPageParam`, 100 unless told otherwise */
  maxPerPage: number
  /** The query string parameter with the page number, `page` unless told otherwise */
  pageParam: string
  /**
   * The query string parameter that lets visitors choose how many items they get per
   * page. They cannot unless you name one.
   */
  perPageParam: string | false
  /** Pages shown on each side of the current one, 1 unless told otherwise */
  siblings: number
  /** Pages always shown at each end, 1 unless told otherwise */
  boundaries: number
  /** Leave `?page=1` out of the link to the first page (so it has a single URL), on unless told otherwise */
  omitFirstPage: boolean
}

export type PaginateOptions = {
  /** How many items there are in all */
  total: number
} & Partial<
  Pick<
    PaginationOptions,
    | 'perPage'
    | 'pageParam'
    | 'perPageParam'
    | 'siblings'
    | 'boundaries'
    | 'omitFirstPage'
  >
> & {
    /** The page to show, from the query string unless told otherwise */
    page?: unknown
  }

export type Pagination = PageNumbers & {
  /** The URL of a page of this listing, the other parameters of the query string kept */
  url: (page: number) => string
  prevUrl: string | null
  nextUrl: string | null
  /** The links to the pages as a `<nav>`, `''` when there is only one page */
  nav: (options?: NavOptions) => string
}

const VALID_KEYS = [
  'debug',
  'perPage',
  'maxPerPage',
  'pageParam',
  'perPageParam',
  'siblings',
  'boundaries',
  'omitFirstPage',
]
const PARAM = /^[A-Za-z0-9_.-]+$/

const paginationPluginFactory: PluginFactory<PaginationOptions> = (
  config,
  extra
) => {
  Object.keys(extra).forEach((key) => {
    if (!VALID_KEYS.includes(key)) {
      throw new Error(`pocketpages-plugin-pagination: unknown option '${key}'`)
    }
  })

  const defaults = {
    perPage: 20,
    maxPerPage: 100,
    pageParam: 'page',
    perPageParam: false as string | false,
    siblings: 1,
    boundaries: 1,
    omitFirstPage: true,
    ...extra,
  }
  for (const name of [defaults.pageParam, defaults.perPageParam]) {
    if (name !== false && !PARAM.test(name)) {
      throw new Error(
        `pocketpages-plugin-pagination: invalid parameter name ${JSON.stringify(name)}`
      )
    }
  }

  return {
    name: 'pagination',

    onExtendContextApi: ({ api }) => {
      const { request, params } = api

      api.paginate = (options: PaginateOptions): Pagination => {
        const o = { ...defaults, ...options }
        const wantsPerPage =
          o.perPageParam !== false ? params[o.perPageParam] : undefined
        const perPage = Math.min(
          o.maxPerPage,
          toPage(wantsPerPage === undefined ? o.perPage : wantsPerPage)
        )
        const numbers = paginate({
          total: options.total,
          page: 'page' in options ? options.page : params[o.pageParam],
          perPage,
          siblings: o.siblings,
          boundaries: o.boundaries,
        })

        // Links keep the URL the visitor asked for, not the one a plugin may have
        // rewritten it to
        const target = request.event.request!.url!
        // The encoded path, as it was asked for: the decoded one turns `/%2Fevil.example`
        // into `//evil.example`, which links would take the visitor to. Never more than
        // one slash at the start, whatever the path.
        const path =
          '/' + (target.escapedPath?.() ?? target.path).replace(/^[/\\]+/, '')
        const query = target.rawQuery
        const url = (page: number) =>
          pageUrl(path, query, o.pageParam, page, o.omitFirstPage)

        return {
          ...numbers,
          url,
          prevUrl: numbers.prev === null ? null : url(numbers.prev),
          nextUrl: numbers.next === null ? null : url(numbers.next),
          nav: (navOptions) => renderNav(numbers, url, navOptions),
        }
      }
    },
  }
}

export default paginationPluginFactory
