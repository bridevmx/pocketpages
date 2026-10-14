import type { SerializeOptions } from 'cookie'
import * as cookie from 'cookie'
import { stringify } from 'pocketbase-stringify'
import { dbg, isDebug } from './debug'
import { PagesResponse } from './types'

export type ResponseHandle = {
  response: PagesResponse
  /**
   * Runs what plugins asked to do with `response.beforeSend()`. The response methods do
   * it by themselves, this is for the requests that are handed to PocketBase instead.
   * Returns whether there was anything to run.
   */
  flush: () => boolean
}

/**
 * The `response` plugins and pages get, on top of the PocketBase request event.
 */
export const createResponse = (e: core.RequestEvent): ResponseHandle => {
  /** Callbacks waiting for the response to go out, see `beforeSend()` */
  let pending: Array<() => void> | undefined
  let flushing = false
  let pageStatus = 200

  const flush = (): boolean => {
    if (!pending || pending.length === 0 || flushing) return false
    // A callback that writes the response itself must not run the others twice
    flushing = true
    try {
      while (pending.length > 0) {
        pending.shift()!()
      }
    } finally {
      flushing = false
    }
    return true
  }

  /**
   * `Set-Cookie` is the one header that is sent more than once, so a cookie replaces
   * the one set earlier with the same name but leaves the others alone.
   */
  const setCookieHeader = (name: string, serialized: string) => {
    const headers = e.response.header()
    const existing = headers.values('Set-Cookie')
    const prefix = `${name}=`
    let replaces = false
    for (let i = 0; i < existing.length; i++) {
      if (existing[i]!.startsWith(prefix)) {
        replaces = true
        break
      }
    }
    if (replaces) {
      const keep: string[] = []
      for (let i = 0; i < existing.length; i++) {
        if (!existing[i]!.startsWith(prefix)) keep.push(existing[i]!)
      }
      headers.del('Set-Cookie')
      for (let i = 0; i < keep.length; i++) {
        headers.add('Set-Cookie', keep[i]!)
      }
    }
    headers.add('Set-Cookie', serialized)
  }

  const response: PagesResponse = {
    file: (path: string) => {
      flush()
      return e.fileFS($os.dirFS($filepath.dir(path)), $filepath.base(path))
    },
    write: (s: string) => {
      flush()
      e.response.write(s)
    },
    redirect: (path: string, status = 302) => {
      flush()
      e.redirect(status, path)
    },
    json: (status: number, data: any) => {
      flush()
      e.json(status, data)
    },
    html: (status: number, data: string) => {
      flush()
      e.html(status, data)
    },
    text: (status: number, data: string) => {
      flush()
      e.string(status, data)
    },
    noContent: (status = 204) => {
      flush()
      e.noContent(status)
    },
    header: (name: string, value?: string) => {
      if (value === undefined) {
        return e.response.header().get(name) || ''
      }
      if (isDebug()) dbg(`header: ${name} ${value}`)
      e.response.header().set(name, value)
      return value
    },
    addHeader: (name: string, value: string) => {
      if (isDebug()) dbg(`header (added): ${name} ${value}`)
      e.response.header().add(name, value)
    },
    cookie: <T>(
      name: string,
      value: T,
      options: Partial<SerializeOptions> = {}
    ) => {
      const _options = {
        path: '/',
        ...options,
      }
      const stringifiedValue = (() => {
        if (typeof value !== 'string') {
          return stringify(value)
        }
        return value
      })()
      const serialized = cookie.serialize(name, stringifiedValue, _options)
      setCookieHeader(name, serialized)
      return serialized
    },
    beforeSend: (callback: () => void) => {
      if (!pending) pending = []
      pending.push(callback)
    },
    sent: () => !!e.response.written?.(),
    status: (code?: number) => {
      if (code !== undefined) pageStatus = code
      return pageStatus
    },
  }

  return { response, flush }
}
