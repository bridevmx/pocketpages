import { omit } from '@s-libs/micro-dash'
import { error } from 'pocketbase-log'
import { globalApi } from 'src/lib/globalApi'
import {
  Cache,
  Plugin,
  PluginConfigItem,
  PluginConfigItemShortHand,
  PluginFactory,
  PluginFactoryConfig,
  PluginOptions,
} from 'src/lib/types'
import { dbg as systemDbg } from './debug'
import { pagesRoot } from './helpers'

const normalizePlugin = (
  plugin: PluginConfigItemShortHand
): PluginConfigItem => {
  if (typeof plugin === 'string') {
    return { debug: false, fn: loadFactory(plugin) }
  }
  if (typeof plugin === 'function') {
    return { debug: false, fn: plugin }
  }
  if (typeof plugin === 'object' && 'fn' in plugin) {
    return { debug: false, fn: plugin.fn!, ...plugin }
  }
  if (typeof plugin === 'object' && 'name' in plugin) {
    return {
      debug: false,
      ...omit(plugin, 'name'),
      fn: loadFactory(plugin.name),
    }
  }
  throw new Error('Invalid plugin config')
}

const loadFactory = (plugin: string) => {
  const factory = (() => {
    const module = require(plugin)
    return (module.default ?? module) as PluginFactory
  })()
  // dbg(`factory`, { factory })
  return factory
}

export const loadPlugins = (cache: Cache): Plugin[] => {
  const { config, routes } = cache

  return [
    ...config.plugins.map((pluginConfigItem) => {
      try {
        const normalizedPlugin = normalizePlugin(pluginConfigItem)

        const extra = omit(normalizedPlugin, 'fn') as PluginOptions

        // The factory may log while it is still being built
        let pluginName = 'plugin'
        const factoryConfig: PluginFactoryConfig = {
          pagesRoot,
          config,
          globalApi,
          routes,
          dbg: (...args: any[]) =>
            extra.debug
              ? globalApi.dbg(`[${pluginName}]`, ...args)
              : systemDbg(`[${pluginName}]`, ...args),
        }
        const plugin = normalizedPlugin.fn(factoryConfig, extra)
        pluginName = plugin.name
        systemDbg(`loaded plugin ${plugin.name}`)
        return plugin
      } catch (e) {
        error(`${e}`, pluginConfigItem)
        throw e
      }
    }),
  ]
}

export type LoadedPlugins = {
  cache: Cache
  plugins: Plugin[]
  /** True when at least one plugin wants to see every request */
  hasOnRequest: boolean
  /** The plugins that have each of the hooks called for requests, in order */
  requestHooks: Plugin[]
  afterRenderHooks: Plugin[]
  errorHooks: Plugin[]
}

let loaded: LoadedPlugins | undefined

/**
 * Plugin factories run once per runtime instead of once per request: `require()`ing
 * them, wiring up their hooks and extending the global API is not free, and nothing
 * about a plugin changes between requests. `cache` has to be the object returned by
 * `getCache()`, which is stable for the life of the runtime.
 */
export const getPlugins = (cache: Cache): LoadedPlugins => {
  if (loaded && loaded.cache === cache) {
    return loaded
  }
  const plugins = loadPlugins(cache)
  const requestHooks = plugins.filter(
    (plugin) => typeof plugin.onRequest === 'function'
  )
  loaded = {
    cache,
    plugins,
    hasOnRequest: requestHooks.length > 0,
    requestHooks,
    afterRenderHooks: plugins.filter(
      (plugin) => typeof plugin.onAfterRender === 'function'
    ),
    errorHooks: plugins.filter(
      (plugin) => typeof plugin.onError === 'function'
    ),
  }
  return loaded
}
