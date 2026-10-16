import type {
  PagesRequest,
  PagesResponse,
  PluginFactory,
  PluginOptionsBase,
} from 'pocketpages'
import { SessionCrypto } from './codec'
import { Session, SessionConfig } from './session'

export type { SessionPayload } from './codec'
export { Session } from './session'

export type SessionOptions = PluginOptionsBase & {
  /** Where the browser keeps the session, `pp_session` unless told otherwise */
  cookieName: string
  /** Seconds a session lasts, 7 days unless told otherwise */
  maxAge: number
  /**
   * Keep the session alive while it is used (default), instead of ending it a fixed
   * time after it started
   */
  rolling: boolean
  /** `lax` unless told otherwise */
  sameSite: 'lax' | 'strict' | 'none'
  /**
   * Whether the cookie is only sent over HTTPS. `'auto'` (the default) is for requests
   * that came in over HTTPS.
   */
  secure: boolean | 'auto'
  domain: string
  /** The most the cookie can grow to, 3800 bytes unless told otherwise */
  maxBytes: number
  /** The most flash messages waiting, read or not, 20 unless told otherwise. The oldest go first. */
  flashLimit: number
  /**
   * What sessions are protected with. It comes from `POCKETPAGES_SECRET`, or from
   * PocketBase, unless you give one here. Changing it ends every session.
   */
  secret: string
}

const VALID_KEYS = [
  'debug',
  'cookieName',
  'maxAge',
  'rolling',
  'sameSite',
  'secure',
  'domain',
  'maxBytes',
  'flashLimit',
  'secret',
]

const sessionPluginFactory: PluginFactory<SessionOptions> = (config, extra) => {
  const { globalApi } = config

  Object.keys(extra).forEach((key) => {
    if (!VALID_KEYS.includes(key)) {
      throw new Error(`pocketpages-plugin-session: unknown option '${key}'`)
    }
  })

  const options = {
    cookieName: 'pp_session',
    maxAge: 60 * 60 * 24 * 7,
    rolling: true,
    sameSite: 'lax' as const,
    secure: 'auto' as boolean | 'auto',
    domain: undefined as string | undefined,
    maxBytes: 3800,
    flashLimit: 20,
    secret: undefined as string | undefined,
    ...extra,
  }
  if (!/^[A-Za-z0-9_-]+$/.test(options.cookieName)) {
    throw new Error(
      `pocketpages-plugin-session: invalid cookie name ${JSON.stringify(options.cookieName)}`
    )
  }
  if (!(options.maxAge > 0)) {
    throw new Error('pocketpages-plugin-session: maxAge must be above 0')
  }

  const keyFor = (purpose: string) =>
    options.secret
      ? $security.hs256(`pocketpages:${purpose}`, options.secret)
      : globalApi.secret(purpose)
  // Keys are made on first use: not every request has a session, and the secret may
  // not be there yet when the plugin is set up
  let crypto: SessionCrypto | undefined
  const getCrypto = (): SessionCrypto => {
    if (crypto) return crypto
    const encryptionKey = keyFor('session:encryption').slice(0, 32)
    const macKey = keyFor('session:mac')
    const made: SessionCrypto = {
      encrypt: (plain) => $security.encrypt(plain, encryptionKey),
      decrypt: (blob) => {
        const plain = $security.decrypt(blob, encryptionKey)
        return typeof plain === 'string' ? plain : toString(plain)
      },
      mac: (blob) => $security.hs256(blob, macKey),
      equal: (a, b) => $security.equal(a, b),
    }
    crypto = made
    return made
  }

  const sessionConfig: SessionConfig = {
    maxAge: options.maxAge,
    rolling: options.rolling,
    maxBytes: options.maxBytes,
    flashLimit: options.flashLimit,
  }

  /**
   * Made for the first plugin or page that wants it. Nothing is read or written until
   * the session is used.
   */
  const sessionOf = (request: PagesRequest, response: PagesResponse) => {
    const known = request.state.session as Session | undefined
    if (known) return known
    const secure = () =>
      options.secure === 'auto' ? request.secure : options.secure
    const session = new Session(
      {
        encrypt: (plain) => getCrypto().encrypt(plain),
        decrypt: (blob) => getCrypto().decrypt(blob),
        mac: (blob) => getCrypto().mac(blob),
        equal: (a, b) => getCrypto().equal(a, b),
      },
      {
        now: () => Math.floor(Date.now() / 1000),
        read: () => request.cookies(options.cookieName),
        write: (value, maxAge) => {
          response.cookie(options.cookieName, value, {
            httpOnly: true,
            sameSite: options.sameSite,
            secure: secure(),
            domain: options.domain,
            maxAge,
          })
        },
        remove: () => {
          response.cookie(options.cookieName, '', {
            httpOnly: true,
            sameSite: options.sameSite,
            secure: secure(),
            domain: options.domain,
            maxAge: 0,
          })
        },
        beforeSend: (callback) => response.beforeSend(callback),
      },
      sessionConfig
    )
    request.state.session = session
    return session
  }

  return {
    name: 'session',

    // So that the plugins after this one can leave flash messages, even when they
    // refuse the request before the page is set up
    onRequest: ({ request, response, route }) => {
      if (route && !route.isStatic) sessionOf(request, response)
    },

    onExtendContextApi: ({ api }) => {
      api.session = sessionOf(api.request, api.response)
    },
  }
}

export default sessionPluginFactory
