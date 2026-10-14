import { expect, test } from 'bun:test'
import { createHmac } from 'node:crypto'
import { decodeSession, encodeSession, SessionCrypto } from './codec'
import { Session, SessionConfig, SessionHost } from './session'

const crypto = (key = 'key'): SessionCrypto => ({
  // Not real encryption, but the result is not readable and fails to decrypt when wrong
  encrypt: (plain) => Buffer.from(`${key}:${plain}`).toString('base64'),
  decrypt: (blob) => {
    const plain = Buffer.from(blob, 'base64').toString('utf8')
    if (!plain.startsWith(`${key}:`)) throw new Error('decrypt failed')
    return plain.slice(key.length + 1)
  },
  mac: (blob) => createHmac('sha256', key).update(blob).digest('hex'),
  equal: (a, b) => a === b,
})

const payload = (extra = {}) => ({
  data: { user: 'ana', n: 3 },
  flash: { success: ['Saved'] },
  created: 1000,
  expires: 5000,
  ...extra,
})

test('a session survives the trip in a cookie', () => {
  const c = crypto()
  const cookie = encodeSession(c, payload())
  expect(cookie.startsWith('v1.')).toBe(true)
  expect(decodeSession(c, cookie, 2000)).toEqual(payload())
})

test('the cookie does not show what is in it', () => {
  const c = crypto()
  const cookie = encodeSession(c, payload())
  expect(cookie).not.toContain('ana')
  expect(cookie).not.toContain('Saved')
})

test('cookies that are not good sessions are refused', () => {
  const c = crypto()
  const good = encodeSession(c, payload())
  const [blob, mac] = [
    good.slice(3, good.lastIndexOf('.')),
    good.slice(good.lastIndexOf('.') + 1),
  ]

  expect(decodeSession(c, good, 5000)).toBeUndefined() // ended
  expect(decodeSession(c, good, 9999)).toBeUndefined()
  expect(decodeSession(crypto('other'), good, 2000)).toBeUndefined() // someone else's
  expect(decodeSession(c, `v1.${blob}.${'0'.repeat(64)}`, 2000)).toBeUndefined() // changed
  expect(decodeSession(c, `v1.${blob}x.${mac}`, 2000)).toBeUndefined()
  expect(decodeSession(c, `v2.${blob}.${mac}`, 2000)).toBeUndefined()
  expect(decodeSession(c, blob + '.' + mac, 2000)).toBeUndefined()
  for (const junk of [
    undefined,
    null,
    '',
    'v1.',
    'v1..',
    'v1.a.b',
    42,
    {},
    'a.b.c.d',
  ]) {
    expect(decodeSession(c, junk, 2000)).toBeUndefined()
  }
})

test('garbage never gets as far as decryption', () => {
  const c = crypto()
  let decrypted = 0
  const spy: SessionCrypto = {
    ...c,
    decrypt: (blob) => {
      decrypted++
      return c.decrypt(blob)
    },
  }
  expect(
    decodeSession(spy, 'v1.' + 'A'.repeat(20) + '.' + 'b'.repeat(64), 1)
  ).toBeUndefined()
  expect(decrypted).toBe(0)
})

test('well signed things that are not sessions are refused', () => {
  const c = crypto()
  const forge = (value: unknown) => {
    const blob = c.encrypt(JSON.stringify(value))
    return `v1.${blob}.${c.mac(blob)}`
  }
  expect(decodeSession(c, forge({ d: {}, f: {}, c: 1, e: 9 }), 1)).toBeDefined()
  expect(decodeSession(c, forge('text'), 1)).toBeUndefined()
  expect(decodeSession(c, forge(null), 1)).toBeUndefined()
  expect(decodeSession(c, forge({ d: {}, f: {}, c: 1 }), 1)).toBeUndefined()
  expect(
    decodeSession(c, forge({ d: [], f: 3, c: 1, e: 9 }), 1)
  ).toBeUndefined()
  expect(
    decodeSession(c, forge({ d: {}, f: {}, c: '1', e: 9 }), 1)
  ).toBeUndefined()
})

// --- the session object

const config: SessionConfig = {
  maxAge: 1000,
  rolling: true,
  maxBytes: 3800,
  flashLimit: 3,
}

type Written = { value: string; maxAge: number }

/** A browser: keeps the cookie, and lets requests be made with it */
const browser = (c = crypto(), cfg: Partial<SessionConfig> = {}) => {
  let cookie: unknown
  let now = 10_000
  const state = {
    time: (seconds: number) => {
      now = seconds
    },
    cookie: () => cookie,
    set: (value: unknown) => {
      cookie = value
    },
    writes: [] as Written[],
    removals: 0,
  }
  const request = (fn: (session: Session) => void) => {
    const callbacks: Array<() => void> = []
    const host: SessionHost = {
      now: () => now,
      read: () => cookie,
      write: (value, maxAge) => {
        state.writes.push({ value, maxAge })
        cookie = value
      },
      remove: () => {
        state.removals++
        cookie = undefined
      },
      beforeSend: (callback) => callbacks.push(callback),
    }
    const session = new Session(c, host, { ...config, ...cfg })
    fn(session)
    // The response goes out
    for (const callback of callbacks) callback()
  }
  return { ...state, request, state }
}

test('a session that is only read sets no cookie', () => {
  const b = browser()
  b.request((s) => {
    expect(s.get('user')).toBeUndefined()
    expect(s.get('user', 'guest')).toBe('guest')
    expect(s.has('user')).toBe(false)
    expect(s.all()).toEqual({})
    expect(s.flashes()).toEqual({})
  })
  expect(b.state.writes).toHaveLength(0)
  expect(b.state.removals).toBe(0)
})

test('what is set in a request is there in the next', () => {
  const b = browser()
  b.request((s) => {
    s.set('user', { id: 'u1', name: 'Ana' }).set('visits', 1)
  })
  expect(b.state.writes).toHaveLength(1)
  b.request((s) => {
    expect(s.get('user')).toEqual({ id: 'u1', name: 'Ana' })
    expect(s.get('visits')).toBe(1)
    expect(s.has('visits')).toBe(true)
    expect(s.all()).toEqual({ user: { id: 'u1', name: 'Ana' }, visits: 1 })
    s.set('visits', 2)
    s.delete('user')
  })
  b.request((s) => {
    expect(s.all()).toEqual({ visits: 2 })
  })
})

test('the cookie is written once per request, however much the session changed', () => {
  const b = browser()
  b.request((s) => {
    s.set('a', 1)
    s.set('b', 2)
    s.set('a', 3)
    s.delete('b')
    s.flash('info', 'x')
  })
  expect(b.state.writes).toHaveLength(1)
})

test('setting undefined removes a value', () => {
  const b = browser()
  b.request((s) => s.set('a', 1))
  b.request((s) => {
    s.set('a', undefined)
    expect(s.has('a')).toBe(false)
  })
  expect(b.state.removals).toBe(1) // nothing left, so no cookie
})

test('values that are not JSON are refused when set', () => {
  const b = browser()
  b.request((s) => {
    expect(() => s.set('fn', () => 1)).toThrow('JSON')
    expect(() => s.set('sym', Symbol('x'))).toThrow('JSON')
  })
})

test('clear forgets everything and takes the cookie away', () => {
  const b = browser()
  b.request((s) => s.set('a', 1).flash('info', 'x'))
  expect(b.state.cookie()).toBeDefined()
  b.request((s) => {
    s.clear()
    expect(s.all()).toEqual({})
    expect(s.hasFlashes()).toBe(false)
  })
  expect(b.state.cookie()).toBeUndefined()
  expect(b.state.removals).toBe(1)
})

test('clearing a session that was never there sends nothing', () => {
  const b = browser()
  b.request((s) => s.clear())
  expect(b.state.writes).toHaveLength(0)
  expect(b.state.removals).toBe(0)
})

test('flash messages are for the next request, and gone after being read', () => {
  const b = browser()
  b.request((s) => {
    s.flash('success', 'Saved').flash('success', 'Sent').flash('error', 'Oops')
    // Not visible to the request that leaves them
    expect(s.flashes()).toEqual({})
  })
  b.request((s) => {
    expect(s.hasFlashes()).toBe(true)
    expect(s.flashes()).toEqual({ success: ['Saved', 'Sent'], error: ['Oops'] })
    expect(s.hasFlashes()).toBe(false)
    expect(s.flashes()).toEqual({})
  })
  b.request((s) => {
    expect(s.flashes()).toEqual({})
  })
  expect(b.state.cookie()).toBeUndefined()
})

test('flash messages can be read by type', () => {
  const b = browser()
  b.request((s) => s.flash('success', 'Saved').flash('error', 'Oops'))
  b.request((s) => {
    expect(s.flashes('success')).toEqual(['Saved'])
    expect(s.flashes('success')).toEqual([])
    expect(s.flashes('nothing')).toEqual([])
  })
  b.request((s) => {
    expect(s.flashes()).toEqual({ error: ['Oops'] })
  })
})

test('messages nobody read wait for the request that does', () => {
  const b = browser()
  b.request((s) => s.flash('info', 'for later'))
  // A redirect, say: this request shows nothing
  b.request((s) => {
    expect(s.get('anything')).toBeUndefined()
    s.set('x', 1)
  })
  b.request((s) => {
    expect(s.flashes()).toEqual({ info: ['for later'] })
  })
})

test('messages left while others are waiting are added to them', () => {
  const b = browser()
  b.request((s) => s.flash('info', 'one'))
  b.request((s) => s.flash('info', 'two'))
  b.request((s) => {
    expect(s.flashes('info')).toEqual(['one', 'two'])
  })
})

test('no more messages than the limit are kept, the oldest go first', () => {
  const b = browser()
  b.request((s) => {
    for (let i = 0; i < 10; i++) s.flash('info', `m${i}`)
  })
  b.request((s) => {
    expect(s.flashes('info')).toEqual(['m7', 'm8', 'm9'])
  })
})

test('the limit is for all the messages waiting, not for each request', () => {
  const b = browser()
  for (let i = 0; i < 10; i++) b.request((s) => s.flash('info', `m${i}`))
  b.request((s) => {
    expect(s.flashes('info')).toEqual(['m7', 'm8', 'm9'])
  })
})

test('a message that is already waiting is not left again', () => {
  const b = browser()
  for (let i = 0; i < 50; i++)
    b.request((s) => s.flash('info', 'Please sign in'))
  b.request((s) => {
    expect(s.flashes('info')).toEqual(['Please sign in'])
  })
  b.request((s) => {
    s.flash('info', 'a')
      .flash('info', 'a')
      .flash('error', 'a')
      .flash('info', { n: 1 })
      .flash('info', { n: 1 })
  })
  b.request((s) => {
    expect(s.flashes()).toEqual({ info: ['a', { n: 1 }], error: ['a'] })
  })
})

test('messages are given up before a session cannot be sent', () => {
  const b = browser(crypto(), { maxBytes: 400, flashLimit: 50 })
  b.request((s) => {
    s.set('user', 'ana')
    for (let i = 0; i < 40; i++)
      s.flash('info', `message number ${i} `.repeat(3))
  })
  expect(b.state.writes).toHaveLength(1)
  expect(
    encodeURIComponent(b.state.writes[0]!.value).length
  ).toBeLessThanOrEqual(400)
  b.request((s) => {
    expect(s.get('user')).toBe('ana')
    const kept = s.flashes('info') as string[]
    expect(kept.length).toBeGreaterThan(0)
    expect(kept.length).toBeLessThan(40)
    // The newest ones survive
    expect(kept[kept.length - 1]).toContain('message number 39')
  })
})

test('flash messages have to be JSON', () => {
  const b = browser()
  b.request((s) => {
    expect(() => s.flash('info', () => 1)).toThrow('JSON')
  })
})

test('a session that is too large is not sent', () => {
  const b = browser(crypto(), { maxBytes: 200 })
  expect(() => b.request((s) => s.set('big', 'x'.repeat(500)))).toThrow(
    'too large'
  )
  expect(b.state.writes).toHaveLength(0)
})

test('cookies that are not ours are replaced and the stale one goes away', () => {
  const b = browser()
  b.state.set('v1.junk.junk')
  b.request((s) => {
    expect(s.all()).toEqual({})
  })
  expect(b.state.removals).toBe(1)
  expect(b.state.cookie()).toBeUndefined()

  b.state.set('v1.junk.junk')
  b.request((s) => s.set('a', 1))
  expect(decodeSession(crypto(), b.state.cookie(), 10_001)?.data).toEqual({
    a: 1,
  })
})

test('sessions end', () => {
  const b = browser(crypto(), { rolling: false })
  b.request((s) => s.set('a', 1))
  b.state.time(10_000 + 999)
  b.request((s) => expect(s.get('a')).toBe(1))
  b.state.time(10_000 + 1000)
  b.request((s) => expect(s.get('a')).toBeUndefined())
})

test('a session that is used is kept alive once half of its time is gone', () => {
  const b = browser()
  b.request((s) => s.set('a', 1))
  expect(b.state.writes[0]!.maxAge).toBe(1000)

  // A quarter of the way: just reading sends nothing
  b.state.time(10_000 + 250)
  b.request((s) => s.get('a'))
  expect(b.state.writes).toHaveLength(1)

  // Past half: reading is enough to renew it
  b.state.time(10_000 + 600)
  b.request((s) => expect(s.get('a')).toBe(1))
  expect(b.state.writes).toHaveLength(2)
  expect(b.state.writes[1]!.maxAge).toBe(1000)

  // So it is still there well after the first one would have ended
  b.state.time(10_000 + 1400)
  b.request((s) => expect(s.get('a')).toBe(1))
})

test('without rolling a session ends when it was meant to', () => {
  const b = browser(crypto(), { rolling: false })
  b.request((s) => s.set('a', 1))
  b.state.time(10_000 + 600)
  b.request((s) => s.set('b', 2))
  expect(b.state.writes[1]!.maxAge).toBe(400)
  b.state.time(10_000 + 1000)
  b.request((s) => expect(s.get('a')).toBeUndefined())
})
