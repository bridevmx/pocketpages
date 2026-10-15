import { expect, test } from 'bun:test'
import {
  Backend,
  checkMembershipsOptions,
  createMemberships,
  jsvmBackend,
  parseRoles,
  rolesSatisfy,
  Schema,
} from './memberships'

const ID = (c: string) => `grp${c.repeat(12)}`
const A = ID('a')
const B = ID('b')

const options = {
  collection: 'memberships',
  user: 'user',
  scopes: { org: 'org', project: 'project' },
  role: 'role',
  roles: ['viewer', 'editor', 'admin', 'owner'],
  status: { field: 'status', active: ['active'] },
  expires: 'expires',
}

const field = (type: string, extra: Record<string, unknown> = {}) => ({
  type,
  multiple: false,
  collectionId: '',
  ...extra,
})

const schema = (
  over: Partial<Schema['fields']> = {},
  indexes?: string[]
): Schema => ({
  table: 'memberships',
  fields: {
    user: field('relation', { collectionId: 'pbc_users' }),
    org: field('relation', { collectionId: 'pbc_orgs' }),
    project: field('relation', { collectionId: 'pbc_projects' }),
    role: field('select'),
    status: field('select'),
    expires: field('date'),
    ...over,
  },
  indexes: indexes ?? [
    'CREATE UNIQUE INDEX `idx_a` ON `memberships` (`user`, `org`)',
    'CREATE UNIQUE INDEX `idx_b` ON `memberships` (`user`, `project`)',
  ],
})

type Call = { sql: string; params: Record<string, string>; columns: string[] }

/** A backend that answers with the rows it is given and writes down what it was asked */
const fake = (
  rows: Array<Record<string, unknown>> = [],
  s: Schema = schema()
) => {
  const calls: Call[] = []
  let schemas = 0
  const backend: Backend = {
    schema: () => {
      schemas++
      return s
    },
    all: (sql, params, columns) => {
      calls.push({ sql, params, columns })
      return rows
    },
  }
  return { backend, calls, schemas: () => schemas }
}

const user = (id = 'user00000000001', collection = 'pbc_users') => ({
  id,
  collection: () => ({ id: collection }),
})

// --- options

test('options are checked', () => {
  expect(() => checkMembershipsOptions(options)).not.toThrow()
  expect(() => checkMembershipsOptions(null)).toThrow('has to be an object')
  expect(() => checkMembershipsOptions({ ...options, nope: 1 })).toThrow(
    "unknown option 'nope'"
  )
  expect(() => checkMembershipsOptions({ ...options, scopes: {} })).toThrow(
    'at least one group'
  )
  expect(() =>
    checkMembershipsOptions({ ...options, roles: ['a', 'a'] })
  ).toThrow('different roles')
  expect(() =>
    checkMembershipsOptions({ ...options, idPattern: '[a-z]+' })
  ).toThrow('from ^ to $')
  expect(() =>
    checkMembershipsOptions({ ...options, superuser: 'yes' })
  ).toThrow('true or false')
  expect(() =>
    checkMembershipsOptions({
      ...options,
      status: { field: 'status', active: [] },
    })
  ).toThrow('status.active')
})

test('names that go into a query have to be plain names', () => {
  for (const bad of ['a b', 'a`b', "a'b", 'a;b', 'a-b', '', '1a', 'a.b']) {
    expect(() =>
      checkMembershipsOptions({ ...options, collection: bad })
    ).toThrow()
    expect(() => checkMembershipsOptions({ ...options, user: bad })).toThrow()
    expect(() => checkMembershipsOptions({ ...options, role: bad })).toThrow()
    expect(() =>
      checkMembershipsOptions({ ...options, scopes: { org: bad } })
    ).toThrow()
    expect(() =>
      checkMembershipsOptions({ ...options, expires: bad })
    ).toThrow()
    expect(() =>
      checkMembershipsOptions({
        ...options,
        status: { field: bad, active: ['a'] },
      })
    ).toThrow()
  }
  for (const bad of ['__proto__', 'constructor', 'prototype']) {
    expect(() =>
      checkMembershipsOptions({ ...options, scopes: { [bad]: 'org' } })
    ).toThrow()
  }
})

// --- roles

test('roles in a value are read from a text or from a list', () => {
  expect(parseRoles('admin')).toEqual(['admin'])
  expect(parseRoles('["admin","editor","admin"]')).toEqual(['admin', 'editor'])
  expect(parseRoles(['a', 'b'])).toEqual(['a', 'b'])
  expect(parseRoles('')).toEqual([])
  expect(parseRoles('[nope')).toEqual([])
  expect(parseRoles(null)).toEqual([])
  expect(parseRoles('[1,{},"x"]')).toEqual(['x'])
})

test('rules ask for a role, or for a role at least as high as one', () => {
  const h = ['viewer', 'editor', 'admin', 'owner']
  expect(rolesSatisfy(['viewer'], {}, h)).toBe(true)
  expect(rolesSatisfy([], {}, h)).toBe(false)
  expect(rolesSatisfy(['viewer'], { atLeast: 'editor' }, h)).toBe(false)
  expect(rolesSatisfy(['editor'], { atLeast: 'editor' }, h)).toBe(true)
  expect(rolesSatisfy(['owner'], { atLeast: 'editor' }, h)).toBe(true)
  expect(rolesSatisfy(['viewer', 'admin'], { atLeast: 'admin' }, h)).toBe(true)
  expect(rolesSatisfy(['admin'], { roles: ['owner'] }, h)).toBe(false)
  expect(rolesSatisfy(['admin'], { roles: ['owner', 'admin'] }, h)).toBe(true)
  // A role the order does not know is not high enough, and without an order nothing is
  expect(rolesSatisfy(['stranger'], { atLeast: 'viewer' }, h)).toBe(false)
  expect(rolesSatisfy(['admin'], { atLeast: 'viewer' }, undefined)).toBe(false)
  expect(rolesSatisfy(['admin'], { atLeast: 'nobody' }, h)).toBe(false)
})

// --- asking

test('the roles of a user in a group come from one parameterized query', () => {
  const { backend, calls } = fake([{ r: 'admin' }])
  const m = createMemberships(checkMembershipsOptions(options), backend)
  expect(m.rolesIn(user(), 'org', A)).toEqual(['admin'])
  expect(calls).toHaveLength(1)
  expect(calls[0]!.sql).toBe(
    'SELECT `role` AS r FROM `memberships` WHERE `user` = {:u} AND `org` = {:s} ' +
      "AND `status` IN ({:a0}) AND (`expires` = '' OR `expires` IS NULL OR `expires` > {:now}) LIMIT 100"
  )
  expect(calls[0]!.params.u).toBe('user00000000001')
  expect(calls[0]!.params.s).toBe(A)
  expect(calls[0]!.params.a0).toBe('active')
  expect(calls[0]!.params.now).toMatch(
    /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}Z$/
  )
  // The values are never part of the text of the query
  expect(calls[0]!.sql).not.toContain(A)
  expect(calls[0]!.sql).not.toContain('user00000000001')
  expect(calls[0]!.columns).toEqual(['r'])
})

test('without status and expiry the query is the plain one', () => {
  const { backend, calls } = fake([{ r: 'viewer' }])
  const { status, expires, ...plain } = options
  void status
  void expires
  const m = createMemberships(checkMembershipsOptions(plain), backend)
  m.rolesIn(user(), 'project', B)
  expect(calls[0]!.sql).toBe(
    'SELECT `role` AS r FROM `memberships` WHERE `user` = {:u} AND `project` = {:s} LIMIT 100'
  )
  expect(Object.keys(calls[0]!.params).sort()).toEqual(['s', 'u'])
})

test('nothing that does not look like the id of a group reaches the database', () => {
  const { backend, calls } = fake([{ r: 'admin' }])
  const m = createMemberships(checkMembershipsOptions(options), backend)
  for (const evil of [
    "x' OR '1'='1",
    'x" || 1=1 || "',
    '',
    '%',
    '*',
    A.toUpperCase(),
    A + ' ',
    A + 'a',
    '../' + A,
    'a'.repeat(5000),
  ]) {
    expect(m.isId(evil)).toBe(false)
    expect(m.rolesIn(user(), 'org', evil)).toEqual([])
  }
  expect(m.isId(A)).toBe(true)
  expect(m.isId(undefined)).toBe(false)
  expect(m.isId(5)).toBe(false)
  expect(calls).toHaveLength(0)
})

test('even an id pattern that lets anything through only ever gives parameters', () => {
  const { backend, calls } = fake([])
  const m = createMemberships(
    checkMembershipsOptions({ ...options, idPattern: '^.+$' }),
    backend
  )
  const evil = "x' OR '1'='1"
  m.rolesIn(user(), 'org', evil)
  expect(calls[0]!.params.s).toBe(evil)
  expect(calls[0]!.sql).not.toContain("1'='1")
})

test('users who are not of the collection the memberships point to are in no group', () => {
  const { backend, calls } = fake([{ r: 'owner' }])
  const m = createMemberships(checkMembershipsOptions(options), backend)
  expect(m.rolesIn(user('user00000000001', 'pbc_customers'), 'org', A)).toEqual(
    []
  )
  expect(m.rolesIn(null, 'org', A)).toEqual([])
  expect(m.list(user('user00000000001', 'pbc_customers'))).toEqual([])
  expect(calls).toHaveLength(0)
})

test('roles the order does not know are ignored, and a person with two rows has both', () => {
  const { backend } = fake([
    { r: 'viewer' },
    { r: '["editor","stranger"]' },
    { r: 'viewer' },
  ])
  const m = createMemberships(checkMembershipsOptions(options), backend)
  expect(m.rolesIn(user(), 'org', A)).toEqual(['viewer', 'editor'])
  const open = createMemberships(
    checkMembershipsOptions({ ...options, roles: undefined }),
    fake([{ r: 'stranger' }]).backend
  )
  expect(open.rolesIn(user(), 'org', A)).toEqual(['stranger'])
})

test('asking about a kind of group that is not in the config is an error', () => {
  const { backend } = fake()
  const m = createMemberships(checkMembershipsOptions(options), backend)
  expect(() => m.rolesIn(user(), 'team', A)).toThrow("unknown scope 'team'")
})

test('every group of a user is listed with its roles', () => {
  const { backend, calls } = fake([
    { r: 'admin', s0: A, s1: '' },
    { r: '["viewer","editor"]', s0: '', s1: B },
    { r: 'owner', s0: A, s1: B },
    { r: 'viewer', s0: 'not an id', s1: '' },
    { r: 'stranger', s0: A, s1: '' },
  ])
  const m = createMemberships(checkMembershipsOptions(options), backend)
  expect(m.list(user())).toEqual([
    { scope: 'org', id: A, roles: ['admin', 'owner'] },
    { scope: 'project', id: B, roles: ['viewer', 'editor', 'owner'] },
  ])
  expect(calls[0]!.sql).toContain('`org` AS s0, `project` AS s1')
  expect(calls[0]!.columns).toEqual(['r', 's0', 's1'])
})

// --- the collection

test('the collection is looked at once, when it is first needed', () => {
  const { backend, schemas } = fake([{ r: 'admin' }])
  const m = createMemberships(checkMembershipsOptions(options), backend)
  expect(schemas()).toBe(0)
  m.rolesIn(user(), 'org', A)
  m.rolesIn(user(), 'org', B)
  m.list(user())
  expect(schemas()).toBe(1)
})

test('a collection that is not what the config says is an error, not an open door', () => {
  const asks =
    (over: Partial<Schema['fields']>, o = options) =>
    () =>
      createMemberships(
        checkMembershipsOptions(o),
        fake([], schema(over)).backend
      ).rolesIn(user(), 'org', A)
  expect(asks({ user: field('text') })).toThrow('relation')
  expect(asks({ user: field('relation', { multiple: true }) })).toThrow(
    'one value'
  )
  expect(asks({ org: field('text') })).toThrow('relation')
  expect(asks({ role: field('number') })).toThrow('select')
  expect(asks({ status: field('select', { multiple: true }) })).toThrow(
    'one value'
  )
  expect(asks({ expires: field('text') })).toThrow('date')
  const missing = createMemberships(checkMembershipsOptions(options), {
    schema: () => {
      throw new Error("the collection 'memberships' has no field 'role'")
    },
    all: () => [],
  })
  expect(() => missing.rolesIn(user(), 'org', A)).toThrow('no field')
})

test('a collection without a unique index is warned about', () => {
  const warnings: string[] = []
  const { backend } = fake(
    [],
    schema({}, ['CREATE INDEX `x` ON `memberships` (`user`)'])
  )
  createMemberships(checkMembershipsOptions(options), backend, (w) =>
    warnings.push(w)
  ).rolesIn(user(), 'org', A)
  expect(warnings).toHaveLength(2)
  expect(warnings[0]).toContain('no unique index on (user, org)')
  const quiet: string[] = []
  createMemberships(checkMembershipsOptions(options), fake().backend, (w) =>
    quiet.push(w)
  ).rolesIn(user(), 'org', A)
  expect(quiet).toEqual([])
})

// --- PocketBase's runtime

test('the backend of the JS runtime reads the collection and runs queries', () => {
  const g = globalThis as any
  const asked: Array<{ sql: string; params: any }> = []
  g.$app = {
    findCollectionByNameOrId: (name: string) => ({
      name: 'memberships',
      indexes: ['CREATE UNIQUE INDEX `i` ON `memberships` (`user`, `org`)'],
      fields: {
        getByName: (f: string) =>
          f === 'nope'
            ? null
            : {
                type: () => (f === 'role' ? 'select' : 'relation'),
                isMultiple: () => false,
                collectionId: 'pbc_' + f,
              },
      },
      id: name,
    }),
    db: () => ({
      newQuery: (sql: string) => ({
        bind: (params: any) => ({
          all: (rows: any[]) => {
            asked.push({ sql, params })
            rows.push({ r: 'admin', s0: A })
          },
        }),
      }),
    }),
  }
  g.DynamicModel = class {
    constructor(public shape: unknown) {}
  }
  g.arrayOf = () => [] as any[]
  const backend = jsvmBackend()
  const s = backend.schema('memberships', ['user', 'role'])
  expect(s.table).toBe('memberships')
  expect(s.fields.user).toEqual({
    type: 'relation',
    multiple: false,
    collectionId: 'pbc_user',
  })
  expect(s.fields.role!.type).toBe('select')
  expect(() => backend.schema('memberships', ['nope'])).toThrow(
    "no field 'nope'"
  )
  expect(backend.all('SELECT 1', { u: 'x' }, ['r', 's0'])).toEqual([
    { r: 'admin', s0: A },
  ])
  expect(asked).toEqual([{ sql: 'SELECT 1', params: { u: 'x' } }])
})
