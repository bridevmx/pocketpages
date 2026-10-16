import { warn } from 'pocketbase-log'

const SECRET_KEY = 'pocketpages:secret'
const MIN_SECRET_LENGTH = 16

let appSecret: string | undefined
const derived = new Map<string, string>()

/**
 * Where the secret of the app comes from, in this order:
 *
 * 1. the `POCKETPAGES_SECRET` environment variable
 * 2. the secret PocketBase signs the tokens of superusers with, which lives in the
 *    database. It is never rotated by itself and nothing can be derived back from what
 *    is derived from it.
 * 3. random, which only lasts until the next restart
 */
const createAppSecret = (): string => {
  const fromEnv = $os.getenv('POCKETPAGES_SECRET')
  if (fromEnv && fromEnv.length >= MIN_SECRET_LENGTH) {
    return fromEnv
  }
  try {
    const secret = $app.findCollectionByNameOrId('_superusers').authToken.secret
    if (secret && secret.length >= MIN_SECRET_LENGTH) {
      return secret
    }
  } catch {
    // Handled below
  }
  warn(
    `pocketpages: no secret to sign with. Set POCKETPAGES_SECRET (at least ${MIN_SECRET_LENGTH} characters) so that sessions and tokens survive a restart.`
  )
  return $security.randomString(48)
}

/**
 * Shared by every runtime, so a value signed by one can be checked by another
 */
const getAppSecret = (): string => {
  if (appSecret === undefined) {
    appSecret = $app.store<string>().getOrSet(SECRET_KEY, createAppSecret)
  }
  return appSecret
}

/**
 * A key of 64 hexadecimal characters that belongs to this app and to `purpose`.
 * Different purposes get unrelated keys, so a signature made for one means nothing to
 * another. The same app always gets the same key (see `createAppSecret` for what
 * changes it).
 */
export const secret = (purpose: string): string => {
  let key = derived.get(purpose)
  if (key === undefined) {
    key = $security.hs256(`pocketpages:${purpose}`, getAppSecret())
    derived.set(purpose, key)
  }
  return key
}

const SIGNATURE_LENGTH = 64

/**
 * `value.signature`, where the signature is a HMAC-SHA256 of the value. Anyone can read
 * the value, only this app can produce a signature for it.
 */
export const sign = (value: string, purpose = 'sign'): string =>
  `${value}.${$security.hs256(value, secret(`sign:${purpose}`))}`

/**
 * The value `sign()` was given, or `undefined` if the signature does not match or was
 * made for another purpose
 */
export const unsign = (
  signed: string,
  purpose = 'sign'
): string | undefined => {
  if (typeof signed !== 'string') return undefined
  const cut = signed.length - SIGNATURE_LENGTH - 1
  if (cut < 0 || signed.charCodeAt(cut) !== 46 /* . */) return undefined
  const value = signed.slice(0, cut)
  const signature = signed.slice(cut + 1)
  const expected = $security.hs256(value, secret(`sign:${purpose}`))
  return $security.equal(signature, expected) ? value : undefined
}

/** For tests */
export const resetSecrets = () => {
  appSecret = undefined
  derived.clear()
}
