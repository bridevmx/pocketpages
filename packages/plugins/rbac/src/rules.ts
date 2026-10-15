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
}

export const compileRules = (
  rules: AccessRule[],
  pathMatcher: (patterns: string | string[]) => (pathname: string) => boolean
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
    if (isPublic && (rule.auth || roles || rule.verified)) {
      throw new Error(
        `pocketpages-plugin-rbac: rule ${index} is public, it cannot ask for more`
      )
    }
    if (!isPublic && !rule.auth && !roles && !rule.verified) {
      throw new Error(
        `pocketpages-plugin-rbac: rule ${index} says nothing: add auth, roles, verified or public`
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
    }
  })

/**
 * Whether `subject` may make a request with `method` to `pathname`. The first rule that
 * covers the request decides; requests no rule covers are allowed.
 */
export const decide = (
  rules: CompiledRule[],
  subject: Subject,
  method: string,
  pathname: string
): Decision => {
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]!
    if (rule.methods && !rule.methods.has(method)) continue
    if (!rule.match(pathname)) continue
    if (rule.isPublic) return 'allow'
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
  canonicalPath: string
): Decision => {
  const literal = decide(rules, subject, method, pathname)
  if (literal !== 'allow' || canonicalPath === pathname) return literal
  return decide(rules, subject, method, canonicalPath)
}
