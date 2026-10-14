/**
 * A key-value store shared by every JS runtime, which is what the store of PocketBase is.
 * Anything with these methods will do for tests.
 */
export type KeyValue = {
  get: (key: string) => unknown
  set: (key: string, value: unknown) => void
  remove: (key: string) => void
  keys: () => string[]
}

/** A page, as it is kept */
export type Entry = {
  body: string
  etag: string
  /** Milliseconds since 1970 */
  created: number
  /** The page is good until then */
  expires: number
  /** Names of the things it depends on, comma separated */
  tags: string
  /** The generation of each of them when it was rendered, comma separated, then the global one */
  gens: string
  /** The headers to send with it, as lines of `Name: value` */
  headers: string
}

const ENTRY = 'pp:pc:e:'
const GEN = 'pp:pc:g:'
/** How many pages were saved since the last sweep. A guess, runtimes race on it. */
const SAVES = 'pp:pc:n'

export const TAG = /^[A-Za-z0-9:_.-]{1,64}$/

const generationOf = (kv: KeyValue, tag: string): number => {
  const value = kv.get(GEN + tag)
  return typeof value === 'number' ? value : 0
}

export type PageStore = {
  /** The generation of each tag and the global one now: what a page that depends on them was made from */
  generations: (tags: string[]) => {
    tags: string[]
    gens: number[]
    global: number
  }
  /** The page for `key` if it is there, fresh, and nothing it depends on changed */
  lookup: (key: string, now: number) => Entry | undefined
  save: (key: string, entry: Entry) => void
  /** Pages that depend on `tag` are no good any more */
  purge: (tag: string) => void
  /** Pages whose address starts with `prefix` (`/blog`) are gone */
  purgePath: (prefix: string) => number
  purgeAll: () => void
  /** Removes pages that are out of date, and the oldest ones if there are too many. Returns how many are left. */
  sweep: (now: number) => number
}

/** The store makes room after this many saves at the latest, whatever the clock says */
export const sweepEveryFor = (maxEntries: number) =>
  Math.max(8, Math.ceil(maxEntries / 10))

const encodeKey = (key: string) => ENTRY + key

export const createPageStore = (
  kv: KeyValue,
  maxEntries: number
): PageStore => {
  const generations: PageStore['generations'] = (tags) => ({
    tags,
    gens: tags.map((tag) => generationOf(kv, tag)),
    global: generationOf(kv, '*'),
  })

  const isFresh = (entry: Entry, now: number): boolean => {
    if (entry.expires <= now) return false
    const tags = entry.tags ? entry.tags.split(',') : []
    const gens = entry.gens.split(',')
    // The last one is the global generation
    if (Number(gens[gens.length - 1]) !== generationOf(kv, '*')) return false
    for (let i = 0; i < tags.length; i++) {
      if (Number(gens[i]) !== generationOf(kv, tags[i]!)) return false
    }
    return true
  }

  const readEntry = (value: unknown): Entry | undefined => {
    if (!value || typeof value !== 'object') return undefined
    const e = value as Record<string, unknown>
    if (typeof e.body !== 'string' || typeof e.expires !== 'number')
      return undefined
    return {
      body: e.body,
      etag: String(e.etag),
      created: Number(e.created),
      expires: e.expires,
      tags: String(e.tags ?? ''),
      gens: String(e.gens ?? '0'),
      headers: String(e.headers ?? ''),
    }
  }

  const lookup: PageStore['lookup'] = (key, now) => {
    const entry = readEntry(kv.get(encodeKey(key)))
    return entry && isFresh(entry, now) ? entry : undefined
  }

  const sweepEvery = sweepEveryFor(maxEntries)

  const save: PageStore['save'] = (key, entry) => {
    kv.set(encodeKey(key), entry)
    // Making room on a timer is not enough: a crawler asking for a thousand different
    // addresses fills the memory of the server before the timer fires. So it is done after
    // a number of saves too, which bounds the pages to `maxEntries` plus that many.
    const saves = kv.get(SAVES)
    const n = (typeof saves === 'number' ? saves : 0) + 1
    if (n >= sweepEvery) sweep(entry.created)
    else kv.set(SAVES, n)
  }

  const bump = (tag: string) => {
    kv.set(GEN + tag, generationOf(kv, tag) + 1)
  }

  const purge: PageStore['purge'] = (tag) => {
    if (!TAG.test(tag))
      throw new Error(`Invalid page cache tag: ${JSON.stringify(tag)}`)
    bump(tag)
  }

  const purgeAll = () => bump('*')

  const purgePath: PageStore['purgePath'] = (prefix) => {
    let removed = 0
    // Keys are `GET\nhost\npath?query\nvariants`
    for (const key of kv.keys()) {
      if (!key.startsWith(ENTRY)) continue
      const parts = key.slice(ENTRY.length).split('\n')
      const path = parts[2] ?? ''
      if (
        path === prefix ||
        path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`) ||
        path.startsWith(`${prefix}?`)
      ) {
        kv.remove(key)
        removed++
      }
    }
    return removed
  }

  const sweep: PageStore['sweep'] = (now) => {
    const entries: Array<{ key: string; created: number }> = []
    for (const key of Array.from(kv.keys())) {
      if (!key.startsWith(ENTRY)) continue
      const entry = readEntry(kv.get(key))
      if (!entry || !isFresh(entry, now)) {
        kv.remove(key)
        continue
      }
      entries.push({ key, created: entry.created })
    }
    kv.set(SAVES, 0)
    if (entries.length > maxEntries) {
      entries.sort((a, b) => a.created - b.created)
      // Make room for a good while, not for one more page
      const drop = entries.length - Math.floor(maxEntries * 0.9)
      for (let i = 0; i < drop; i++) kv.remove(entries[i]!.key)
      return entries.length - drop
    }
    return entries.length
  }

  return { generations, lookup, save, purge, purgePath, purgeAll, sweep }
}
