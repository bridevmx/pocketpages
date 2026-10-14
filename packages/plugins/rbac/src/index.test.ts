import { expect, test } from 'bun:test'
import { pathMatcher } from '../../../pocketpages/src/lib/pathMatch'

const g = globalThis as any
class FakeError {
  constructor(
    public status: number,
    public message = ''
  ) {}
}
g.UnauthorizedError = class extends FakeError {
  constructor(m?: string) {
    super(401, m)
  }
}
g.ForbiddenError = class extends FakeError {
  constructor(m?: string) {
    super(403, m)
  }
}
g.NotFoundError = class extends FakeError {
  constructor(m?: string) {
    super(404, m)
  }
}

const { default: factory } = await import('./index')

const make = (options: Record<string, any> = {}) =>
  factory({ globalApi: { pathMatcher }, dbg: () => {} } as any, {
    debug: false,
    rules: [
      { path: '/account/**', auth: true },
      { path: '/admin/**', roles: ['admin'] },
      { path: '/orders/**', verified: true },
    ],
    ...options,
  })

type Who =
  | { id: string; fields?: Record<string, unknown>; collection?: string }
  | undefined

const exchange = (
  init: {
    path?: string
    method?: string
    who?: Who
    accept?: string
    route?: any
    query?: string
  } = {}
) => {
  const redirects: [string, number][] = []
  const flashes: [string, string][] = []
  const who = init.who
  const request: any = {
    method: init.method ?? 'GET',
    pathname: init.path ?? '/',
    state: {
      session: {
        flash: (type: string, message: string) => flashes.push([type, message]),
      },
    },
    header: (name: string) =>
      name.toLowerCase() === 'accept' ? (init.accept ?? 'text/html') : '',
    auth: who && {
      id: who.id,
      get: (field: string) => who.fields?.[field],
      collection: () => ({ name: who.collection ?? 'users' }),
    },
    event: {
      request: { url: { path: init.path ?? '/', rawQuery: init.query ?? '' } },
    },
  }
  const response: any = {
    redirect: (to: string, status: number) => redirects.push([to, status]),
  }
  const route = 'route' in init ? init.route : { isStatic: false }
  return { request, response, route, redirects, flashes }
}

const attempt = (plugin: any, x: ReturnType<typeof exchange>) => {
  try {
    plugin.onRequest({
      request: x.request,
      response: x.response,
      route: x.route,
    })
  } catch (e) {
    return e as FakeError
  }
  return undefined
}

const member: Who = { id: 'u1', fields: { role: 'member', verified: true } }
const admin: Who = { id: 'u2', fields: { role: 'admin', verified: true } }

test('unknown options are refused', () => {
  expect(() => make({ role: 'x' })).toThrow("unknown option 'role'")
  expect(() => make({ rules: [{ path: '/x' }] })).toThrow('says nothing')
})

test('visitors, users and admins get what the rules say', () => {
  const plugin = make()
  expect(attempt(plugin, exchange({ path: '/' }))).toBeUndefined()
  expect(attempt(plugin, exchange({ path: '/account/x' }))).toMatchObject({
    status: 401,
  })
  expect(
    attempt(plugin, exchange({ path: '/account/x', who: member }))
  ).toBeUndefined()
  expect(
    attempt(plugin, exchange({ path: '/admin', who: member }))
  ).toMatchObject({ status: 403 })
  expect(
    attempt(plugin, exchange({ path: '/admin', who: admin }))
  ).toBeUndefined()
})

test('static files in the pages are protected too', () => {
  const plugin = make()
  expect(
    attempt(
      plugin,
      exchange({ path: '/admin/report.pdf', route: { isStatic: true } })
    )
  ).toMatchObject({ status: 401 })
})

test('requests that are not for pages are left to PocketBase', () => {
  const plugin = make({ rules: [{ path: '/**', auth: true }] })
  expect(
    attempt(plugin, exchange({ path: '/api/collections', route: null }))
  ).toBeUndefined()
})

test('users who have not confirmed their email address are refused', () => {
  const plugin = make()
  const unconfirmed: Who = {
    id: 'u3',
    fields: { role: 'member', verified: false },
  }
  const error = attempt(
    plugin,
    exchange({ path: '/orders/1', who: unconfirmed })
  )
  expect(error).toMatchObject({ status: 403 })
  const ok = attempt(plugin, exchange({ path: '/orders/1', who: member }))
  expect(ok).toBeUndefined()
})

test('superusers of PocketBase have the role superuser, and are verified', () => {
  const plugin = make({
    rules: [
      { path: '/staff/**', roles: ['superuser'] },
      { path: '/orders/**', verified: true },
    ],
  })
  const superuser: Who = { id: 's1', collection: '_superusers' }
  expect(
    attempt(plugin, exchange({ path: '/staff', who: superuser }))
  ).toBeUndefined()
  expect(
    attempt(plugin, exchange({ path: '/orders', who: superuser }))
  ).toBeUndefined()
  expect(
    attempt(plugin, exchange({ path: '/staff', who: member }))
  ).toMatchObject({ status: 403 })
})

test('the field with the role can be changed, and may hold several roles', () => {
  const plugin = make({ roleField: 'roles' })
  const staff: Who = {
    id: 'u4',
    fields: { roles: ['editor', 'admin'], verified: true },
  }
  expect(
    attempt(plugin, exchange({ path: '/admin', who: staff }))
  ).toBeUndefined()
  expect(
    attempt(plugin, exchange({ path: '/admin', who: admin }))
  ).toMatchObject({ status: 403 })
})

test('pages that should not be known to exist are 404s', () => {
  const plugin = make({
    rules: [{ path: '/secret/**', roles: ['admin'], hide: true }],
  })
  expect(
    attempt(plugin, exchange({ path: '/secret', who: member }))
  ).toMatchObject({ status: 404 })
  expect(attempt(plugin, exchange({ path: '/secret' }))).toMatchObject({
    status: 404,
  })
})

// --- the answers

const answer = (plugin: any, x: ReturnType<typeof exchange>, status: number) =>
  plugin.onError({
    status,
    error: new FakeError(status),
    request: x.request,
    response: x.response,
    route: x.route,
  })

test('visitors who must sign in are sent to the login page and come back', () => {
  const plugin = make()
  const x = exchange({ path: '/account/orders', query: 'page=2&q=a b' })
  attempt(plugin, x)
  expect(answer(plugin, x, 401)).toBe(true)
  expect(x.redirects).toEqual([
    ['/login?next=' + encodeURIComponent('/account/orders?page=2&q=a b'), 302],
  ])
})

test('forms that were posted are redirected with a 303', () => {
  const plugin = make()
  const x = exchange({ path: '/account/orders', method: 'POST' })
  attempt(plugin, x)
  answer(plugin, x, 401)
  expect(x.redirects[0]![1]).toBe(303)
})

test('JSON clients keep their 401', () => {
  const plugin = make()
  const x = exchange({ path: '/account', accept: 'application/json' })
  attempt(plugin, x)
  expect(answer(plugin, x, 401)).toBeUndefined()
  expect(x.redirects).toEqual([])
})

test('requests that are not for pages are not redirected', () => {
  const plugin = make()
  const x = exchange({ path: '/api/x', route: null })
  expect(answer(plugin, x, 401)).toBeUndefined()
})

test('the login page can be elsewhere, and can be left out of the url', () => {
  const x = exchange({ path: '/account' })
  make({ loginPath: '/auth/sign-in', nextParam: 'return' }).onError!({
    status: 401,
    error: {},
    request: x.request,
    response: x.response,
    route: x.route,
  })
  expect(x.redirects[0]![0]).toBe('/auth/sign-in?return=%2Faccount')

  const y = exchange({ path: '/account' })
  make({ nextParam: '' }).onError!({
    status: 401,
    error: {},
    request: y.request,
    response: y.response,
    route: y.route,
  })
  expect(y.redirects[0]![0]).toBe('/login')

  const z = exchange({ path: '/account' })
  expect(
    make({ loginPath: false }).onError!({
      status: 401,
      error: {},
      request: z.request,
      response: z.response,
      route: z.route,
    })
  ).toBeUndefined()
})

test('the login page itself does not send visitors to the login page', () => {
  const plugin = make({ rules: [{ path: '/login', auth: true }] })
  const x = exchange({ path: '/login' })
  attempt(plugin, x)
  expect(answer(plugin, x, 401)).toBeUndefined()
})

test('the login page can be told to say something, through the session', () => {
  const plugin = make({ loginMessage: 'Please sign in' })
  const x = exchange({ path: '/account' })
  attempt(plugin, x)
  answer(plugin, x, 401)
  expect(x.flashes).toEqual([['info', 'Please sign in']])
})

test('users who are not allowed get a 403, or a page', () => {
  const plain = make()
  const x = exchange({ path: '/admin', who: member })
  attempt(plain, x)
  expect(answer(plain, x, 403)).toBeUndefined()

  const withPage = make({ forbiddenPath: '/denied', unverifiedPath: '/verify' })
  const y = exchange({ path: '/admin', who: member })
  attempt(withPage, y)
  expect(answer(withPage, y, 403)).toBe(true)
  expect(y.redirects[0]![0]).toBe('/denied')

  const unconfirmed: Who = {
    id: 'u3',
    fields: { role: 'member', verified: false },
  }
  const z = exchange({ path: '/orders/1', who: unconfirmed })
  attempt(withPage, z)
  answer(withPage, z, 403)
  expect(z.redirects[0]![0]).toBe('/verify')

  const onlyVerify = make({ unverifiedPath: '/verify' })
  const w = exchange({ path: '/orders/1', who: unconfirmed })
  attempt(onlyVerify, w)
  answer(onlyVerify, w, 403)
  expect(w.redirects[0]![0]).toBe('/verify')
  const v = exchange({ path: '/admin', who: member })
  attempt(onlyVerify, v)
  expect(answer(onlyVerify, v, 403)).toBeUndefined()
})

// --- for pages

const apiFor = (plugin: any, x: ReturnType<typeof exchange>) => {
  const api: any = { request: x.request }
  plugin.onExtendContextApi({ api, route: x.route })
  return api.rbac
}

test('pages can ask who the user is', () => {
  const plugin = make()
  const rbac = apiFor(
    plugin,
    exchange({ who: { id: 'u', fields: { role: ['editor', 'admin'] } } })
  )
  expect(rbac.roles()).toEqual(['editor', 'admin'])
  expect(rbac.hasRole('admin')).toBe(true)
  expect(rbac.hasRole('owner', 'editor')).toBe(true)
  expect(rbac.hasRole('owner')).toBe(false)
  expect(apiFor(plugin, exchange()).roles()).toEqual([])
})

test('pages can ask what the rules let the user do', () => {
  const plugin = make()
  const asMember = apiFor(plugin, exchange({ who: member }))
  expect(asMember.can('/account/x')).toBe(true)
  expect(asMember.can('/admin')).toBe(false)
  expect(asMember.can('/')).toBe(true)
  const asVisitor = apiFor(plugin, exchange())
  expect(asVisitor.can('/account')).toBe(false)
  expect(
    apiFor(plugin, exchange({ who: admin })).can('/admin/users', 'post')
  ).toBe(true)
})

test('loaders can ask for a sign in or a role', () => {
  const plugin = make()
  const visitor = exchange({ path: '/somewhere' })
  expect(() => apiFor(plugin, visitor).requireAuth()).toThrow()
  let error: any
  try {
    apiFor(plugin, visitor).requireRole('admin')
  } catch (e) {
    error = e
  }
  expect(error.status).toBe(401)
  expect(visitor.request.state.rbac.decision).toBe('unauthenticated')

  const memberReq = exchange({ who: member })
  expect(() => apiFor(plugin, memberReq).requireAuth()).not.toThrow()
  try {
    apiFor(plugin, memberReq).requireRole('admin')
  } catch (e) {
    error = e
  }
  expect(error.status).toBe(403)
  expect(() =>
    apiFor(plugin, exchange({ who: admin })).requireRole('editor', 'admin')
  ).not.toThrow()
})

test('the login address for a page', () => {
  const plugin = make()
  const rbac = apiFor(plugin, exchange({ path: '/account', query: 'a=1' }))
  expect(rbac.loginUrl()).toBe('/login?next=%2Faccount%3Fa%3D1')
  expect(rbac.loginUrl('/else')).toBe('/login?next=%2Felse')
  // Never to somewhere else
  expect(rbac.loginUrl('https://evil.example')).toBe('/login?next=%2F')
})
