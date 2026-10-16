import { rolesSatisfy } from './memberships'

export type AccessRule = {
  /** Where the rule applies: `/admin/**`, `/account`, `['/a', '/b/*']`... */
  path: string | string[]
  /** Only for these methods. Every method unless told otherwise. */
  methods?: string[]
  /** Anyone may come in. For exceptions to rules further down. */
  public?: boolean
  /** Visitors have to be signed in */
  auth?: boolean
  /** Visitors have to be signed in and have one of these roles */
  roles?: string[]
  /** Visitors have to be signed in and have confirmed their email address */
  verified?: boolean
  /** Answer visitors that are not allowed with a 404, to not tell the page exists */
  hide?: boolean
  /**
   * Visitors have to belong to a group (an organization, a team...) that the address says
   * which one: `path: '/orgs/[org]/**', member: { scope: 'org' }`. See the memberships option.
   */
  member?: MemberRule
}

export type MemberRule = {
  /** The kind of group, one of the keys of `memberships.scopes` */
  scope: string
  /** The `[name]` in `path` that holds the id of the group. The scope unless told otherwise. */
  param?: string
  /** The lowest role that comes in, per the order of `memberships.roles` */
  atLeast?: string
  /** Or any of these roles */
  roles?: string[]
}

/**
 * Who is asking
 */
export type Subject = {
  signedIn: boolean
  roles: string[]
  verified: boolean
}

export type Decision =
  | 'allow'
  /** Has to sign in first */
  | 'unauthenticated'
  /** Signed in, but not allowed */
  | 'forbidden'
  /** Signed in, but has not confirmed the email address */
  | 'unverified'
  /** Not allowed, and not to be told the page exists */
  | 'hidden'

export type CompiledRule = {
  match: (pathname: string) => boolean
  methods: Set<string> | undefined
  isPublic: boolean
  roles: string[] | undefined
  needsSignIn: boolean
  verified: boolean
  hide: boolean
  member: CompiledMember | undefined
}

type CompiledMember = {
  scope: string
  atLeast: string | undefined
  roles: string[] | undefined
  /** Where the id of the group is in the path: the position of the segment */
  idAt: (pathname: string) => number
}

/** What compiling rules needs to know about the memberships of the config */
export type MembershipSetup = {
  scopes: string[]
  /** The roles from the lowest, when the config says so */
  hierarchy: string[] | undefined
}

const PLACEHOLDER = /^\[([A-Za-z_][A-Za-z0-9_]*)\]$/

/**
 * `/orgs/[org]/**` -> the pattern for `pathMatcher` (`/orgs/*` + `/**`) and where the
 * `[org]` is. The segments before it each take exactly one segment of the path, or it
 * would not be known where the id is.
 */
const memberPattern = (
  pattern: string,
  param: string
): { pattern: string; at: number } => {
  const segments = pattern.split('/')
  if (!segments.some((segment) => PLACEHOLDER.test(segment))) {
    throw new Error(
      `pocketpages-plugin-rbac: the path '${pattern}' needs [${param}], where the id of the group is`
    )
  }
  let at = -1
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!
    const placeholder = PLACEHOLDER.exec(segment)
    if (placeholder) {
      if (placeholder[1] !== param) {
        throw new Error(
          `pocketpages-plugin-rbac: the path '${pattern}' has [${placeholder[1]}], and the rule says [${param}]`
        )
      }
      if (at !== -1) {
        throw new Error(
          `pocketpages-plugin-rbac: [${param}] is twice in the path '${pattern}'`
        )
      }
      at = i
      segments[i] = '*'
    } else if (at === -1 && segment === '**') {
      throw new Error(
        `pocketpages-plugin-rbac: in '${pattern}', [${param}] has to come before any **`
      )
    }
  }
  if (at === -1) {
    throw new Error(
      `pocketpages-plugin-rbac: the path '${pattern}' needs [${param}], where the id of the group is`
    )
  }
  return { pattern: segments.join('/'), at }
}

export const compileRules = (
  rules: AccessRule[],
  pathMatcher: (patterns: string | string[]) => (pathname: string) => boolean,
  setup?: MembershipSetup
): CompiledRule[] =>
  rules.map((rule, index) => {
    if (!rule.path || (Array.isArray(rule.path) && rule.path.length === 0)) {
      throw new Error(`pocketpages-plugin-rbac: rule ${index} needs a path`)
    }
    if (rule.roles !== undefined && !Array.isArray(rule.roles)) {
      throw new Error(
        `pocketpages-plugin-rbac: roles of rule ${index} must be a list`
      )
    }
    const roles = rule.roles && rule.roles.length > 0 ? rule.roles : undefined
    const isPublic = rule.public === true
    if (isPublic && (rule.auth || roles || rule.verified || rule.member)) {
      throw new Error(
        `pocketpages-plugin-rbac: rule ${index} is public, it cannot ask for more`
      )
    }
    if (rule.member) {
      if (roles || rule.auth) {
        throw new Error(
          `pocketpages-plugin-rbac: rule ${index} is about a group: use member.roles or member.atLeast, not roles or auth`
        )
      }
      return compileMemberRule(rule, index, pathMatcher, setup)
    }
    if (!isPublic && !rule.auth && !roles && !rule.verified) {
      throw new Error(
        `pocketpages-plugin-rbac: rule ${index} says nothing: add auth, roles, verified, member or public`
      )
    }
    return {
      match: pathMatcher(rule.path),
      methods: rule.methods
        ? new Set(rule.methods.map((method) => method.toUpperCase()))
        : undefined,
      isPublic,
      roles,
      needsSignIn: !isPublic,
      verified: rule.verified === true,
      hide: rule.hide === true,
      member: undefined,
    }
  })

const compileMemberRule = (
  rule: AccessRule,
  index: number,
  pathMatcher: (patterns: string | string[]) => (pathname: string) => boolean,
  setup: MembershipSetup | undefined
): CompiledRule => {
  const member = rule.member!
  const where = `rule ${index}`
  if (!setup) {
    throw new Error(
      `pocketpages-plugin-rbac: ${where} is about a group, and there is no memberships option`
    )
  }
  if (!member.scope || setup.scopes.indexOf(member.scope) === -1) {
    throw new Error(
      `pocketpages-plugin-rbac: ${where}: unknown scope '${member.scope}', the memberships option has ${setup.scopes.join(', ')}`
    )
  }
  if (member.atLeast !== undefined) {
    if (!setup.hierarchy || setup.hierarchy.indexOf(member.atLeast) === -1) {
      throw new Error(
        `pocketpages-plugin-rbac: ${where}: atLeast '${member.atLeast}' is not one of memberships.roles`
      )
    }
  }
  if (member.roles !== undefined) {
    if (!Array.isArray(member.roles)) {
      throw new Error(
        `pocketpages-plugin-rbac: ${where}: member.roles must be a list`
      )
    }
    if (setup.hierarchy) {
      for (const role of member.roles) {
        if (setup.hierarchy.indexOf(role) === -1) {
          throw new Error(
            `pocketpages-plugin-rbac: ${where}: role '${role}' is not one of memberships.roles`
          )
        }
      }
    }
  }
  const param = member.param ?? member.scope
  const patterns = (Array.isArray(rule.path) ? rule.path : [rule.path]).map(
    (p) => memberPattern(p, param)
  )
  const matchers = patterns.map((p) => ({
    match: pathMatcher(p.pattern),
    at: p.at,
  }))
  return {
    match: (pathname) => matchers.some((m) => m.match(pathname)),
    methods: rule.methods
      ? new Set(rule.methods.map((method) => method.toUpperCase()))
      : undefined,
    isPublic: false,
    roles: undefined,
    needsSignIn: true,
    verified: rule.verified === true,
    // Whoever is not in the group is not told it exists, unless the rule says otherwise
    hide: rule.hide !== false,
    member: {
      scope: member.scope,
      atLeast: member.atLeast,
      roles: member.roles && member.roles.length > 0 ? member.roles : undefined,
      idAt: (pathname) => {
        for (const m of matchers) if (m.match(pathname)) return m.at
        return -1
      },
    },
  }
}

/** What deciding needs to know about memberships */
export type Members = {
  /** Can this text be the id of a group */
  isId: (value: unknown) => boolean
  /** The roles of the signed in user in a group: `[]` if none. May ask the database. */
  rolesIn: (scope: string, id: string) => string[]
  /** The roles from the lowest, when the config says so */
  hierarchy: string[] | undefined
  /** Superusers come into every group */
  superuser: boolean
  /** Called with the group of every rule that let the request in */
  entered?: (scope: string, id: string) => void
}

/**
 * Whether `subject` may make a request with `method` to `pathname`. The first rule that
 * covers the request decides; requests no rule covers are allowed.
 */
export const decide = (
  rules: CompiledRule[],
  subject: Subject,
  method: string,
  pathname: string,
  members?: Members
): Decision => {
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]!
    if (rule.methods && !rule.methods.has(method)) continue
    if (!rule.match(pathname)) continue
    if (rule.isPublic) return 'allow'
    if (rule.member) return decideMember(rule, subject, pathname, members)
    if (!subject.signedIn) return rule.hide ? 'hidden' : 'unauthenticated'
    if (
      rule.roles &&
      !rule.roles.some((r) => subject.roles.indexOf(r) !== -1)
    ) {
      return rule.hide ? 'hidden' : 'forbidden'
    }
    if (rule.verified && !subject.verified) return 'unverified'
    return 'allow'
  }
  return 'allow'
}

/**
 * A rule about a group. Visitors are sent to sign in. People who are signed in and are not
 * in the group are refused as if there were no such group (unless `hide: false`); people
 * who are in it with too low a role are refused openly, since they know it is there.
 * Everything that can't be an id, or that is not asked about, is a refusal.
 */
const decideMember = (
  rule: CompiledRule,
  subject: Subject,
  pathname: string,
  members: Members | undefined
): Decision => {
  const member = rule.member!
  if (!subject.signedIn) return 'unauthenticated'
  if (!members) return rule.hide ? 'hidden' : 'forbidden'
  const notInGroup: Decision = rule.hide ? 'hidden' : 'forbidden'

  const id = pathname.split('/')[member.idAt(pathname)]
  if (id === undefined || !members.isId(id)) return notInGroup

  if (members.superuser && subject.roles.indexOf('superuser') !== -1) {
    // Not a member, and allowed in
  } else {
    const roles = members.rolesIn(member.scope, id)
    if (roles.length === 0) return notInGroup
    if (!rolesSatisfy(roles, member, members.hierarchy)) return 'forbidden'
  }
  if (rule.verified && !subject.verified) return 'unverified'
  members.entered?.(member.scope, id)
  return 'allow'
}

/**
 * The roles in the field of the user: a text (`select` field) or a list (`select` field
 * that takes several values). Superusers of PocketBase have the role `superuser`.
 */
export const rolesOf = (value: unknown, superuser: boolean): string[] => {
  const roles: string[] = []
  const add = (item: unknown) => {
    if (typeof item === 'string' && item !== '' && roles.indexOf(item) === -1) {
      roles.push(item)
    }
  }
  if (Array.isArray(value)) {
    value.forEach(add)
  } else {
    add(value)
  }
  if (superuser) add('superuser')
  return roles
}

/**
 * Who a signed in record is: its roles, and whether it has confirmed its email address.
 * Works for the `request.auth` of pages and for the `e.auth` of PocketBase's own routes.
 */
export const subjectOfAuth = (
  auth:
    | {
        get: (field: string) => unknown
        collection: () => { name: string }
      }
    | null
    | undefined,
  roleField: string
): Subject => {
  if (!auth) return { signedIn: false, roles: [], verified: false }
  let superuser = false
  try {
    superuser = auth.collection().name === '_superusers'
  } catch {
    // Not a record we can tell the collection of
  }
  return {
    signedIn: true,
    roles: rolesOf(auth.get(roleField), superuser),
    verified: superuser || auth.get('verified') === true,
  }
}

/** What a route of PocketBase can ask of whoever calls it */
export type GuardRule = {
  /** Signed in */
  auth?: boolean
  /** Signed in, with any of these roles */
  roles?: string[]
  /** Signed in, with a confirmed email address */
  verified?: boolean
  /** Answer 404 instead of 401 or 403 */
  hide?: boolean
}

/**
 * The error to throw for `subject` under `rule`, as a name of PocketBase's errors, or
 * `undefined` when the request may go on.
 */
export const guardDecision = (
  subject: Subject,
  rule: GuardRule
): Exclude<Decision, 'allow'> | 'allow' => {
  const compiled = compileRules([{ path: '/', ...rule }], () => () => true)
  return decide(compiled, subject, 'GET', '/')
}

/**
 * A place on this site that is safe to send visitors to after they sign in: a path, not
 * an address elsewhere. Redirecting to whatever `?next=` says is how sites end up
 * sending people to phishing pages.
 */
export const safeNext = (value: unknown, fallback = '/'): string => {
  if (typeof value !== 'string' || value === '') return fallback
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback
  if (value.charAt(0) !== '/') return fallback
  // `//host` and `/\host` are addresses elsewhere for browsers
  const second = value.charAt(1)
  if (second === '/' || second === '\\') return fallback
  if (value.indexOf('\\') !== -1) return fallback
  return value
}

const RBAC = 'pocketpages-plugin-rbac'

/**
 * Plugins that change the address or the method of a request, and so have to come before
 * the rules are applied: the rules would otherwise be checked against a request that is
 * not the one that gets served (`/es/admin` for the page at `/admin`, a `POST` that
 * is served as a `DELETE`).
 */
const REWRITERS: Array<{
  name: string
  why: string
  off?: (options: Record<string, unknown>) => boolean
}> = [
  {
    name: 'pocketpages-plugin-i18n',
    why: 'it takes the language out of the address',
  },
  {
    name: 'pocketpages-plugin-forms',
    why: 'it turns a POST into a PUT, PATCH or DELETE',
    off: (options) => options.methodOverride === false,
  },
]

const nameOf = (plugin: unknown): string | undefined => {
  if (typeof plugin === 'string') return plugin
  if (plugin && typeof plugin === 'object') {
    const name = (plugin as Record<string, unknown>).name
    return typeof name === 'string' ? name : undefined
  }
  return undefined
}

/**
 * The plugins of the config that rewrite requests and are listed after RBAC. Plugins
 * written as functions can't be told apart and are left alone.
 */
export const misplacedPlugins = (plugins: unknown[]): string[] => {
  const mine = plugins.findIndex((plugin) => nameOf(plugin) === RBAC)
  if (mine === -1) return []
  const found: string[] = []
  for (let i = mine + 1; i < plugins.length; i++) {
    const plugin = plugins[i]
    const name = nameOf(plugin)
    const rewriter = REWRITERS.find((r) => r.name === name)
    if (!rewriter) continue
    const options =
      plugin && typeof plugin === 'object'
        ? (plugin as Record<string, unknown>)
        : {}
    if (rewriter.off?.(options)) continue
    found.push(`${rewriter.name} (${rewriter.why})`)
  }
  return found
}

/**
 * Decides for the address in the URL and for the address of the page that serves it
 * (`/account` for `/account/index`): the request is let through only if both are allowed.
 * Several URLs lead to one page, and a rule for the page has to hold for all of them.
 */
export const decideAll = (
  rules: CompiledRule[],
  subject: Subject,
  method: string,
  pathname: string,
  canonicalPath: string,
  members?: Members
): Decision => {
  const literal = decide(rules, subject, method, pathname, members)
  if (literal !== 'allow' || canonicalPath === pathname) return literal
  return decide(rules, subject, method, canonicalPath, members)
}
