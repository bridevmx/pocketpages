import * as log from 'pocketbase-log'
import { stringify } from 'pocketbase-stringify'
import { default as parse } from 'url-parse'
import { getCache } from './cache'
import { couldBeJson } from './json'
import { pathMatcher } from './pathMatch'
import { canonicalPathFor } from './resolveRoute'
import { secret, sign, unsign } from './secret'
import { PagesGlobalContext } from './types'

export const globalApi: PagesGlobalContext = {
  url: (path: string) => {
    const url = parse(path, true)
    // Attempt JSON.parse for each query parameter
    const parsedQuery: Record<string, any> = {}
    for (const [key, value] of Object.entries(url.query)) {
      if (typeof value !== 'string' || !couldBeJson(value)) {
        parsedQuery[key] = value
        continue
      }
      try {
        parsedQuery[key] = JSON.parse(value)
      } catch {
        // If JSON.parse fails, keep the original string value
        parsedQuery[key] = value
      }
    }
    url.set('query', parsedQuery)
    return url
  },
  stringify,
  env: (key: string) => process.env[key] ?? '',
  secret,
  sign,
  unsign,
  pathMatcher,
  canonicalPath: (pathname: string) =>
    canonicalPathFor(getCache().index, pathname),
  store: (name: string, value?: any) => {
    if (value === undefined) {
      return $app.store<any>().get(name)
    }
    globalApi.dbg(`store: ${name}`, value)
    $app.store<any>().set(name, value)
    return value
  },
  ...log,
}
