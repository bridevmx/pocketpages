import { createHmac, randomBytes } from 'node:crypto'
import path from 'node:path'

/**
 * A fake PocketBase to drive the middleware (and the plugins loaded into it) with,
 * without a server. Only what the code under test touches is faked.
 */

export const store = new Map<string, any>()
let epoch = 0
const g = globalThis as any

/** The error classes of PocketBase's JSVM: plain objects with a status, not `Error`s */
export class FakeApiError {
  status: number
  message: string
  data: any
  constructor(status: number, message = '', data: any = {}) {
    this.status = status
    this.message = message
    this.data = data
  }
}

const errorClass = (status: number) =>
  class extends FakeApiError {
    constructor(message = '', data: any = {}) {
      super(status, message, data)
    }
  }

export const installGlobals = () => {
  g.$app = {
    store: () => ({
      get: (key: string) => store.get(key) ?? null,
      set: (key: string, value: any) => {
        store.set(key, value)
      },
      has: (key: string) => store.has(key),
      remove: (key: string) => {
        store.delete(key)
      },
      getOrSet: (key: string, fn: () => any) => {
        if (!store.has(key)) store.set(key, fn())
        return store.get(key)
      },
      keys: () => Array.from(store.keys()),
      setFunc: (key: string, fn: (old: any) => any) => {
        store.set(key, fn(store.get(key) ?? null))
      },
    }),
    isDev: () => false,
    logger: () => ({ debug() {}, info() {}, warn() {}, error() {} }),
    findCollectionByNameOrId: () => ({
      authToken: { secret: 's'.repeat(50) },
    }),
    settings: () => ({ meta: { appURL: 'https://example.test' } }),
  }
  g.$security = {
    randomString: (n = 8) => {
      if (n === 12) return `epoch-${++epoch}`
      return randomBytes(Math.ceil(n / 2))
        .toString('hex')
        .slice(0, n)
    },
    randomStringWithAlphabet: (n: number, alphabet: string) => {
      let s = ''
      for (let i = 0; i < n; i++) {
        s += alphabet[Math.floor(Math.random() * alphabet.length)]
      }
      return s
    },
    hs256: (message: string, key: string) =>
      createHmac('sha256', key).update(message).digest('hex'),
    equal: (a: string, b: string) => a === b,
    sha256: (s: string) => createHmac('sha256', 'k').update(s).digest('hex'),
    // Not real encryption, but it can be told apart from plain text and fails for
    // anything that was not made by encrypt()
    encrypt: (data: string, key: string) =>
      Buffer.from(`${key.length}:${data}`).toString('base64'),
    decrypt: (data: string, key: string) => {
      const plain = Buffer.from(data, 'base64').toString('utf8')
      const colon = plain.indexOf(':')
      if (colon < 0 || plain.slice(0, colon) !== `${key.length}`) {
        throw new Error('decrypt failed')
      }
      return plain.slice(colon + 1)
    },
  }
  g.$filepath = {
    join: (...parts: string[]) => path.join(...parts),
    dir: (p: string) => path.dirname(p),
    base: (p: string) => path.basename(p),
    ext: (p: string) => path.extname(p),
    toSlash: (p: string) => p,
  }
  g.$os = {
    dirFS: (dir: string) => ({ dir }),
    getenv: (key: string) => process.env[key] ?? '',
  }
  g.__hooks = '/hooks'
  const classes = {
    BadRequestError: errorClass(400),
    UnauthorizedError: errorClass(401),
    ForbiddenError: errorClass(403),
    NotFoundError: errorClass(404),
    TooManyRequestsError: errorClass(429),
    InternalServerError: errorClass(500),
  }
  Object.assign(g, classes)
  g.ApiError = FakeApiError
}

installGlobals()

export const route = (
  relativePath: string,
  extra: Record<string, any> = {}
) => {
  const parts = relativePath.split('/')
  return {
    relativePath,
    absolutePath: `/hooks/pages/${relativePath}`,
    fingerprint: 'abc123',
    assetPrefix: parts[parts.length - 2] ?? '',
    segments: parts.map((nodeName) => ({ nodeName })),
    isStatic: true,
    middlewares: [],
    loaders: {},
    layouts: [],
    ...extra,
  }
}

export type Seen = {
  next: number
  html: [number, string][]
  json: [number, any][]
  text: [number, string][]
  noContent: number[]
  redirects: [number, string][]
  files: string[]
  writes: string[]
  /** The first value of each header, by the name it was set with */
  headers: Record<string, string>
  /** Every value of a header, by lower case name */
  values: (name: string) => string[]
  written: boolean
  /** The status of the response, `0` until something is written */
  status: number
}

export type EventOptions = {
  headers?: Record<string, string>
  body?: any
  auth?: any
  ip?: string
}

export const makeEvent = (
  rawUrl: string,
  method = 'GET',
  options: EventOptions = {}
) => {
  const multi = new Map<string, string[]>()
  const requestHeaders: Record<string, string> = {}
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    requestHeaders[name.toLowerCase()] = value
  }
  const seen: Seen = {
    next: 0,
    html: [],
    json: [],
    text: [],
    noContent: [],
    redirects: [],
    files: [],
    writes: [],
    headers: {},
    values: (name) => multi.get(name.toLowerCase()) ?? [],
    written: false,
    status: 0,
  }
  const e: any = {
    auth: options.auth ?? null,
    request: {
      url: { string: () => rawUrl },
      method,
      host: 'example.test',
      header: {
        get: (name: string) => requestHeaders[name.toLowerCase()] ?? '',
      },
    },
    response: {
      header: () => ({
        get: (name: string) => multi.get(name.toLowerCase())?.[0] ?? '',
        set: (name: string, value: string) => {
          seen.headers[name] = value
          multi.set(name.toLowerCase(), [value])
        },
        add: (name: string, value: string) => {
          if (seen.headers[name] === undefined) seen.headers[name] = value
          const list = multi.get(name.toLowerCase()) ?? []
          list.push(value)
          multi.set(name.toLowerCase(), list)
        },
        values: (name: string) => (multi.get(name.toLowerCase()) ?? []).slice(),
        del: (name: string) => {
          delete seen.headers[name]
          multi.delete(name.toLowerCase())
        },
      }),
      write: (s: string) => {
        seen.writes.push(s)
        seen.written = true
      },
      written: () => seen.written,
      status: () => seen.status,
    },
    next: () => {
      seen.next++
    },
    html: (status: number, body: string) => {
      seen.html.push([status, body])
      // The status of what is written first stays, like in Go
      if (!seen.written) seen.status = status
      seen.written = true
    },
    json: (status: number, body: any) => {
      seen.json.push([status, body])
      if (!seen.written) seen.status = status
      seen.written = true
    },
    string: (status: number, body: string) => {
      seen.text.push([status, body])
      seen.written = true
    },
    noContent: (status: number) => {
      seen.noContent.push(status)
      seen.written = true
    },
    redirect: (status: number, location: string) => {
      seen.redirects.push([status, location])
      if (!seen.written) seen.status = status
      seen.written = true
    },
    fileFS: (_fs: unknown, name: string) => {
      seen.files.push(name)
      seen.written = true
    },
    requestInfo: () => ({ body: options.body ?? {} }),
    realIP: () => options.ip ?? '203.0.113.9',
  }
  return { e, seen }
}
