import * as log from 'pocketbase-log'
import { runtime } from './runtime'

/**
 * Reading the flag from `$app.store()` is a round trip into Go, and dbg() sits on the
 * hot path, so the answer is remembered per runtime.
 */
export const isDebug = () => {
  if (runtime.debug === undefined) {
    runtime.debug = !!$app.store().get('__pocketpages_debug')
  }
  return runtime.debug
}

export const setDebug = (enabled: boolean) => {
  runtime.debug = enabled
  if (enabled) {
    $app.store().set('__pocketpages_debug', true)
  }
}

export const dbg = (...args: any[]) => {
  if (!isDebug()) return
  return log.dbg(...args)
}
