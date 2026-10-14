/**
 * What a session cookie needs from the outside, so that the format can be tested
 * without PocketBase.
 */
export type SessionCrypto = {
  /** Turns text into text that only this app can read back */
  encrypt: (plain: string) => string
  /** The opposite. May throw for anything that `encrypt` did not make. */
  decrypt: (blob: string) => string
  /** A signature of `blob` */
  mac: (blob: string) => string
  /** Compares without leaking where the strings differ */
  equal: (a: string, b: string) => boolean
}

export type SessionPayload = {
  /** What the app keeps in the session */
  data: Record<string, unknown>
  /** Messages for the next request to show, by type */
  flash: Record<string, unknown[]>
  /** When the session was started, in seconds since 1970 */
  created: number
  /** When it ends, in seconds since 1970 */
  expires: number
}

const VERSION = 'v1.'

type Wire = {
  d: Record<string, unknown>
  f: Record<string, unknown[]>
  c: number
  e: number
}

/**
 * `v1.<encrypted>.<signature>`. The letter and the dot keep `request.cookies()` from
 * mistaking the value for JSON.
 */
export const encodeSession = (
  crypto: SessionCrypto,
  payload: SessionPayload
): string => {
  const wire: Wire = {
    d: payload.data,
    f: payload.flash,
    c: payload.created,
    e: payload.expires,
  }
  const blob = crypto.encrypt(JSON.stringify(wire))
  return `${VERSION}${blob}.${crypto.mac(blob)}`
}

/**
 * The session in a cookie, or `undefined` when there is none to be had: the cookie was
 * not made by this app, it was changed, or it is out of date.
 *
 * The signature is checked before anything is decrypted, so that what a browser makes up
 * never gets to the decryption.
 */
export const decodeSession = (
  crypto: SessionCrypto,
  value: unknown,
  now: number
): SessionPayload | undefined => {
  if (typeof value !== 'string' || !value.startsWith(VERSION)) return undefined
  const cut = value.lastIndexOf('.')
  if (cut <= VERSION.length - 1) return undefined
  const blob = value.slice(VERSION.length, cut)
  if (!blob || !crypto.equal(value.slice(cut + 1), crypto.mac(blob))) {
    return undefined
  }
  let wire: Wire
  try {
    wire = JSON.parse(crypto.decrypt(blob))
  } catch {
    return undefined
  }
  if (
    !wire ||
    typeof wire !== 'object' ||
    typeof wire.e !== 'number' ||
    typeof wire.c !== 'number' ||
    !wire.d ||
    typeof wire.d !== 'object' ||
    !wire.f ||
    typeof wire.f !== 'object'
  ) {
    return undefined
  }
  if (wire.e <= now) return undefined
  return {
    data: wire.d,
    flash: wire.f,
    created: wire.c,
    expires: wire.e,
  }
}
