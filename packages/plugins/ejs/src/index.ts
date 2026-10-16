import ejs from 'pocketbase-ejs'
import { path } from 'pocketbase-node'
import { stringify } from 'pocketbase-stringify'
import type {
  Plugin,
  PluginFactory,
  PluginOptionsBase,
  RenderContext,
} from 'pocketpages'
import { compileTemplate, withServerBlocks } from './compile'
import { confine } from './confine'

export type EjsPluginOptions = PluginOptionsBase & {
  extensions: string[]
  /**
   * Compile each template once and remember where includes live, instead of reading
   * and compiling the files again on every request. Defaults to the `cache` setting of
   * PocketPages, which is on unless PocketBase runs with `--dev`.
   */
  cache?: boolean
}

type TemplateFunction = (data: any) => string

const oldCompile = ejs.compile

const VALID_CONFIG_KEYS = ['name', 'extensions', 'debug', 'cache'] as const

const BOM = /^\uFEFF/

/**
 * `pocketbase-node`'s fs module is slow in goja (see the notes in pocketpages), so the
 * few file system questions this plugin asks are answered with the JSVM bindings.
 */
const readText = (filePath: string): string => toString($os.readFile(filePath))
const isDir = (p: string) => {
  try {
    $os.readDir(p)
    return true
  } catch {
    return false
  }
}
const isFile = (p: string) => {
  try {
    $filesystem.fileFromPath(p)
  } catch {
    return false
  }
  return !isDir(p)
}

// Same file loader EJS uses by default, minus the cost of converting bytes in JS
ejs.fileLoader = readText

/**
 * Exactly what EJS does to escape `<%= %>` output, but skipping the replace (and its
 * callback) when there is nothing to escape, which is most of the time.
 */
const NEEDS_ESCAPING = /[&<>'"]/
const ESCAPE_ALL = /[&<>'"]/g
const ENCODE_HTML_RULES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&#34;',
  "'": '&#39;',
}
const encodeChar = (c: string) => ENCODE_HTML_RULES[c] || c
const escapeXML = (markup: unknown) => {
  if (markup == undefined) return ''
  const s = String(markup)
  return NEEDS_ESCAPING.test(s) ? s.replace(ESCAPE_ALL, encodeChar) : s
}

/**
 * EJS copies the locals (about 40 keys of the context API) every time a template
 * includes another one. Its copy goes through `hasOwnProperty.apply()` for each key,
 * which is several times slower than walking `Object.keys()` for the same result.
 */
try {
  const utilsPath = 'pocketbase-ejs/lib/utils'
  const utils = require(utilsPath)
  utils.shallowCopy = (to: any, from: any) => {
    if (to !== null && to !== undefined) {
      const keys = Object.keys(from || {})
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i]!
        if (key === '__proto__' || key === 'constructor') continue
        to[key] = from[key]
      }
    }
    return to
  }
} catch {
  // Not worth failing for, EJS keeps its own implementation
}

const PREPEND = `
  const echo = (...args) => {
    const result = args.map((arg) => {
      if (typeof arg === 'object') {
        return JSON.stringify(arg)
      }
      return arg.toString()
    })
    return __append(result.join(' '))
  }
`

/**
 * The template being rendered. Templates are compiled once and shared by every request
 * the runtime serves, so what a template's `include()` needs to know about the request
 * in flight cannot be captured when it is compiled. It is looked up here instead.
 */
type RenderFrame = {
  renderContext: RenderContext
  /** Every plugin but this one, they get to post-process included files */
  others: Plugin[]
}
const frames: RenderFrame[] = []

const ejsPluinFactory: PluginFactory<EjsPluginOptions> = (config, extra) => {
  const opts: EjsPluginOptions = {
    extensions: ['.ejs'],
    ...extra,
  }
  Object.keys(opts).forEach((key) => {
    if (
      !VALID_CONFIG_KEYS.includes(key as (typeof VALID_CONFIG_KEYS)[number])
    ) {
      throw new Error(`Invalid config key: ${key}`)
    }
  })

  const { pagesRoot, dbg } = config
  const useCache = opts.cache ?? config.config.cache ?? !$app.isDev()

  // dbg(`ejs plugin config`, { pagesRoot, opts })

  ejs.compile = function (template: string, options: any) {
    return oldCompile(withServerBlocks(template), { ...options })
  }

  /**
   * Where an include lives only depends on the file asking for it and on the include
   * path, so the answer is remembered when caching is on.
   */
  const resolvedIncludes = new Map<string, string>()

  ejs.resolveInclude = function (
    includePath: string,
    templatePath: string,
    isDirectory: boolean
  ) {
    // Handle absolute paths (starting with /)
    if (isDirectory) {
      dbg(`ejs resolveInclude ${includePath} from ${templatePath} <dir>`)
      const attemptPath = path.resolve(pagesRoot, includePath)
      // `includePath` can look absolute itself ("/etc/passwd", a Windows drive or a
      // UNC path): resolving it against `pagesRoot` is not enough to keep it inside,
      // because an absolute second argument replaces the first one instead of joining it.
      if (!confine(pagesRoot, attemptPath)) {
        throw new Error(
          `No partial '${includePath}' found in any _private directory`
        )
      }
      return attemptPath
    }

    const cacheKey = `${templatePath}\0${includePath}`
    if (useCache) {
      const known = resolvedIncludes.get(cacheKey)
      if (known !== undefined) return known
    }
    dbg(`ejs resolveInclude ${includePath} from ${templatePath} <file>`)

    // Try each extension when searching for the file
    const tryExtensions = (basePath: string) => {
      // First try the exact path
      // dbg(`trying exact path ${basePath}`)
      if (isFile(basePath)) {
        dbg(`found exact path ${basePath}`)
        return basePath
      }

      // Then try each extension if the file doesn't have one
      for (const ext of opts.extensions) {
        const pathWithExt = basePath + ext
        // dbg(`trying extension ${pathWithExt}`)
        if (isFile(pathWithExt)) {
          dbg(`found extension ${pathWithExt}`)
          return pathWithExt
        }
      }
      return null
    }

    // Handle relative paths by searching up the directory tree
    let currentPath = path.dirname(templatePath)

    const triedPaths: string[] = []
    while (currentPath.length >= pagesRoot.length) {
      const attemptPath = path.resolve(currentPath, `_private`, includePath)
      // Not a plain prefix check: "pages" is a text prefix of a sibling directory
      // like "pages-backup" too, which is not inside `pages` at all.
      if (!confine(pagesRoot, attemptPath)) {
        dbg(`skipping ${attemptPath} in ${pagesRoot}`)
        break
      }
      dbg(`trying ${attemptPath} in ${pagesRoot}`)
      const foundPath = tryExtensions(attemptPath)
      if (foundPath) {
        if (useCache) {
          resolvedIncludes.set(cacheKey, foundPath)
        }
        return foundPath
      }
      triedPaths.push(attemptPath)

      // If we're at pagesRoot and still haven't found it, fall back to default behavior
      if (currentPath === pagesRoot) {
        break
      }
      // Move up one directory
      currentPath = path.dirname(currentPath)
    }

    throw new Error(
      `No partial '${includePath}' found in any _private directory. Tried: ${triedPaths.join(
        ', '
      )}`
    )
  }

  const _handles = (filePath: string) => {
    return opts.extensions.includes($filepath.ext(filePath))
  }

  /**
   * Compiled templates by file name
   */
  const templates = new Map<string, TemplateFunction>()

  /**
   * Reads and compiles `filename`, or hands back the template compiled earlier.
   */
  const getTemplate = (filename: string): TemplateFunction => {
    if (useCache) {
      const known = templates.get(filename)
      if (known) return known
    }
    const source = readText(filename).replace(BOM, '')
    const template = compileTemplate(ejs, source, {
      ...compileOptions,
      filename,
    })
    if (useCache) {
      templates.set(filename, template)
    }
    return template
  }

  /**
   * What EJS does for `include('path')` in a template: find the file, compile it and
   * return a function that renders it. Rendered includes also go through the `onRender`
   * hook of the other plugins (a partial with an extension another plugin handles is
   * rendered by that plugin, for instance).
   */
  const includeFile = (includePath: string, options: any) => {
    dbg(`includeFile ${includePath}`)
    const frame = frames[frames.length - 1]

    let filename: string
    if (/^[A-Za-z]+:\\|^\//.test(includePath)) {
      // Absolute paths are relative to the pages directory
      filename = ejs.resolveInclude(
        includePath.replace(/^\/*/, ''),
        options.root || '/',
        true
      )
    } else {
      filename = ejs.resolveInclude(includePath, options.filename, false)
    }

    const renderFunc = getTemplate(filename)
    return (data: any) => {
      const rawRendered = renderFunc(data)
      if (!frame) return rawRendered
      // dbg(`raw rendered\n${rawRendered}`)
      return frame.others.reduce((content, plugin) => {
        dbg(`calling ${plugin.name}:onRender ${includePath}`)
        return (
          plugin.onRender?.({
            ...frame.renderContext,
            api: data,
            content,
            filePath: ejs.resolveInclude(
              includePath,
              frame.renderContext.filePath,
              false
            ),
          }) ?? content
        )
      }, rawRendered as string)
    }
  }

  const compileOptions = {
    prepend: PREPEND,
    compileDebug: true,
    async: false,
    cache: useCache,
    root: pagesRoot,
    escape: escapeXML,
    includeFile,
  }

  const thisPlugin: Plugin = {
    name: 'ejs',
    handles: ({ filePath }) => {
      return _handles(filePath)
    },
    onRender: (renderContext) => {
      const { api, filePath, plugins } = renderContext
      if (!_handles(filePath)) return renderContext.content
      dbg(`onRender ${filePath}`)

      frames.push({
        renderContext,
        others: plugins.filter(
          (otherPlugin) => otherPlugin.name !== thisPlugin.name
        ),
      })
      let content: string
      try {
        content = getTemplate(filePath)({ ...api, api })
      } finally {
        frames.pop()
      }

      if (typeof content !== 'string') {
        if (content === undefined || content === null) {
          return ''
        }
        return stringify(content)
      }

      return content
    },
  }
  return thisPlugin
}

export default ejsPluinFactory
