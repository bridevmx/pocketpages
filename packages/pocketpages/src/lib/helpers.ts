import { stringify } from 'pocketbase-stringify'
import { confine } from './confine'
import { pathExists, readText } from './fs'
import { runtime } from './runtime'
import { ResolveOptions } from './types'

export const pagesRoot = $filepath.join(__hooks, `pages`)

const SAFE_HEADER = `if (typeof module === 'undefined') { module = { exports: {} } };`
const exts = ['', '.js', '.json']

/**
 * What resolve() already found out. Only used when `runtime.cache` is on, because the
 * answers go stale if files appear or change while the app is running.
 */
const existsCache = new Set<string>()
const resolvedCache = new Map<string, string>()
const contentCache = new Map<string, string>()

export const moduleExists = (path: string) => {
  if (runtime.cache && existsCache.has(path)) return true
  for (let i = 0; i < exts.length; i++) {
    // fileFromPath() succeeds for directories too
    if (pathExists(path + exts[i])) {
      // Only what exists is remembered: the paths asked about can come from the request
      if (runtime.cache) {
        existsCache.add(path)
      }
      return true
    }
  }
  return false
}

const simulateRequire = (path: string) => {
  for (let i = 0; i < exts.length; i++) {
    try {
      return readText(path + exts[i])
    } catch (e) {
      continue
    }
  }
  throw new Error(`No module '${path}' found`)
}

/**
 * simulateRequire() for modules that are inlined into the page: they end up being read
 * (and wrapped) on every request, so remember the result.
 */
const inline = (mode: 'raw' | 'script' | 'style', path: string) => {
  const key = `${mode}\0${path}`
  if (runtime.cache) {
    const known = contentCache.get(key)
    if (known !== undefined) return known
  }
  const source = simulateRequire(path)
  const content =
    mode === 'raw'
      ? source
      : mode === 'script'
        ? `<script>\n${SAFE_HEADER}\n${source}\n</script>`
        : `<style>\n${source}\n</style>`
  if (runtime.cache) {
    contentCache.set(key, content)
  }
  return content
}

class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

export const mkResolve =
  (rootPath: string) => (path: string, options?: Partial<ResolveOptions>) => {
    const mode = options?.mode || 'require'
    const _require = (path: string) => {
      if (!moduleExists(path)) {
        throw new NotFoundError(`No module '${path}' found`)
      }
      switch (mode) {
        case 'raw':
        case 'script':
        case 'style':
          return inline(mode, path)
        case 'require':
          return require(path)
      }
    }

    // Handle absolute paths (starting with /)
    if (path.startsWith('/')) {
      const finalPath = $filepath.join(pagesRoot, '_private', path)
      // A path full of `..` could otherwise walk out of `_private`, even out of `pages`
      if (!confine($filepath.join(pagesRoot, '_private'), finalPath)) {
        throw new Error(`No module '${path}' found`)
      }
      try {
        return _require(finalPath)
      } catch (e) {
        throw new Error(`No module '${finalPath}' found`)
      }
    }

    // The _private directory a relative path ends up in does not change between calls
    const resolvedKey = `${rootPath}\0${path}`
    if (runtime.cache) {
      const finalPath = resolvedCache.get(resolvedKey)
      if (finalPath !== undefined) {
        return _require(finalPath)
      }
    }

    // `../x` skips as many levels of `_private` as it has `../`, then resolves `x` from
    // there upward as usual. `_private/..` would otherwise cancel out when joined, so the
    // path never looked in a `_private` directory at all (`_private/../x` is just `x`).
    let currentPath = rootPath
    let searchPath = path
    while (searchPath.startsWith('../') || searchPath === '..') {
      if (currentPath === pagesRoot) {
        throw new Error(
          `No module '${path}' found: nothing is above '${pagesRoot}'`
        )
      }
      currentPath = $filepath.dir(currentPath)
      searchPath = searchPath === '..' ? '' : searchPath.slice(3)
    }

    // Handle relative paths by searching up the directory tree
    while (currentPath.length >= pagesRoot.length) {
      try {
        const finalPath = $filepath.join(currentPath, '_private', searchPath)
        // console.log(`finalPath`, finalPath)
        // Same as for an absolute path: `_private` (and `pages`) is as far as `..` goes
        if (!confine($filepath.join(currentPath, '_private'), finalPath)) {
          throw new NotFoundError(`No module '${path}' found`)
        }
        const result = _require(finalPath)
        if (runtime.cache) {
          resolvedCache.set(resolvedKey, finalPath)
        }
        return result
      } catch (e) {
        const errorMsg = `${e}`
        // console.log(`errorMsg`, errorMsg)

        if (!(e instanceof NotFoundError)) {
          throw e
        }
        // If we're at pagesRoot and still haven't found it, throw error
        if (currentPath === pagesRoot) {
          throw new Error(
            `No module '${path}' found in _private directories from ${rootPath} up to ${pagesRoot}`
          )
        }
        // Move up one directory
        currentPath = $filepath.dir(currentPath)
      }
    }

    throw new Error(`Unreachable code reached`)
  }

export const mkMeta = () => {
  const metaData: Record<string, string> = {}
  return (key: string, value: string | undefined) => {
    if (value === undefined) {
      return metaData[key]
    }
    return (metaData[key] = value)
  }
}

export const echo = (...args: any[]) => {
  const result = args.map((arg) => {
    if (typeof arg === 'function') {
      return arg.toString()
    } else if (typeof arg === 'object') {
      return stringify(arg)
    } else if (typeof arg === 'number') {
      return arg.toString()
    }
    return `${arg}`
  })
  return result.join(' ')
}
