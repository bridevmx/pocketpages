/**
 * Roles that people have in a group (an organization, a team, a project): rows of a
 * collection that say "this user is an admin of that organization".
 *
 * Nothing is kept from one request to the next. The collection is asked every time, so
 * that taking somebody out of a group is felt by their very next request.
 */

/** What the config says about the collection of memberships */
export type MembershipsOptions = {
  /** The collection with the memberships (its name, or its id) */
  collection: string
  /** The field that points to the user: a relation to the collection of the signed in users */
  user: string
  /** The kinds of group, and the field of each one that points to it: `{ org: 'org' }` */
  scopes: Record<string, string>
  /** The field with the role: a `select` field, or one that takes several values */
  role: string
  /**
   * The roles, from the one that can do least to the one that can do most:
   * `['viewer', 'editor', 'admin', 'owner']`. Rules can then say `atLeast: 'editor'`. When
   * it is given, roles that are not in it are ignored.
   */
  roles?: string[]
  /** Only rows whose field has one of these values count: `{ field: 'status', active: ['active'] }` */
  status?: { field: string; active: string[] }
  /** A date field: rows whose date has passed don't count. Empty means it never ends. */
  expires?: string
  /** What the id of a group looks like, `^[a-z0-9]{15}$` (the ids of PocketBase) unless told otherwise */
  idPattern?: string
  /**
   * Superusers of PocketBase come into every group, whatever the rows say. Off unless
   * told otherwise: an operator looking at the data of a customer should be a decision.
   */
  superuser?: boolean
}

export const DEFAULT_ID_PATTERN = '^[a-z0-9]{15}$'

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const KEYS = [
  'collection',
  'user',
  'scopes',
  'role',
  'roles',
  'status',
  'expires',
  'idPattern',
  'superuser',
]
const FORBIDDEN_NAMES = ['__proto__', 'constructor', 'prototype']

const fail = (message: string): never => {
  throw new Error(`pocketpages-plugin-rbac: memberships: ${message}`)
}

const name = (what: string, value: unknown): string => {
  if (typeof value !== 'string' || !NAME.test(value)) {
    fail(`${what} has to be a name made of letters, digits and _`)
  }
  return value as string
}

/** Checks the shape of the options. The collection itself is looked at when it is first needed. */
export const checkMembershipsOptions = (value: unknown): MembershipsOptions => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('has to be an object')
  }
  const o = value as Record<string, unknown>
  for (const key of Object.keys(o)) {
    if (KEYS.indexOf(key) === -1) fail(`unknown option '${key}'`)
  }
  name('collection', o.collection)
  name('user', o.user)
  name('role', o.role)

  if (!o.scopes || typeof o.scopes !== 'object' || Array.isArray(o.scopes)) {
    fail('scopes has to say which fields point to the groups: { org: "org" }')
  }
  const scopes = o.scopes as Record<string, unknown>
  const scopeNames = Object.keys(scopes)
  if (scopeNames.length === 0) fail('scopes needs at least one group')
  for (const scope of scopeNames) {
    name(`scope '${scope}'`, scope)
    if (FORBIDDEN_NAMES.indexOf(scope) !== -1)
      fail(`'${scope}' is not a good scope name`)
    name(`the field of scope '${scope}'`, scopes[scope])
  }

  if (o.roles !== undefined) {
    if (
      !Array.isArray(o.roles) ||
      o.roles.length === 0 ||
      o.roles.some((r) => typeof r !== 'string' || r === '') ||
      new Set(o.roles).size !== o.roles.length
    ) {
      fail(
        'roles has to be a list of different roles, from the lowest to the highest'
      )
    }
  }
  if (o.status !== undefined) {
    const s = o.status as Record<string, unknown> | null
    if (!s || typeof s !== 'object')
      fail('status has to be { field, active: [...] }')
    name('status.field', s!.field)
    if (
      !Array.isArray(s!.active) ||
      s!.active.length === 0 ||
      s!.active.some((a) => typeof a !== 'string')
    ) {
      fail('status.active has to list the values that count')
    }
  }
  if (o.expires !== undefined) name('expires', o.expires)
  if (o.idPattern !== undefined) {
    if (
      typeof o.idPattern !== 'string' ||
      !o.idPattern.startsWith('^') ||
      !o.idPattern.endsWith('$')
    ) {
      fail('idPattern has to be a regular expression from ^ to $')
    }
    try {
      new RegExp(o.idPattern as string)
    } catch (e) {
      fail(`idPattern is not a regular expression: ${e}`)
    }
  }
  if (o.superuser !== undefined && typeof o.superuser !== 'boolean') {
    fail('superuser has to be true or false')
  }
  return o as unknown as MembershipsOptions
}

/** What a rule can ask of the role in a group */
export type RoleRequirement = {
  atLeast?: string
  roles?: string[]
}

/** Whether `roles` (the ones somebody has in a group) satisfy what a rule asks */
export const rolesSatisfy = (
  roles: string[],
  requirement: RoleRequirement,
  hierarchy: string[] | undefined
): boolean => {
  if (roles.length === 0) return false
  if (requirement.roles && requirement.roles.length > 0) {
    if (!requirement.roles.some((r) => roles.indexOf(r) !== -1)) return false
  }
  if (requirement.atLeast !== undefined) {
    if (!hierarchy) return false
    const needed = hierarchy.indexOf(requirement.atLeast)
    if (needed === -1) return false
    if (
      !roles.some(
        (r) => hierarchy.indexOf(r) >= needed && hierarchy.indexOf(r) !== -1
      )
    ) {
      return false
    }
  }
  return true
}

// --- the database

export type FieldInfo = {
  type: string
  multiple: boolean
  collectionId: string
}

export type Schema = {
  /** The name of the table */
  table: string
  fields: Record<string, FieldInfo>
  indexes: string[]
}

/** The two things that need the database, so that the rest can be tested without one */
export type Backend = {
  schema: (collection: string, fields: string[]) => Schema
  /** Runs a query with its parameters and returns the columns asked for of every row */
  all: (
    sql: string,
    params: Record<string, string>,
    columns: string[]
  ) => Array<Record<string, unknown>>
}

/** PocketBase's JS runtime */
export const jsvmBackend = (): Backend => ({
  schema: (collectionName, wanted) => {
    const collection = $app.findCollectionByNameOrId(collectionName)
    const fields: Record<string, FieldInfo> = {}
    for (const fieldName of wanted) {
      const field = (collection.fields as any).getByName(fieldName)
      if (!field) {
        fail(`the collection '${collectionName}' has no field '${fieldName}'`)
      }
      fields[fieldName] = {
        type: String(field.type()),
        multiple: !!field.isMultiple?.(),
        collectionId: String(field.collectionId ?? ''),
      }
    }
    return {
      table: String(collection.name),
      fields,
      indexes: Array.from((collection.indexes ?? []) as string[]).map(String),
    }
  },
  all: (sql, params, columns) => {
    const shape: Record<string, string> = {}
    for (const column of columns) shape[column] = ''
    const rows = arrayOf(new DynamicModel(shape)) as unknown as Array<
      Record<string, unknown>
    >
    ;($app.db().newQuery(sql) as any).bind(params).all(rows)
    const out: Array<Record<string, unknown>> = []
    for (let i = 0; i < rows.length; i++) {
      const row: Record<string, unknown> = {}
      for (const column of columns) row[column] = rows[i]![column]
      out.push(row)
    }
    return out
  },
})

const quote = (identifier: string) => '`' + identifier + '`'

/** The roles in the value of a role field: a text, or the list of a field that takes several */
export const parseRoles = (value: unknown): string[] => {
  let items: unknown[] = []
  if (Array.isArray(value)) {
    items = value
  } else if (typeof value === 'string' && value !== '') {
    if (value.charAt(0) === '[') {
      try {
        const parsed = JSON.parse(value)
        items = Array.isArray(parsed) ? parsed : []
      } catch {
        items = []
      }
    } else {
      items = [value]
    }
  }
  const roles: string[] = []
  for (const item of items) {
    if (typeof item === 'string' && item !== '' && roles.indexOf(item) === -1) {
      roles.push(item)
    }
  }
  return roles
}

export type Membership = {
  scope: string
  id: string
  roles: string[]
}

type Prepared = {
  userCollectionId: string
  /** The query for the roles of a user in a group, by scope */
  roleSql: Record<string, string>
  /** The query for every membership of a user */
  listSql: string
  scopeColumns: string[]
  warnings: string[]
}

/** The auth record of the signed in user, as far as memberships are concerned */
export type Who = {
  id: string
  collection: () => { id: string }
}

export const createMemberships = (
  options: MembershipsOptions,
  backend: Backend,
  warn: (message: string) => void = () => {}
) => {
  const scopeNames = Object.keys(options.scopes)
  const hierarchy = options.roles
  const idPattern = new RegExp(options.idPattern ?? DEFAULT_ID_PATTERN)
  let prepared: Prepared | undefined

  /**
   * Looks at the collection the first time it is needed (not when the plugin starts: pages
   * that have nothing to do with memberships should not depend on it) and makes the
   * queries. Names of tables and fields only ever come from the config, are checked to be
   * plain names and are quoted; the values never are part of the text of a query.
   */
  const prepare = (): Prepared => {
    if (prepared) return prepared
    const wanted = [options.user, options.role]
    for (const scope of scopeNames) wanted.push(options.scopes[scope]!)
    if (options.status) wanted.push(options.status.field)
    if (options.expires) wanted.push(options.expires)
    const schema = backend.schema(
      options.collection,
      wanted.filter((f, i) => wanted.indexOf(f) === i)
    )

    const userField = schema.fields[options.user]!
    if (userField.type !== 'relation' || userField.multiple) {
      fail(
        `'${options.user}' has to be a relation to the users that takes one value`
      )
    }
    for (const scope of scopeNames) {
      const field = schema.fields[options.scopes[scope]!]!
      if (field.type !== 'relation' || field.multiple) {
        fail(
          `'${options.scopes[scope]}' has to be a relation to the groups that takes one value`
        )
      }
    }
    const roleField = schema.fields[options.role]!
    if (roleField.type !== 'select' && roleField.type !== 'text') {
      fail(`'${options.role}' has to be a select field`)
    }
    if (options.status) {
      const status = schema.fields[options.status.field]!
      if (
        (status.type !== 'select' && status.type !== 'text') ||
        status.multiple
      ) {
        fail(
          `'${options.status.field}' has to be a select field that takes one value`
        )
      }
    }
    if (options.expires && schema.fields[options.expires]!.type !== 'date') {
      fail(`'${options.expires}' has to be a date field`)
    }

    const warnings: string[] = []
    const covers = (index: string, columns: string[]) =>
      /\bUNIQUE\b/i.test(index) && columns.every((c) => index.indexOf(c) !== -1)
    for (const scope of scopeNames) {
      const columns = [options.user, options.scopes[scope]!]
      if (!schema.indexes.some((index) => covers(index, columns))) {
        warnings.push(
          `'${options.collection}' has no unique index on (${columns.join(', ')}): the same person could be in a group twice, and lookups are slower`
        )
      }
    }

    const t = quote(schema.table)
    const filters: string[] = []
    if (options.status) {
      const placeholders = options.status.active.map((_, i) => `{:a${i}}`)
      filters.push(
        `${quote(options.status.field)} IN (${placeholders.join(', ')})`
      )
    }
    if (options.expires) {
      const e = quote(options.expires)
      filters.push(`(${e} = '' OR ${e} IS NULL OR ${e} > {:now})`)
    }
    const extra = filters.length > 0 ? ` AND ${filters.join(' AND ')}` : ''

    const roleSql: Record<string, string> = {}
    for (const scope of scopeNames) {
      roleSql[scope] =
        `SELECT ${quote(options.role)} AS r FROM ${t} ` +
        `WHERE ${quote(options.user)} = {:u} AND ${quote(options.scopes[scope]!)} = {:s}${extra} LIMIT 100`
    }
    const scopeColumns = scopeNames.map((_, i) => `s${i}`)
    const listSql =
      `SELECT ${quote(options.role)} AS r, ` +
      scopeNames
        .map((scope, i) => `${quote(options.scopes[scope]!)} AS s${i}`)
        .join(', ') +
      ` FROM ${t} WHERE ${quote(options.user)} = {:u}${extra} LIMIT 1000`

    prepared = {
      userCollectionId: userField.collectionId,
      roleSql,
      listSql,
      scopeColumns,
      warnings,
    }
    for (const message of warnings) warn(message)
    return prepared
  }

  const baseParams = (who: Who): Record<string, string> => {
    const params: Record<string, string> = { u: who.id }
    if (options.status) {
      options.status.active.forEach((value, i) => {
        params[`a${i}`] = value
      })
    }
    if (options.expires) {
      // The way PocketBase writes dates, which compares as text
      params.now = new Date().toISOString().replace('T', ' ')
    }
    return params
  }

  const known = (roles: string[]) =>
    hierarchy ? roles.filter((r) => hierarchy.indexOf(r) !== -1) : roles

  /** Whether the user belongs to the collection the memberships point to */
  const isUserOfCollection = (who: Who, p: Prepared) => {
    try {
      return who.collection().id === p.userCollectionId
    } catch {
      return false
    }
  }

  return {
    hierarchy,
    superuser: options.superuser === true,
    scopes: scopeNames,

    /** Whether a text can be the id of a group. Nothing else is ever asked of the database. */
    isId: (value: unknown): value is string =>
      typeof value === 'string' && value.length <= 64 && idPattern.test(value),

    /** The roles `who` has in the group `id` of kind `scope`; `[]` for none */
    rolesIn: (
      who: Who | null | undefined,
      scope: string,
      id: string
    ): string[] => {
      if (!who) return []
      if (scopeNames.indexOf(scope) === -1) {
        fail(`unknown scope '${scope}'`)
      }
      if (!idPattern.test(id)) return []
      const p = prepare()
      if (!isUserOfCollection(who, p)) return []
      const rows = backend.all(
        p.roleSql[scope]!,
        { ...baseParams(who), s: id },
        ['r']
      )
      const roles: string[] = []
      for (const row of rows) {
        for (const role of known(parseRoles(row.r))) {
          if (roles.indexOf(role) === -1) roles.push(role)
        }
      }
      return roles
    },

    /** Every group `who` belongs to, with the roles in each */
    list: (who: Who | null | undefined): Membership[] => {
      if (!who) return []
      const p = prepare()
      if (!isUserOfCollection(who, p)) return []
      const rows = backend.all(p.listSql, baseParams(who), [
        'r',
        ...p.scopeColumns,
      ])
      const found = new Map<string, Membership>()
      for (const row of rows) {
        const roles = known(parseRoles(row.r))
        if (roles.length === 0) continue
        scopeNames.forEach((scope, i) => {
          const id = row[`s${i}`]
          if (typeof id !== 'string' || id === '' || !idPattern.test(id)) return
          const key = `${scope}\0${id}`
          const membership = found.get(key) ?? { scope, id, roles: [] }
          for (const role of roles) {
            if (membership.roles.indexOf(role) === -1)
              membership.roles.push(role)
          }
          found.set(key, membership)
        })
      }
      return Array.from(found.values())
    },
  }
}

export type Memberships = ReturnType<typeof createMemberships>
