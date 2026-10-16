import { decodeSession, encodeSession, SessionCrypto } from './codec'

/**
 * How a session gets to the browser and back, so that it can be tested without
 * PocketBase.
 */
export type SessionHost = {
  /** Seconds since 1970 */
  now: () => number
  /** The cookie the browser sent, as `request.cookies()` gives it */
  read: () => unknown
  /** Sets the cookie */
  write: (value: string, maxAge: number) => void
  /** Deletes the cookie */
  remove: () => void
  /** Runs `callback` just before the response goes out, once */
  beforeSend: (callback: () => void) => void
}

export type SessionConfig = {
  /** Seconds a session lasts */
  maxAge: number
  /** Extend the session when it is used, once half of its time is gone */
  rolling: boolean
  /** The most the cookie can grow to, for the browser keeps no more than about 4 KB */
  maxBytes: number
  /** The most flash messages kept, those not read yet included */
  flashLimit: number
}

/** Removes the oldest message, whichever type it is. Returns false if there was none. */
const dropOldest = (flash: Record<string, unknown[]>): boolean => {
  for (const type of Object.keys(flash)) {
    const messages = flash[type]!
    if (messages.length > 0) {
      messages.shift()
      if (messages.length === 0) delete flash[type]
      return true
    }
  }
  return false
}

const count = (flash: Record<string, unknown[]>) =>
  Object.keys(flash).reduce((n, type) => n + flash[type]!.length, 0)

/**
 * What pages get as `session`. Values have to survive `JSON.stringify()`.
 */
export class Session {
  private loaded = false
  private data: Record<string, unknown> = {}
  /** Flash messages the previous request left for this one */
  private incoming: Record<string, unknown[]> = {}
  /** Flash messages this request leaves for the next one */
  private outgoing: Record<string, unknown[]> = {}
  private created = 0
  private expires = 0
  private existed = false
  /** The cookie the browser has is no good and must go */
  private stale = false
  private dirty = false
  private scheduled = false

  constructor(
    private crypto: SessionCrypto,
    private host: SessionHost,
    private config: SessionConfig
  ) {}

  private load() {
    if (this.loaded) return
    this.loaded = true
    const now = this.host.now()
    const cookie = this.host.read()
    const payload = decodeSession(this.crypto, cookie, now)
    if (payload) {
      this.existed = true
      this.data = payload.data
      this.incoming = payload.flash
      this.created = payload.created
      this.expires = payload.expires
      // Used sessions stay alive, without a cookie being sent for every request
      if (
        this.config.rolling &&
        payload.expires - now < this.config.maxAge / 2
      ) {
        this.touch()
      }
      return
    }
    this.created = now
    this.expires = now + this.config.maxAge
    if (cookie !== undefined && cookie !== null && cookie !== '') {
      this.stale = true
      this.touch()
    }
  }

  /** Something needs to be sent to the browser */
  private touch() {
    this.dirty = true
    if (this.scheduled) return
    this.scheduled = true
    this.host.beforeSend(() => this.commit())
  }

  private commit() {
    if (!this.dirty) return
    const empty =
      Object.keys(this.data).length === 0 &&
      Object.keys(this.incoming).length === 0 &&
      Object.keys(this.outgoing).length === 0
    if (empty) {
      // Nothing worth a cookie. Take the one the browser has away, if there is one.
      if (this.existed || this.stale) this.host.remove()
      return
    }
    // A session that is used does not run out
    if (this.config.rolling) {
      this.expires = this.host.now() + this.config.maxAge
    }
    // What the browser gets next time: the messages this request left, and the ones it
    // was sent and nobody showed
    const flash: Record<string, unknown[]> = {}
    for (const type of Object.keys(this.incoming)) {
      flash[type] = this.incoming[type]!.slice()
    }
    for (const type of Object.keys(this.outgoing)) {
      flash[type] = (flash[type] ?? []).concat(this.outgoing[type]!)
    }
    const encode = () =>
      encodeURIComponent(
        encodeSession(this.crypto, {
          data: this.data,
          flash,
          created: this.created,
          expires: this.expires,
        })
      )
    let value = encode()
    // Messages nobody has shown are the first to go when there is no room, the oldest
    // ones before the others. Only what the page keeps in the session can make it too
    // large to be sent.
    while (value.length > this.config.maxBytes && dropOldest(flash)) {
      value = encode()
    }
    if (value.length > this.config.maxBytes) {
      throw new Error(
        `The session is too large to be kept in a cookie: ${value.length} bytes, ${this.config.maxBytes} at most. Keep ids in it and the rest in the database.`
      )
    }
    this.host.write(
      decodeURIComponent(value),
      Math.max(1, this.expires - this.host.now())
    )
  }

  /** The value of `key`, or `fallback` when there is none */
  get<T = any>(key: string, fallback?: T): T | undefined {
    this.load()
    return key in this.data ? (this.data[key] as T) : fallback
  }

  has(key: string): boolean {
    this.load()
    return key in this.data
  }

  /** Everything in the session, as a copy */
  all(): Record<string, any> {
    this.load()
    return { ...this.data }
  }

  /** Keeps `value` in the session. Setting `undefined` is the same as `delete()`. */
  set(key: string, value: unknown): this {
    this.load()
    if (value === undefined) return this.delete(key)
    // Fails here, where the mistake is, and not when the response is sent
    if (JSON.stringify(value) === undefined) {
      throw new Error(`Session values must be JSON: ${key}`)
    }
    this.data[key] = value
    this.touch()
    return this
  }

  delete(key: string): this {
    this.load()
    if (key in this.data) {
      delete this.data[key]
      this.touch()
    }
    return this
  }

  /** Forgets everything: data and messages alike */
  clear(): this {
    this.load()
    this.data = {}
    this.incoming = {}
    this.outgoing = {}
    this.touch()
    return this
  }

  /**
   * Leaves a message for the next request to show. Meant for what comes before a
   * redirect: `session.flash('success', 'Saved'); redirect('/posts')`.
   */
  flash(type: string, message: unknown): this {
    this.load()
    const text = JSON.stringify(message)
    if (text === undefined) {
      throw new Error(`Flash messages must be JSON: ${type}`)
    }
    // The same message twice would only be shown twice: a visitor sent to the login page
    // again and again gets one "Please sign in"
    const same = (list: unknown[] | undefined) =>
      !!list && list.some((m) => JSON.stringify(m) === text)
    if (same(this.incoming[type]) || same(this.outgoing[type])) return this

    if (!this.outgoing[type]) this.outgoing[type] = []
    this.outgoing[type]!.push(message)
    // Never more than the limit in all, new messages push the oldest ones out
    while (
      count(this.incoming) + count(this.outgoing) >
      this.config.flashLimit
    ) {
      if (!dropOldest(this.incoming) && !dropOldest(this.outgoing)) break
    }
    this.touch()
    return this
  }

  /**
   * The messages the previous request left, `{ success: ['Saved'] }`, or the ones of a
   * single type. They are gone after being read: the next request does not get them.
   */
  flashes(): Record<string, any[]>
  flashes<T = any>(type: string): T[]
  flashes(type?: string): any {
    this.load()
    if (type !== undefined) {
      const messages = this.incoming[type] ?? []
      if (type in this.incoming) {
        delete this.incoming[type]
        this.touch()
      }
      return messages
    }
    const all = this.incoming
    if (Object.keys(all).length > 0) {
      this.incoming = {}
      this.touch()
    }
    return all
  }

  /** True if messages are waiting to be shown */
  hasFlashes(): boolean {
    this.load()
    return Object.keys(this.incoming).length > 0
  }
}
