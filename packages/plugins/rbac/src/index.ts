import type {
  PagesRequest,
  PluginFactory,
  PluginOptionsBase,
} from 'pocketpages'
import {
  Backend,
  checkMembershipsOptions,
  createMemberships,
  jsvmBackend,
  Membership,
  MembershipsOptions,
  rolesSatisfy,
  Who,
} from './memberships'
import { roleFieldRisks } from './roleField'
import {
  AccessRule,
  compileRules,
  decideAll,
  Decision,
  guardDecision,
  GuardRule,
  Members,
  misplacedPlugins,
  safeNext,
  Subject,
  subjectOfAuth,
} from './rules'

export type { Membership, MembershipsOptions } from './memberships'
export { safeNext } from './rules'
export type {
  AccessRule,
  Decision,
  GuardRule,
  MemberRule,
  Subject,
} from './rules'

/**
 * For the routes you register with PocketBase's `routerAdd()`, which PocketPages does not
 * serve: the same roles as the rules of your pages. Call it in the handler or in a
 * middleware, and it throws a 401, 403 or 404 (with `hide`) for whoever may not go on.
 *
 * ```js
 * routerAdd('GET', '/api/myapp/reports', (e) => {
 *   require('pocketpages-plugin-rbac').guard(e, { roles: ['admin'] })
 *   return e.json(200, { ok: true })
 * })
 * ```
 *
 * PocketBase handlers can't see variables outside of them, so the rule is given to the
 * function every time. Who is signed in comes from `e.auth`: PocketBase reads the token of
 * the `Authorization` header, and nothing else.
 */
export const guard = (
  e: core.RequestEvent,
  rule: GuardRule,
  roleField = 'role'
): void => {
  const decision = guardDecision(
    subjectOfAuth(e.auth as never, roleField),
    rule
  )
  switch (decision) {
    case 'allow':
      return
    case 'unauthenticated':
      throw new UnauthorizedError('Sign in required')
    case 'hidden':
      throw new NotFoundError()
    default:
      throw new ForbiddenError(
        decision === 'unverified'
          ? 'Email address not confirmed'
          : 'Not allowed'
      )
  }
}

export type RbacOptions = PluginOptionsBase & {
  /** Who may go where. The first rule that covers a request decides. */
  rules: AccessRule[]
  /** The field of the user with its role (or roles), `role` unless told otherwise */
  roleField: string
  /**
   * Where visitors who have to sign in are sent, `/login` unless told otherwise.
   * `false` leaves them with a 401.
   */
  loginPath: string | false
  /** The parameter that carries the page to come back to, `next` unless told otherwise */
  nextParam: string
  /** What to say on the login page, if the session plugin is there to carry it */
  loginMessage: string
  /** Where signed in visitors who are not allowed are sent, instead of getting a 403 */
  forbiddenPath: string
  /** Where signed in visitors who have not confirmed their email address are sent, instead of getting a 403 */
  unverifiedPath: string
  /**
   * Roles in groups (organizations, teams, projects), kept in a collection of
   * memberships. Rules then say `member: { scope: 'org' }`.
   */
  memberships: MembershipsOptions
}

const VALID_KEYS = [
  'debug',
  'rules',
  'roleField',
  'loginPath',
  'nextParam',
  'loginMessage',
  'forbiddenPath',
  'unverifiedPath',
  'memberships',
]

/** What pages get as `rbac` */
export type Rbac = {
  /** The roles of the signed in user, `[]` for visitors */
  roles: () => string[]
  /** Whether the user has at least one of these roles */
  hasRole: (...roles: string[]) => boolean
  /**
   * Whether the rules would let the user make a request to `path`: to show the links
   * that lead somewhere the user can go, say
   */
  can: (path: string, method?: string) => boolean
  /** Throws a 401 for visitors who are not signed in, which sends them to the login page */
  requireAuth: () => void
  /** Throws a 401 for visitors, a 403 for users who have none of these roles */
  requireRole: (...roles: string[]) => void
  /** `/login?next=...` for the page the visitor is on */
  loginUrl: (next?: string) => string
  /**
   * The groups the request came in through: `{ org: '4gh3k...' }` for `/orgs/4gh3k.../billing`
   * under a rule with `member: { scope: 'org' }`. Use these in your queries rather than
   * `params`: this is the id that was checked.
   */
  scope: Record<string, string>
  /** The roles of the signed in user in a group (the one of the request by default), or `null` if not in it */
  member: (scope: string, id?: string) => { id: string; roles: string[] } | null
  /**
   * Throws a 401 for visitors, a 404 for people who are not in the group (the one of the
   * request by default), and a 403 for those whose role is too low
   */
  requireMember: (
    scope: string,
    options?: { id?: string; atLeast?: string; roles?: string[] }
  ) => void
  /** Every group the signed in user is in, with the roles in each */
  memberships: () => Membership[]
}

const prefersJson = (accept: string) => {
  const lower = accept.toLowerCase()
  return (
    (lower.indexOf('application/json') !== -1 ||
      lower.indexOf('+json') !== -1) &&
    lower.indexOf('text/html') === -1
  )
}

/**
 * Lets tests give the plugin a database of their own. Not for use in apps.
 * @internal
 */
let backend: Backend | undefined
export const useBackend = (replacement: Backend | undefined) => {
  backend = replacement
}

const rbacPluginFactory: PluginFactory<RbacOptions> = (config, extra) => {
  const { globalApi, dbg } = config

  Object.keys(extra).forEach((key) => {
    if (!VALID_KEYS.includes(key)) {
      throw new Error(`pocketpages-plugin-rbac: unknown option '${key}'`)
    }
  })

  const options = {
    rules: [] as AccessRule[],
    roleField: 'role',
    loginPath: '/login' as string | false,
    nextParam: 'next',
    loginMessage: '',
    forbiddenPath: '',
    unverifiedPath: '',
    ...extra,
  }
  const memberships = extra.memberships
    ? createMemberships(
        checkMembershipsOptions(extra.memberships),
        backend ?? jsvmBackend(),
        (message) => {
          try {
            $app.logger().warn(`pocketpages-plugin-rbac: ${message}`)
          } catch {
            dbg(message)
          }
        }
      )
    : undefined
  const rules = compileRules(
    options.rules,
    globalApi.pathMatcher,
    memberships && {
      scopes: memberships.scopes,
      hierarchy: memberships.hierarchy,
    }
  )

  // Rules are checked against the request as it is when they run. A plugin listed
  // after this one that rewrites the address or the method would get past them.
  const misplaced = misplacedPlugins(
    (config.config?.plugins as unknown[] | undefined) ?? []
  )
  if (misplaced.length > 0) {
    throw new Error(
      `pocketpages-plugin-rbac: list it after ${misplaced.join(' and ')}, or its rules are checked against a request that is not the one that gets served`
    )
  }

  const subjectOf = (request: PagesRequest): Subject =>
    subjectOfAuth(request.auth as never, options.roleField)

  /**
   * What deciding needs of the memberships, for one request. What the database says is
   * asked once per group and request, and never kept for the next one.
   */
  const membersOf = (
    request: PagesRequest,
    remember: boolean
  ): Members | undefined => {
    if (!memberships) return undefined
    const asked = () => {
      const state = request.state.rbac ?? (request.state.rbac = {})
      return (state.asked ?? (state.asked = {})) as Record<string, string[]>
    }
    return {
      isId: memberships.isId,
      hierarchy: memberships.hierarchy,
      superuser: memberships.superuser,
      rolesIn: (scope, id) => {
        const cache = asked()
        const key = `${scope}\u0000${id}`
        return (
          cache[key] ??
          (cache[key] = memberships.rolesIn(
            request.auth as unknown as Who | undefined,
            scope,
            id
          ))
        )
      },
      entered: remember
        ? (scope, id) => {
            const state = request.state.rbac ?? (request.state.rbac = {})
            ;(state.scope ?? (state.scope = {}))[scope] = id
          }
        : undefined,
    }
  }

  /** Where the visitor is, as they asked for it */
  const hereOf = (request: PagesRequest) => {
    const url = request.event.request!.url!
    const path = url.escapedPath?.() ?? url.path
    return url.rawQuery ? `${path}?${url.rawQuery}` : path
  }

  /**
   * The page in the language of the visitor, when the i18n plugin has a say
   */
  const localized = (request: PagesRequest, path: string) =>
    (request.state.i18n?.path?.(path) as string | undefined) ?? path

  const loginUrlFor = (request: PagesRequest, next?: string) => {
    const login = localized(request, options.loginPath || '/login')
    if (!options.nextParam) return login
    const target = safeNext(next ?? hereOf(request), '/')
    return `${login}${login.indexOf('?') === -1 ? '?' : '&'}${options.nextParam}=${encodeURIComponent(target)}`
  }

  /**
   * Says no. The decision is left in `request.state.rbac` for the `onError` hook, which
   * is what sends visitors to a page instead of showing them an error.
   */
  const refuse = (
    request: PagesRequest,
    decision: Exclude<Decision, 'allow'>
  ): never => {
    request.state.rbac = { ...request.state.rbac, decision }
    switch (decision) {
      case 'unauthenticated':
        throw new UnauthorizedError('Sign in required')
      case 'forbidden':
        throw new ForbiddenError('Not allowed')
      case 'unverified':
        throw new ForbiddenError('Email address not confirmed')
      case 'hidden':
        throw new NotFoundError()
    }
  }

  /**
   * Applies the rules to the request as it is now. A plugin may change the address or
   * the method after this one has looked at them, so this runs once more, when pages
   * get their API, for whatever is not the same by then.
   */
  const check = (request: PagesRequest) => {
    const key = `${request.method} ${request.pathname}`
    if (request.state.rbac?.checked === key) return
    const decision = decideAll(
      rules,
      subjectOf(request),
      request.method,
      request.pathname,
      request.canonicalPath ?? request.pathname,
      membersOf(request, true)
    )
    if (decision === 'allow') {
      request.state.rbac = { ...request.state.rbac, checked: key }
      return
    }
    dbg(`${decision}: ${request.method} ${request.pathname}`)
    refuse(request, decision)
  }

  /**
   * The role is trusted, so it matters who can write it through PocketBase's API.
   * Looked at once, the first time a request comes in, and only warned about.
   */
  let roleFieldChecked = false
  const checkRoleField = () => {
    if (roleFieldChecked) return
    roleFieldChecked = true
    try {
      const users = $app.findCollectionByNameOrId('users')
      const rule = (value: unknown) =>
        value === null || value === undefined ? null : String(value)
      const risks = roleFieldRisks(
        {
          name: 'users',
          hasField: !!users.fields.getByName(options.roleField),
          createRule: rule(users.createRule),
          updateRule: rule(users.updateRule),
        },
        options.roleField
      )
      for (let i = 0; i < risks.length; i++) {
        $app.logger().warn(`pocketpages-plugin-rbac: ${risks[i]}`)
      }
    } catch {
      // No users collection, or nothing to look at
    }
  }

  return {
    name: 'rbac',

    onRequest: ({ request, route }) => {
      checkRoleField()
      // Requests PocketPages does not serve are for PocketBase, and its own rules
      if (!route || rules.length === 0) return
      check(request)
    },

    onError: ({ status, request, response, route }) => {
      // Only pages are answered with a page. JSON clients and PocketBase's API keep
      // their status codes.
      if (!route || prefersJson(request.header('Accept'))) return

      let target: string | undefined
      if (status === 401) {
        if (options.loginPath === false) return
        target = loginUrlFor(request)
        if (options.loginMessage && request.pathname !== options.loginPath) {
          request.state.session?.flash?.('info', options.loginMessage)
        }
      } else if (status === 403) {
        const unverified = request.state.rbac?.decision === 'unverified'
        target =
          (unverified && options.unverifiedPath) ||
          options.forbiddenPath ||
          undefined
      }
      // Already where they would be sent: doing it again would never end
      if (!target || request.pathname === target.split('?')[0]) return
      if (status === 403) target = localized(request, target)

      const safe = request.method === 'GET' || request.method === 'HEAD'
      response.redirect(target, safe ? 302 : 303)
      return true
    },

    onExtendContextApi: ({ api }) => {
      const { request } = api
      if (rules.length > 0) check(request)
      let subject: Subject | undefined
      const who = () => subject ?? (subject = subjectOf(request))
      const needMembers = (): Members => {
        const members = membersOf(request, false)
        if (!members) {
          throw new Error(
            'pocketpages-plugin-rbac: there is no memberships option, so there are no groups to ask about'
          )
        }
        return members
      }

      const rbac: Rbac = {
        roles: () => who().roles.slice(),
        hasRole: (...roles) => roles.some((r) => who().roles.indexOf(r) !== -1),
        can: (path, method = 'GET') =>
          decideAll(
            rules,
            who(),
            method.toUpperCase(),
            path,
            globalApi.canonicalPath(path),
            membersOf(request, false)
          ) === 'allow',
        requireAuth: () => {
          if (!who().signedIn) refuse(request, 'unauthenticated')
        },
        requireRole: (...roles) => {
          if (!who().signedIn) refuse(request, 'unauthenticated')
          if (!rbac.hasRole(...roles)) refuse(request, 'forbidden')
        },
        loginUrl: (next) => loginUrlFor(request, next),
        get scope() {
          return { ...(request.state.rbac?.scope ?? {}) }
        },
        member: (scope, id) => {
          const members = needMembers()
          const target = id ?? request.state.rbac?.scope?.[scope]
          if (!who().signedIn || target === undefined) return null
          if (!members.isId(target)) return null
          const roles = members.rolesIn(scope, target)
          return roles.length > 0 ? { id: target, roles: roles.slice() } : null
        },
        requireMember: (scope, opts = {}) => {
          const members = needMembers()
          if (!who().signedIn) refuse(request, 'unauthenticated')
          const id = opts.id ?? request.state.rbac?.scope?.[scope]
          if (id === undefined || !members.isId(id)) refuse(request, 'hidden')
          if (members.superuser && who().roles.indexOf('superuser') !== -1) {
            return
          }
          const roles = members.rolesIn(scope, id!)
          if (roles.length === 0) refuse(request, 'hidden')
          if (!rolesSatisfy(roles, opts, members.hierarchy)) {
            refuse(request, 'forbidden')
          }
        },
        memberships: () => {
          needMembers()
          const state = request.state.rbac ?? (request.state.rbac = {})
          return (
            state.list ??
            (state.list = memberships!.list(
              request.auth as unknown as Who | undefined
            ))
          ).map((m: Membership) => ({ ...m, roles: m.roles.slice() }))
        },
      }
      api.rbac = rbac
    },
  }
}

export default rbacPluginFactory
