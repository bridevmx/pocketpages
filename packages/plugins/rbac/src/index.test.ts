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

const { default: factory, guard, useBackend } = await import('./index')

/** What the router makes of the URLs of the pages of these tests */
const canonicalOf = (path: string) =>
  path
    .replace(/^(.*?)\/index(\/.*)?$/, '$1')
    .replace(/^(\/dashboard)\/.+$/, '$1') || '/'

const make = (options: Record<string, any> = {}, plugins?: unknown[]) =>
  factory(
    {
      globalApi: { pathMatcher, canonicalPath: canonicalOf },
      config: plugins ? { plugins } : undefined,
      dbg: () => {},
    } as any,
    {
      debug: false,
      rules: [
        { path: '/account/**', auth: true },
        { path: '/admin/**', roles: ['admin'] },
        { path: '/orders/**', verified: true },
      ],
      ...options,
    }
  )

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
    canonicalPath: canonicalOf(init.path ?? '/'),
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
      collection: () => ({ name: who.collection ?? 'users', id: 'pbc_users' }),
    },
    event: {
      request: {
        url: {
          path: init.path ?? '/',
          escapedPath: () => init.path ?? '/',
          rawQuery: init.query ?? '',
        },
      },
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
  const rbac = apiFor(
    plugin,
    exchange({ path: '/account', query: 'a=1', who: member })
  )
  expect(rbac.loginUrl()).toBe('/login?next=%2Faccount%3Fa%3D1')
  expect(rbac.loginUrl('/else')).toBe('/login?next=%2Felse')
  // Never to somewhere else
  expect(rbac.loginUrl('https://evil.example')).toBe('/login?next=%2F')
})

// --- one page, many addresses

const aliasRules = [
  { path: '/account', auth: true },
  { path: '/admin/users', roles: ['admin'] },
  { path: '/posts/*', methods: ['DELETE'], auth: true },
  { path: '/dashboard', auth: true },
]

test('a rule for a page holds for every address that leads to it', () => {
  const plugin = make({ rules: aliasRules })
  for (const path of [
    '/account/index',
    '/account/index/x',
    '/admin/users/index/x',
    '/dashboard/anything/at/all',
  ]) {
    const error = attempt(plugin, exchange({ path, who: undefined }))
    expect(error, path).toMatchObject({ status: 401 })
  }
  expect(
    attempt(plugin, exchange({ path: '/admin/users/index/x', who: member }))
  ).toMatchObject({ status: 403 })
  expect(
    attempt(plugin, exchange({ path: '/admin/users/index/x', who: admin }))
  ).toBeUndefined()
  expect(
    attempt(plugin, exchange({ path: '/account/index', who: member }))
  ).toBeUndefined()
})

test('rules for some methods hold for the address of the page too', () => {
  const plugin = make({ rules: aliasRules })
  expect(
    attempt(plugin, exchange({ path: '/posts/5/index', method: 'DELETE' }))
  ).toMatchObject({ status: 401 })
  expect(
    attempt(plugin, exchange({ path: '/posts/5/index', method: 'GET' }))
  ).toBeUndefined()
})

test('an exception for the address in the URL does not open the page behind it', () => {
  const plugin = make({
    rules: [
      { path: '/files/public', public: true },
      { path: '/files/**', auth: true },
    ],
  })
  const x = exchange({ path: '/files/public' })
  x.request.canonicalPath = '/files'
  expect(attempt(plugin, x)).toMatchObject({ status: 401 })
})

test('pages can ask about the aliases of a page too', () => {
  const plugin = make({ rules: aliasRules })
  const visitor = apiFor(plugin, exchange({ path: '/' }))
  expect(visitor.can('/account')).toBe(false)
  expect(visitor.can('/account/index')).toBe(false)
  expect(visitor.can('/dashboard/anything')).toBe(false)
  expect(
    apiFor(plugin, exchange({ path: '/', who: member })).can('/account/index')
  ).toBe(true)
})

// --- plugins that change the request

test('the rules are checked again for the request that gets served', () => {
  const plugin = make({ rules: [{ path: '/admin/**', roles: ['admin'] }] })

  // The address is rewritten by a plugin after this one (/es/admin -> /admin)
  const x = exchange({ path: '/es/admin', route: null })
  expect(attempt(plugin, x)).toBeUndefined() // nothing to serve yet
  x.request.pathname = '/admin'
  x.request.canonicalPath = '/admin'
  let error: any
  try {
    plugin.onExtendContextApi({
      api: { request: x.request },
      route: { isStatic: false },
    })
  } catch (e) {
    error = e
  }
  expect(error).toMatchObject({ status: 401 })

  // The method is changed by a plugin after this one (POST -> DELETE)
  const methodRules = make({
    rules: [{ path: '/comments/*', methods: ['DELETE'], roles: ['admin'] }],
  })
  const y = exchange({ path: '/comments/5', method: 'POST' })
  expect(attempt(methodRules, y)).toBeUndefined()
  y.request.method = 'DELETE'
  error = undefined
  try {
    methodRules.onExtendContextApi({
      api: { request: y.request },
      route: y.route,
    })
  } catch (e) {
    error = e
  }
  expect(error).toMatchObject({ status: 401 })
})

test('a request that was checked is not checked again for nothing', () => {
  let decisions = 0
  const plugin = make({ rules: [{ path: '/account/**', auth: true }] })
  const x = exchange({ path: '/account', who: member })
  expect(attempt(plugin, x)).toBeUndefined()
  expect(x.request.state.rbac.checked).toBe('GET /account')
  // The same request, once more, when pages get their API
  Object.defineProperty(x.request, 'auth', {
    get() {
      decisions++
      return {
        id: 'u',
        get: () => 'member',
        collection: () => ({ name: 'users' }),
      }
    },
  })
  plugin.onExtendContextApi({ api: { request: x.request }, route: x.route })
  expect(decisions).toBe(0)
})

test('listing the plugins in a bad order is an error, not a way around the rules', () => {
  expect(() =>
    make({}, ['pocketpages-plugin-rbac', 'pocketpages-plugin-i18n'])
  ).toThrow('list it after pocketpages-plugin-i18n')
  expect(() =>
    make({}, [
      { name: 'pocketpages-plugin-rbac' },
      { name: 'pocketpages-plugin-forms' },
    ])
  ).toThrow('pocketpages-plugin-forms')
  expect(() =>
    make({}, [
      { name: 'pocketpages-plugin-rbac' },
      { name: 'pocketpages-plugin-forms', methodOverride: false },
    ])
  ).not.toThrow()
  expect(() =>
    make({}, ['pocketpages-plugin-i18n', 'pocketpages-plugin-rbac'])
  ).not.toThrow()
  expect(() => make({}, ['pocketpages-plugin-ejs'])).not.toThrow()
})

// --- routes of PocketBase

const eventFor = (who: Who) =>
  ({
    auth: who && {
      id: who.id,
      get: (field: string) => who.fields?.[field],
      collection: () => ({ name: who.collection ?? 'users', id: 'pbc_users' }),
    },
  }) as any

const guarded = (
  who: Who,
  rule: Parameters<typeof guard>[1],
  field?: string
) => {
  try {
    guard(eventFor(who), rule, field)
  } catch (e) {
    return e as FakeError
  }
  return undefined
}

test('routes of PocketBase can ask for a sign in, a role or a confirmed email address', () => {
  expect(guarded(undefined, { auth: true })).toMatchObject({ status: 401 })
  expect(guarded(member, { auth: true })).toBeUndefined()
  expect(guarded(undefined, { roles: ['admin'] })).toMatchObject({
    status: 401,
  })
  expect(guarded(member, { roles: ['admin'] })).toMatchObject({ status: 403 })
  expect(guarded(admin, { roles: ['editor', 'admin'] })).toBeUndefined()
  const unconfirmed: Who = {
    id: 'u3',
    fields: { role: 'member', verified: false },
  }
  expect(guarded(unconfirmed, { verified: true })).toMatchObject({
    status: 403,
  })
  expect(guarded(member, { verified: true })).toBeUndefined()
})

test('routes of PocketBase can hide that they exist', () => {
  expect(guarded(undefined, { roles: ['admin'], hide: true })).toMatchObject({
    status: 404,
  })
  expect(guarded(member, { roles: ['admin'], hide: true })).toMatchObject({
    status: 404,
  })
  expect(guarded(admin, { roles: ['admin'], hide: true })).toBeUndefined()
})

test('superusers of PocketBase pass as superusers, and the field of the role can change', () => {
  const superuser: Who = { id: 's1', collection: '_superusers' }
  expect(guarded(superuser, { roles: ['superuser'] })).toBeUndefined()
  expect(guarded(superuser, { verified: true })).toBeUndefined()
  const staff: Who = { id: 'u4', fields: { rol: ['editor'] } }
  expect(guarded(staff, { roles: ['editor'] }, 'rol')).toBeUndefined()
  expect(guarded(staff, { roles: ['editor'] })).toMatchObject({ status: 403 })
})

test('a rule that asks for nothing is an error, not an open door', () => {
  expect(() => guard(eventFor(admin), {})).toThrow('says nothing')
})

// --- groups

const ORG_A = 'orgaaaaaaaaaaaa'
const ORG_B = 'orgbbbbbbbbbbbb'
const memberOptions = {
  collection: 'memberships',
  user: 'user',
  scopes: { org: 'org' },
  role: 'role',
  roles: ['viewer', 'editor', 'admin', 'owner'],
}
const groupRules = [
  {
    path: '/orgs/[org]/billing/**',
    member: { scope: 'org', atLeast: 'owner' },
  },
  { path: '/orgs/[org]/**', member: { scope: 'org' } },
]

/** Who is in what: `user|group` -> roles (change `rows` to change it). Counts the questions asked. */
const database = (rows: Record<string, string[]>) => {
  const asked: Array<{ sql: string; params: Record<string, string> }> = []
  useBackend({
    schema: () => ({
      table: 'memberships',
      fields: {
        user: { type: 'relation', multiple: false, collectionId: 'pbc_users' },
        org: { type: 'relation', multiple: false, collectionId: 'pbc_orgs' },
        role: { type: 'select', multiple: false, collectionId: '' },
      },
      indexes: ['CREATE UNIQUE INDEX `i` ON `memberships` (`user`, `org`)'],
    }),
    all: (sql, params, columns) => {
      asked.push({ sql, params })
      if (columns.length === 1) {
        return (rows[`${params.u}|${params.s}`] ?? []).map((r) => ({ r }))
      }
      return Object.keys(rows)
        .filter((k) => k.startsWith(`${params.u}|`))
        .flatMap((k) => rows[k]!.map((r) => ({ r, s0: k.split('|')[1] })))
    },
  })
  return asked
}

const withGroups = (
  extra: Record<string, unknown> = {},
  options = memberOptions
) => make({ rules: groupRules, memberships: options, ...extra })

const ana: Who = { id: 'ana', fields: { role: 'member', verified: true } }
const bob: Who = { id: 'bob', fields: { role: 'member', verified: true } }

const rolesOf = {
  'ana|orgaaaaaaaaaaaa': ['viewer'],
  'bob|orgaaaaaaaaaaaa': ['owner'],
  'bob|orgbbbbbbbbbbbb': ['editor'],
}

test('visitors are sent to sign in, and people who are not in the group are told it is not there', () => {
  database(rolesOf)
  const plugin = withGroups()
  expect(
    attempt(plugin, exchange({ path: `/orgs/${ORG_A}/settings` }))
  ).toMatchObject({ status: 401 })
  expect(
    attempt(plugin, exchange({ path: `/orgs/${ORG_B}/settings`, who: ana }))
  ).toMatchObject({ status: 404 })
  expect(
    attempt(plugin, exchange({ path: `/orgs/${ORG_A}/settings`, who: ana }))
  ).toBeUndefined()
})

test('roles in a group are asked for by name or by how high they are', () => {
  database(rolesOf)
  const plugin = withGroups()
  const billing = `/orgs/${ORG_A}/billing`
  expect(attempt(plugin, exchange({ path: billing, who: ana }))).toMatchObject({
    status: 403,
  })
  expect(attempt(plugin, exchange({ path: billing, who: bob }))).toBeUndefined()
  const named = withGroups({
    rules: [
      {
        path: '/orgs/[org]/**',
        member: { scope: 'org', roles: ['editor', 'admin'] },
      },
    ],
  })
  expect(
    attempt(named, exchange({ path: `/orgs/${ORG_B}/x`, who: bob }))
  ).toBeUndefined()
  expect(
    attempt(named, exchange({ path: `/orgs/${ORG_A}/x`, who: ana }))
  ).toMatchObject({ status: 403 })
})

test('every address of a page is the same group', () => {
  database(rolesOf)
  const plugin = withGroups()
  for (const path of [
    `/orgs/${ORG_A}/billing`,
    `/orgs/${ORG_A}/billing/index`,
    `/orgs/${ORG_A}/billing/index/x`,
  ]) {
    expect(attempt(plugin, exchange({ path, who: ana }))).toMatchObject({
      status: 403,
    })
    expect(attempt(plugin, exchange({ path }))).toMatchObject({ status: 401 })
  }
})

test('what is not the id of a group never reaches the database', () => {
  const asked = database(rolesOf)
  const plugin = withGroups()
  for (const id of [
    "x'%20OR%20'1'='1",
    'ORGAAAAAAAAAAAA',
    'short',
    'a'.repeat(200),
    '..',
    '%2e%2e',
  ]) {
    expect(
      attempt(plugin, exchange({ path: `/orgs/${id}/x`, who: bob }))
    ).toMatchObject({ status: 404 })
  }
  expect(asked).toHaveLength(0)
})

test('the database is asked once for a group during a request, and never kept for the next', () => {
  const rows = { ...rolesOf }
  const asked = database(rows)
  const plugin = withGroups()
  const x = exchange({ path: `/orgs/${ORG_A}/billing/index`, who: bob })
  x.request.canonicalPath = `/orgs/${ORG_A}/billing`
  expect(attempt(plugin, x)).toBeUndefined()
  // When pages get their API, and from the helpers
  const api: any = { request: x.request }
  plugin.onExtendContextApi({ api, route: x.route })
  api.rbac.member('org')
  api.rbac.can(`/orgs/${ORG_A}/billing`)
  api.rbac.requireMember('org', { atLeast: 'admin' })
  expect(asked).toHaveLength(1)
  // The next request asks again: taking somebody out is felt by their very next request
  delete (rows as Record<string, string[]>)[`bob|${ORG_A}`]
  expect(
    attempt(plugin, exchange({ path: `/orgs/${ORG_A}/x`, who: bob }))
  ).toMatchObject({ status: 404 })
  expect(asked).toHaveLength(2)
})

test('who is not in the group can be told so, or not', () => {
  database(rolesOf)
  const open = withGroups({
    rules: [{ path: '/orgs/[org]/**', member: { scope: 'org' }, hide: false }],
  })
  expect(
    attempt(open, exchange({ path: `/orgs/${ORG_B}/x`, who: ana }))
  ).toMatchObject({ status: 403 })
})

test('superusers come into groups only if the config says so', () => {
  database(rolesOf)
  const superuser: Who = { id: 'root', collection: '_superusers' }
  const path = `/orgs/${ORG_A}/billing`
  expect(
    attempt(withGroups(), exchange({ path, who: superuser }))
  ).toMatchObject({ status: 404 })
  const allowed = withGroups({}, { ...memberOptions, superuser: true } as any)
  const x = exchange({ path, who: superuser })
  expect(attempt(allowed, x)).toBeUndefined()
  expect(x.request.state.rbac.scope).toEqual({ org: ORG_A })
  // and only superusers
  expect(attempt(allowed, exchange({ path, who: ana }))).toMatchObject({
    status: 403,
  })
})

test('a group can ask for a confirmed email address too', () => {
  database({ 'dan|orgaaaaaaaaaaaa': ['owner'] })
  const plugin = withGroups({
    rules: [
      { path: '/orgs/[org]/**', member: { scope: 'org' }, verified: true },
    ],
  })
  const dan: Who = { id: 'dan', fields: { verified: false } }
  expect(
    attempt(plugin, exchange({ path: `/orgs/${ORG_A}/x`, who: dan }))
  ).toMatchObject({ status: 403 })
  expect(request_state_of(plugin, dan)).toBe('unverified')
})

const request_state_of = (plugin: any, who: Who) => {
  const x = exchange({ path: `/orgs/${ORG_A}/x`, who })
  attempt(plugin, x)
  return x.request.state.rbac.decision
}

test('rules about a group can be for some methods', () => {
  database(rolesOf)
  const plugin = withGroups({
    rules: [
      {
        path: '/orgs/[org]/**',
        member: { scope: 'org', atLeast: 'admin' },
        methods: ['DELETE'],
      },
    ],
  })
  expect(
    attempt(plugin, exchange({ path: `/orgs/${ORG_A}/x`, who: ana }))
  ).toBeUndefined()
  expect(
    attempt(
      plugin,
      exchange({ path: `/orgs/${ORG_A}/x`, who: ana, method: 'DELETE' })
    )
  ).toMatchObject({ status: 403 })
})

test('pages know which group the request came in through, and can ask about others', () => {
  database(rolesOf)
  const plugin = withGroups()
  const x = exchange({ path: `/orgs/${ORG_A}/x`, who: bob })
  expect(attempt(plugin, x)).toBeUndefined()
  const rbac = apiFor(plugin, x)
  expect(rbac.scope).toEqual({ org: ORG_A })
  expect(rbac.member('org')).toEqual({ id: ORG_A, roles: ['owner'] })
  expect(rbac.member('org', ORG_B)).toEqual({ id: ORG_B, roles: ['editor'] })
  expect(rbac.member('org', 'stranger00000000')).toBeNull()
  expect(rbac.member('org', 'not an id')).toBeNull()
  expect(() => rbac.requireMember('org')).not.toThrow()
  expect(() =>
    rbac.requireMember('org', { id: ORG_B, atLeast: 'editor' })
  ).not.toThrow()
  expect(() =>
    rbac.requireMember('org', { id: ORG_B, atLeast: 'admin' })
  ).toThrow()
  expect(rbac.memberships()).toEqual([
    { scope: 'org', id: ORG_A, roles: ['owner'] },
    { scope: 'org', id: ORG_B, roles: ['editor'] },
  ])
  // The copies can be changed without changing what the request knows
  rbac.scope.org = ORG_B
  expect(rbac.scope).toEqual({ org: ORG_A })
})

test('requiring a group in a loader refuses like the rules do', () => {
  database(rolesOf)
  const plugin = withGroups({ rules: [] })
  const status = (who: Who, opts?: object, scope = 'org') => {
    const x = exchange({ path: '/anywhere', who })
    try {
      apiFor(plugin, x).requireMember(scope, { id: ORG_A, ...opts })
    } catch (e) {
      return (e as FakeError).status
    }
    return 'ok'
  }
  expect(status(undefined as unknown as Who)).toBe(401)
  expect(status({ id: 'stranger' })).toBe(404)
  expect(status(ana)).toBe('ok')
  expect(status(ana, { atLeast: 'admin' })).toBe(403)
  expect(status(bob, { atLeast: 'admin' })).toBe('ok')
})

test('the pages of a site without groups can not ask about them', () => {
  const plugin = make()
  expect(() => apiFor(plugin, exchange({ who: ana })).member('org')).toThrow(
    'no memberships option'
  )
})

test('rules about groups have to make sense, or the plugin does not start', () => {
  database({})
  const bad =
    (rule: object, options: object | null = memberOptions) =>
    () =>
      make({ rules: [rule], memberships: options ?? undefined })
  expect(
    bad({ path: '/orgs/[org]/**', member: { scope: 'org' } }, null)
  ).toThrow('no memberships option')
  expect(bad({ path: '/orgs/[org]/**', member: { scope: 'team' } })).toThrow(
    "unknown scope 'team'"
  )
  expect(bad({ path: '/orgs/**', member: { scope: 'org' } })).toThrow(
    'needs [org]'
  )
  expect(bad({ path: '/**/[org]', member: { scope: 'org' } })).toThrow(
    'before any **'
  )
  expect(bad({ path: '/orgs/[team]/**', member: { scope: 'org' } })).toThrow(
    '[team]'
  )
  expect(bad({ path: '/[org]/[org]', member: { scope: 'org' } })).toThrow(
    'twice'
  )
  expect(
    bad({ path: '/orgs/[org]/**', member: { scope: 'org', atLeast: 'boss' } })
  ).toThrow('not one of memberships.roles')
  expect(
    bad({ path: '/orgs/[org]/**', member: { scope: 'org', roles: ['boss'] } })
  ).toThrow('not one of memberships.roles')
  expect(
    bad({ path: '/orgs/[org]/**', member: { scope: 'org' }, roles: ['admin'] })
  ).toThrow('about a group')
  expect(
    bad({ path: '/orgs/[org]/**', member: { scope: 'org' }, public: true })
  ).toThrow('public')
  expect(
    bad(
      { path: '/orgs/[org]/**', member: { scope: 'org', atLeast: 'admin' } },
      {
        ...memberOptions,
        roles: undefined,
      }
    )
  ).toThrow('not one of memberships.roles')
  expect(
    bad(
      { path: '/x', auth: true },
      { ...memberOptions, collection: 'bad name' }
    )
  ).toThrow('collection')
  expect(
    bad({ path: '/o/[id]/**', member: { scope: 'org', param: 'id' } })
  ).not.toThrow()
})
