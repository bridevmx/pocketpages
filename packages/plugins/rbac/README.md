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

List it **after** the auth plugin, which is what finds out who is signed in:

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

`can()` only knows about the rules. A rule on a path decides who may open it, not which records they can read, and a check in the page for whatever is yours to protect (the posts of other users, say) stays your job. The best place for those rules is PocketBase's API rules, or the filters of your queries.

## About 401, 403 and 404

`requireAuth()` and `requireRole()` throw PocketBase errors, which PocketPages turns into responses (see the [plugin authoring guide](/docs/plugins/authoring)). Visitors are redirected to the login page, as the rules do.
