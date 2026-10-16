/**
 * Where the counters live. The PocketBase store is shared by every JS runtime, which is
 * what makes the limits hold for the whole app and not for a runtime at a time.
 */
export type Counters = {
  /** The count, `0` for what was never counted */
  get: (key: string) => number
  /** Adds one, returns the new count. Atomic when the store allows it. */
  increment: (key: string) => number
  remove: (key: string) => void
  keys: () => string[]
}

export type Limit = {
  /** Requests allowed per window */
  limit: number
  /** Window length in seconds */
  window: number
}

export type Decision = {
  allowed: boolean
  limit: number
  /** Requests left, as far as can be told */
  remaining: number
  /** Seconds until the window you are in is over */
  resetIn: number
  /** Seconds to wait before trying again, `0` if allowed */
  retryAfter: number
}

const PREFIX = 'pp:rl|'

export type Limiter = {
  /**
   * Counts a request of `subject` against `limit`. Requests are counted whether they
   * are allowed or not, so that a client that keeps knocking stays out.
   *
   * The count is a sliding one: the requests of the window before this one still weigh
   * as much as what is left of it, so that limits do not reset all at once.
   */
  hit: (scope: string, subject: string, limit: Limit) => Decision
  /** Forgets the counters of windows that are over */
  sweep: () => number
}

export const createLimiter = (
  counters: Counters,
  now: () => number = Date.now
): Limiter => {
  /** The window of each scope seen, to know when its counters are of no use any more */
  const windows = new Map<string, number>()

  const hit: Limiter['hit'] = (scope, subject, { limit, window }) => {
    const windowMs = window * 1000
    const time = now()
    const index = Math.floor(time / windowMs)
    const into = (time % windowMs) / windowMs
    windows.set(scope, windowMs)

    const base = `${PREFIX}${scope}|${subject}|`
    const current = counters.increment(base + index)
    const previous = counters.get(base + (index - 1))
    const estimated = previous * (1 - into) + current
    const allowed = estimated <= limit
    const resetIn = Math.max(
      1,
      Math.ceil((windowMs - (time % windowMs)) / 1000)
    )
    return {
      allowed,
      limit,
      remaining: Math.max(0, Math.floor(limit - estimated)),
      resetIn,
      retryAfter: allowed ? 0 : resetIn,
    }
  }

  const sweep = () => {
    const time = now()
    let removed = 0
    const all = counters.keys()
    for (let i = 0; i < all.length; i++) {
      const key = all[i]!
      if (!key.startsWith(PREFIX)) continue
      const scopeEnd = key.indexOf('|', PREFIX.length)
      const indexStart = key.lastIndexOf('|')
      if (scopeEnd === -1 || indexStart <= scopeEnd) continue
      const windowMs = windows.get(key.slice(PREFIX.length, scopeEnd))
      // A scope this runtime has not seen: another one will sweep it
      if (windowMs === undefined) continue
      const index = Number(key.slice(indexStart + 1))
      if (index < Math.floor(time / windowMs) - 1) {
        counters.remove(key)
        removed++
      }
    }
    return removed
  }

  return { hit, sweep }
}
