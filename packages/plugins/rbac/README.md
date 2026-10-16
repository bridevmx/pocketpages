# PocketPages RBAC Plugin

Decide who can open which pages: visitors, signed in users, users with a role, users who have confirmed their email address.

- **Rules in your config**: `/admin/**` for admins, `/account/**` for anyone signed in. No code in each page.
- **Visitors are sent to the login page**, and come back to where they were going afterwards.
- **Helpers for pages and loaders**: show a link only to the people who can follow it, or check a role in a loader.
- Works with the roles you keep in the users collection of PocketBase, and knows about superusers.

It needs `pocketpages` 0.23 or newer, and the [auth plugin](/docs/plugins/auth) to tell who is signed in.

## Installation

```bash
npm install pocketpages-plugin-rbac
```

## Setup

List it **after** the auth plugin, which is what finds out who is signed in, and **after every plugin that changes the address or the method of a request**: [i18n](/docs/plugins/i18n) (it takes `/es` out of the address) and [forms](/docs/plugins/forms) (it turns a `POST` into a `DELETE`). The rules are about the request that gets served. If the plugin finds one of those listed after it, it refuses to start and says so, rather than let the rules be checked against a request that is not the one the page gets.

```javascript
// +config.js
module.exports = {
  plugins: [
    'pocketpages-plugin-ejs',
    'pocketpages-plugin-js-sdk',
    'pocketpages-plugin-auth',
    {
      name: 'pocketpages-plugin-rbac',
      rules: [
        { path: '/login', public: true },
        { path: '/account/**', auth: true },
        { path: '/admin/**', roles: ['admin'] },
      ],
    },
  ],
}
```

Add a field for the role to your users collection: a `select` field called `role` with the values you want (`admin`, `editor`...). A `select` field that accepts several values works too.

**Then close that field to the API.** PocketBase's rules for a users collection let anybody register and every user edit their own record, so a `role` field that the rules do not mention can be set to `admin` through PocketBase's API (`POST /api/collections/users/records` with `{"role": "admin"}`, or a `PATCH` to your own record) and your rules would let them in. Set the rules of the users collection (Collection → API rules, or in a migration) to:

```
createRule: @request.body.role:isset = false
updateRule: id = @request.auth.id && @request.body.role:isset = false
```

Visitors can still register and edit their profile, and nobody but a superuser (or your own code, which uses `$app`) can give a role. If your field has another name, use that name. The plugin looks at the `users` collection when the first request comes in and writes a warning to PocketBase's log if the rules say nothing about the field.

## Rules

```javascript
rules: [
  { path: '/login', public: true }, // anyone, an exception to the rule below
  { path: '/admin/**', roles: ['admin'] }, // admins
  { path: ['/account', '/account/**'], auth: true }, // anyone signed in
  { path: '/orders/**', verified: true }, // signed in, email address confirmed
  { path: '/moderate/**', roles: ['admin', 'moderator'], hide: true }, // 404 for everyone else
  { path: '/posts/*', methods: ['POST', 'PUT', 'DELETE'], auth: true }, // only for some methods
]
```

- **The first rule that covers a request decides.** Put the exceptions first. Requests no rule covers are allowed: if you would rather close everything, finish with `{ path: '/**', auth: true }`.
- `path` is a pattern or a list of them: `*` stands for one segment, `**` for any number of them (`/admin/**` is `/admin` and everything below). `methods` is optional.
- `public: true`: anyone.
- `auth: true`: users who are signed in.
- `roles: [...]`: users who have **any** of the roles.
- `verified: true`: users whose `verified` field is true.
- `hide: true`: answer with a 404 instead of a 401 or a 403, so that nobody learns that the page exists.

A page has one address, but a URL can still be written in more than one way: `/account` and `/account/`, and `/posts/5` and `/posts/5/` (PocketPages ignores a trailing slash). Rules are checked against the address in the URL **and** against the address of the page that serves it (`request.canonicalPath`, `/account` for both of the first pair), and the request goes through only if both are allowed. A rule for `/account` therefore holds for `/account/`, and a rule for `/posts/*` that only covers `DELETE` holds for `DELETE /posts/5/`.

Rules cover the pages and the static files in your `pages` folder (a PDF only members should download, say). They do not cover what PocketBase serves itself, its API and its admin UI: use PocketBase's own API rules for those.

### What visitors see

| The visitor is...                      | and the page is in a rule that wants... | Answer                                                         |
| -------------------------------------- | --------------------------------------- | -------------------------------------------------------------- |
| not signed in                          | anything                                | a redirect to the login page, `401` for clients that want JSON |
| signed in, without the role            | `roles`                                 | `403 Forbidden`                                                |
| signed in, email address not confirmed | `verified`                              | `403 Forbidden`                                                |
| anyone not allowed                     | `hide`                                  | `404 Not Found`                                                |

The redirect goes to `/login?next=%2Faccount%2Forders%3Fpage%3D2`: the page the visitor wanted. After signing in, send them back, **with `safeNext()`**:

```javascript
// pages/login/+post.js
const { safeNext } = require('pocketpages-plugin-rbac')

module.exports = ({ params, signInWithPassword, formData, redirect }) => {
  const { email, password } = formData()
  signInWithPassword(email, password)
  redirect(safeNext(params.next, '/account'))
}
```

`safeNext()` only lets through paths on your own site. Redirecting to whatever `?next=` holds would let anyone send your visitors to a phishing page with a link that starts with your domain.

Clients that ask for JSON (`Accept: application/json`) and requests for PocketBase's API are never redirected, they get the status code.

Instead of an error page, signed in users who are not allowed can be sent to a page of yours:

```javascript
{
  name: 'pocketpages-plugin-rbac',
  rules: [...],
  loginPath: '/auth/login',      // default '/login'; false to answer with a 401 instead
  nextParam: 'next',             // '' to leave the address of the page out
  loginMessage: 'Please sign in to continue', // flash message for the login page, needs the session plugin
  forbiddenPath: '/denied',      // instead of a 403
  unverifiedPath: '/verify-email', // instead of a 403, for users who have not confirmed
  roleField: 'role',             // where the roles are, 'role' unless told otherwise
}
```

## Roles

The roles of a user are in the field `roleField` (`role` unless told otherwise): a text, or a list for a `select` field that takes several values.

PocketBase's **superusers** have the role `superuser`, and count as verified. `roles: ['admin', 'superuser']` lets both through.

## In pages and loaders

`rbac` has what you need to show the right things, and to protect what rules can't tell:

```html
<% if (rbac.can('/admin')) { %>
<a href="/admin">Admin</a>
<% } %> <% if (rbac.hasRole('editor', 'admin')) { %>
<a href="/posts/new">New post</a>
<% } %>
```

```javascript
// pages/posts/[id]/+delete.js
module.exports = ({ rbac, params, auth }) => {
  rbac.requireRole('admin') // 401 for visitors, 403 for the others
  // ...
}
```

|                              |                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| `rbac.roles()`               | The roles of the user, `[]` for visitors                                                    |
| `rbac.hasRole(...roles)`     | Whether the user has at least one of them                                                   |
| `rbac.can(path, method?)`    | Whether the rules would let the user make a request to `path` (`GET` unless told otherwise) |
| `rbac.requireAuth()`         | Throws a 401 if nobody is signed in                                                         |
| `rbac.requireRole(...roles)` | Throws a 401 if nobody is signed in, a 403 if the user has none of the roles                |
| `rbac.loginUrl(next?)`       | The login address, with the page you are on (or `next`) as the page to come back to         |

`can()` only knows about the rules. A rule on a path decides who may open it, not which records they can read, and a check in the page for whatever is yours to protect (the posts of other users, say) stays your job. The best place for those rules is PocketBase's API rules, checked by reading the record through [`pb({ request })`](/docs/plugins/js-sdk#reading-and-writing-records-tied-to-a-visitor) instead of `$app`, which does not look at them at all.

## Memberships

Roles that depend on the group: _ana_ is an owner of Acme and a viewer of Bolt. The memberships are rows of a collection of your own (`user`, `org`, `role`), and the plugin only reads them.

```javascript
// pb_hooks/pages/+config.js
module.exports = {
  plugins: [
    'pocketpages-plugin-auth',
    {
      rbac: {
        memberships: {
          collection: 'memberships',
          user: 'user', // relation to your users, one value
          scopes: { org: 'org' }, // kind of group -> field that points to it
          role: 'role', // a select field (one or several values), or text
          roles: ['viewer', 'editor', 'admin', 'owner'], // lowest to highest, for atLeast
          status: { field: 'status', active: ['active'] }, // optional: only these rows count
          expires: 'expires', // optional: a date, rows that passed don't count
        },
        rules: [
          {
            path: '/orgs/[org]/billing/**',
            member: { scope: 'org', atLeast: 'owner' },
          },
          { path: '/orgs/[org]/**', member: { scope: 'org' } },
        ],
      },
    },
  ],
}
```

`[org]` is the id of the group in the address. Visitors are sent to sign in, signed in users who are not members get a 404 (`hide: false` for a 403), and members whose role is too low get a 403. `member` can't be combined with `roles`, `auth` or `public`, and `verified` works as in any rule. Rules are checked against the canonical path, so `/orgs/x/index` and `/orgs/x/billing/anything` are covered.

In pages and loaders:

|                                                        |                                                                                   |
| ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `rbac.member(scope, id?)`                              | The roles of the user in that group, `[]` if none (`id` is the one the rules saw) |
| `rbac.requireMember(scope, { id?, atLeast?, roles? })` | Throws a 401, a 404 for non-members or a 403 for a role too low                   |
| `rbac.scope`                                           | The groups the rules let the user into: `{ org: 'abc...' }`                       |
| `rbac.memberships()`                                   | All the groups of the user: `[{ scope, id, roles }]`, for a group switcher        |

Use `rbac.scope.org` to filter your queries: the rule decides who opens the page, the filter decides which records it shows.

**Security.**

- Ids that don't look like an id (`idPattern`, the 15 characters of PocketBase unless told otherwise) never reach the database, and every value goes to the query as a parameter. Names of collections and fields from the config are checked and quoted. Anything unexpected (a missing collection, a field of the wrong type) fails closed.
- Nothing is kept from one request to the next, so removing a membership is felt by the next request. Inside a request the answer is remembered per group. A lookup costs one indexed query, about 0.07 ms in our measurements with 100,000 rows.
- Superusers come into every group only with `superuser: true`.
- Give the collection a unique index on (`user`, group field), so a user can't have two rows for one group (the plugin warns if it is missing). The roles of a user are the union of their rows.
- The user relation has to point to the collection of the signed in users.
- Hierarchies (a role in the organization counting in its projects) are not inherited: give each level its own scope and rule.
- `guard()` knows nothing about memberships.

**API rules.** The plugin reads with `$app`, which ignores API rules, so the rules of the collection are only for the API. Start closed and open what you need: users read their own rows, nobody writes from the client.

```
listRule:   @request.auth.id != "" && user = @request.auth.id
viewRule:   @request.auth.id != "" && user = @request.auth.id
createRule: null
updateRule: null
deleteRule: null
```

Letting the owners of a group manage its members through the API is possible with rules on `@collection.memberships`, but make sure `user`, the group and `role` can't be set by someone who is not an owner of that group (otherwise anybody can make themselves one).

## What PocketBase already does

PocketBase does not know about the files in your `pages` folder: they are served by PocketPages, and that is what the rules above are for. For everything else it has its own tools, and you should use them:

- **Records.** The API rules of a collection decide who can list, read, create, change and delete its records through the API. They are ignored for superusers, and for whatever your pages and loaders do with `$app`, which is why the filters of your queries stay your job.
- **Routes you register with `routerAdd()`.** PocketBase's middlewares `$apis.requireAuth()`, `$apis.requireSuperuserAuth()` and `$apis.requireSuperuserOrOwnerAuth()` ask for a sign in. They know nothing about roles. For roles, a confirmed email address or a 404, this plugin has `guard()`, with the same words as the rules:

```javascript
// pb_hooks/reports.pb.js
routerAdd('GET', '/api/myapp/reports', (e) => {
  require('pocketpages-plugin-rbac').guard(e, { roles: ['admin'] })
  return e.json(200, { ok: true })
})
```

`guard(e, rule, roleField?)` takes `auth`, `roles`, `verified` and `hide` (see above) and throws a 401, a 403 or a 404. PocketBase handlers can't see the variables outside of them, so the rule goes in the call, and the plugin is `require`d inside the handler. Who is signed in is `e.auth`, which PocketBase fills from the `Authorization` header and from nothing else: the cookie of the auth plugin is for pages.

## About 401, 403 and 404

`requireAuth()` and `requireRole()` throw PocketBase errors, which PocketPages turns into responses (see the [plugin authoring guide](/docs/plugins/authoring)). Visitors are redirected to the login page, as the rules do.
