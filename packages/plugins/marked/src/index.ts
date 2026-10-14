import { forEach } from '@s-libs/micro-dash'
import fm, { FrontMatterResult } from 'front-matter'
import { Marked } from 'marked'
import {
  PagesRequestContext,
  PluginFactory,
  PluginOptionsBase,
  RenderContext,
} from 'pocketpages'

type Route = RenderContext['route']

export type FrontMatter = Record<string, string>

export type MarkedPluginOptions = PluginOptionsBase & {
  extensions: string[]
  /**
   * Remember the HTML generated for each piece of markdown instead of parsing it again
   * on every request. Defaults to the `cache` setting of PocketPages, which is on
   * unless PocketBase runs with `--dev`.
   */
  cache?: boolean
}

type RenderedMarkdown = {
  html: string
  attributes: FrontMatter
}

/**
 * Rendered markdown is kept in `$app.store()`, which is shared by every JS runtime
 * PocketBase runs handlers in, so each piece of markdown is only held once no matter
 * how many runtimes there are, and only has to be rendered once for all of them.
 */
const CACHE_PREFIX = 'pocketpages-plugin-marked:'
const COUNT_KEY = `${CACHE_PREFIX}count`
/** When this many entries are held they are all dropped to make room */
const MAX_ENTRIES = 1000
/** Pages bigger than this are not worth holding on to (in characters) */
const MAX_ENTRY_CHARS = 500000

const isPrimitive = (value: unknown) =>
  value === null || (typeof value !== 'object' && typeof value !== 'function')

const markedPluginFactory: PluginFactory<MarkedPluginOptions> = (
  config,
  extra
) => {
  const { dbg } = config

  const opts: MarkedPluginOptions = {
    extensions: ['.md'],
    ...extra,
  }
  const useCache = opts.cache ?? config.config.cache ?? true

  const _handles = (filePath: string) => {
    return opts.extensions.includes($filepath.ext(filePath))
  }

  /**
   * The markdown being rendered. Rendering is synchronous, so there is one at a time
   * and a single Marked instance (which is expensive to set up) can serve them all.
   */
  let api: PagesRequestContext | undefined
  let frontmatter: FrontMatterResult<FrontMatter> | null = null

  const marked = new Marked({
    hooks: {
      preprocess(markdown: string) {
        frontmatter = fm(markdown)
        dbg(`frontmatter`, frontmatter)
        return frontmatter.body
      },
    },
    renderer: {
      heading({ tokens, depth }) {
        const id = tokens[0]?.raw
          .toLowerCase() // Convert to lowercase
          .trim() // Remove leading/trailing spaces
          .replace(/[^a-z0-9\-_ ]/g, '') // Remove invalid characters
          .replace(/\s+/g, '-') // Replace spaces with hyphens
          .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
        // dbg({ tokens, depth, id })
        return `<h${depth} id="${id}">${this.parser.parseInline(
          tokens
        )}</h${depth}>\n`
      },
      image({ href, title, text }) {
        return `<img src="${api!.asset(href)}" alt="${text}" title="${title}" />`
      },
    },
  })

  const render = (
    markdown: string,
    renderApi: PagesRequestContext
  ): RenderedMarkdown => {
    api = renderApi
    frontmatter = null
    try {
      const html = marked.parse(markdown) as string
      return {
        html,
        attributes:
          (frontmatter as FrontMatterResult<FrontMatter> | null)?.attributes ??
          {},
      }
    } finally {
      api = undefined
      frontmatter = null
    }
  }

  /**
   * What markdown turns into only depends on the markdown itself and on the route it is
   * rendered for (that is what `asset()` resolves images against), so pages and
   * partials that are rendered over and over are only parsed once. A markdown file
   * that changes is a different key.
   */
  const cacheKey = (markdown: string, route: Route) =>
    `${CACHE_PREFIX}${route.relativePath}\0${markdown}`

  const recall = (markdown: string, route: Route) =>
    $app.store<RenderedMarkdown | null>().get(cacheKey(markdown, route))

  const remember = (
    markdown: string,
    route: Route,
    entry: RenderedMarkdown
  ) => {
    if (markdown.length + entry.html.length > MAX_ENTRY_CHARS) return
    const store = $app.store<any>()
    const count = (store.get(COUNT_KEY) as number | null) ?? 0
    if (count >= MAX_ENTRIES) {
      const all = store.getAll()
      Object.keys(all).forEach((key) => {
        if (key.startsWith(CACHE_PREFIX)) store.remove(key)
      })
      store.set(COUNT_KEY, 0)
    }
    store.set(cacheKey(markdown, route), entry)
    store.set(COUNT_KEY, ((store.get(COUNT_KEY) as number | null) ?? 0) + 1)
  }

  return {
    name: 'marked',
    handles: ({ filePath }) => {
      return _handles(filePath)
    },
    onRender: ({ content, api: renderApi, filePath, route }) => {
      if (!_handles(filePath)) return content
      dbg(`marked onRender`, { filePath })

      let entry = useCache ? recall(content, route) : null
      if (!entry) {
        entry = render(content, renderApi)
        // Attributes other than plain values would be shared by every request
        if (useCache && Object.values(entry.attributes).every(isPrimitive)) {
          remember(content, route, entry)
        }
      }

      forEach(entry.attributes, (value, key) => {
        renderApi.meta(key, value)
      })
      dbg(`markdown`, { html: entry.html })
      return entry.html
    },
  }
}

export default markedPluginFactory
