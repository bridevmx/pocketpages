import { buildRouteIndex, RouteIndex } from './resolveRoute'
import { runtime } from './runtime'
import { Cache } from './types'

const CACHE_KEY = 'pocketpages'
const EPOCH_KEY = 'pocketpages:epoch'

export type RuntimeCache = Cache & {
  /** Lookup structure for `routes`, see `matchRoute()` */
  index: RouteIndex
  /** Results of `asset()`, which only depend on the routes */
  assets: Map<string, string>
}

/**
 * Called once the routes have been discovered. The cache itself is kept in
 * `$app.store()` so every runtime can see it, and the epoch tells the runtimes
 * holding a private copy (see `getCache()`) that it has been replaced.
 */
export const publishCache = (cache: Cache) => {
  $app.store<Cache>().set(CACHE_KEY, cache)
  $app.store().set(EPOCH_KEY, $security.randomString(12))
}

/**
 * Objects read back from `$app.store()` are Go values wrapped for goja: every property
 * access goes through reflection and allocates a new wrapper, which makes walking the
 * route table (sorting, searching) several times slower than on plain JS objects.
 * This makes a plain JS copy. Functions (plugin factories declared inline in the
 * config) are kept as they are.
 */
const toPlain = (value: any): any => {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    const copy = new Array(value.length)
    for (let i = 0; i < value.length; i++) {
      copy[i] = toPlain(value[i])
    }
    return copy
  }
  const copy: Record<string, any> = {}
  const keys = Object.keys(value)
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!
    copy[key] = toPlain(value[key])
  }
  return copy
}

let current: { epoch: unknown; cache: RuntimeCache } | undefined

/**
 * Returns the routes and config discovered at startup, as plain JS objects that live
 * as long as the runtime does. The copy is made the first time a runtime needs it.
 */
export const getCache = (): RuntimeCache => {
  const epoch = $app.store().get(EPOCH_KEY)
  if (current && current.epoch === epoch) {
    return current.cache
  }

  const stored = $app.store<Cache>().get(CACHE_KEY)
  const routes = toPlain(stored.routes) as Cache['routes']
  const config = toPlain(stored.config) as Cache['config']
  const cache: RuntimeCache = {
    routes,
    config,
    index: buildRouteIndex(routes),
    assets: new Map(),
  }
  runtime.debug = config.debug === 'verbose'
  runtime.cache = !!config.cache
  current = { epoch, cache }
  return cache
}
