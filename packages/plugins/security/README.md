# PocketPages Security Plugin

CSRF protection, rate limiting and security headers for PocketPages.

- **CSRF protection** for every form that changes something, with tokens that work for the user they were issued to and that look different every time they are printed.
- **Rate limiting** by path and method, shared by all of the JS runtimes PocketBase runs, plus an API to limit anything else (login attempts per email address, for instance).
- **Security headers** (`Referrer-Policy`, `Permissions-Policy`, HSTS...) and a **Content-Security-Policy** with a nonce for each request.

It needs `pocketpages` 0.23 or newer.

## Installation

```bash
npm install pocketpages-plugin-security
```

## Setup

```javascript
// +config.js
module.exports = {
  plugins: [
    'pocketpages-plugin-ejs',
    'pocketpages-plugin-auth', // if you use it, list it before the security plugin
    'pocketpages-plugin-security',
  ],
}
```

With no options, the security plugin sends the security headers described below and **requires a CSRF token on every `POST`, `PUT`, `PATCH` and `DELETE` to a page**, so put the token in your forms:

```html
<form method="post">
  <%- csrf.field() %>
  <input name="email" />
  <button>Send</button>
</form>
```

Pass options by writing the plugin as an object:

```javascript
module.exports = {
  plugins: [
    'pocketpages-plugin-ejs',
    {
      name: 'pocketpages-plugin-security',
      csrf: { ignore: ['/webhooks/**'] },
      rateLimit: {
        rules: [{ path: '/login', methods: ['POST'], limit: 5, window: 60 }],
      },
    },
  ],
}
```

Options are plain data, as they are for every plugin: no functions.

## CSRF protection

A request that changes something and was sent by another site on behalf of a signed in user is a forgery. Two checks keep those out:

1. **Where the request comes from.** Browsers say it in the `Sec-Fetch-Site` and `Origin` headers. A request that comes from another site is refused. Requests that say nothing, which is what tools other than browsers do, are left to the token.
2. **A token**, which only the pages of your site know. It is kept in the `pp_csrf` cookie, and every form sends it back.

A request that fails either check is answered with a `403 Forbidden` (see [errors](#errors)).

### In templates

```html
<%- csrf.field() %>
<!-- <input type="hidden" name="_csrf" value="..."> -->

<%- csrf.meta() %>
<!-- <meta name="csrf-token" content="..."> -->
```

For scripts, read the token from the meta tag and send it in the `X-CSRF-Token` header:

```html
<script>
  const token = document.querySelector('meta[name=csrf-token]').content
  fetch('/api/things', { method: 'POST', headers: { 'X-CSRF-Token': token } })
</script>
```

[htmx](/docs/htmx) can do the same for every request of a page:

```html
<body hx-headers="<%- csrf.hxHeaders() %>"></body>
```

`csrf.token()` returns the bare token. Within one request it is always the same string. Across requests it never is: the token is masked with a new random pad each time, so that a page that is compressed and echoes what an attacker sends cannot be used to guess it (the BREACH attack).

### Tokens belong to people

A token is bound to the user who was signed in when it was issued (or to no one, for visitors). A token an attacker obtained for their own account is useless for anyone else's. When someone signs in or out, the next page they get has a new token.

This is why the plugin checks tokens late, once the auth plugin has run. Whichever order you list them in, it knows who is signed in. (For rate limits that count requests `by: 'user'` the order does matter, see below.)

### Options

```javascript
{
  name: 'pocketpages-plugin-security',
  csrf: {
    cookieName: 'pp_csrf',      // where the browser keeps the token
    fieldName: '_csrf',         // the form field that carries it
    headerName: 'X-CSRF-Token', // the header that can carry it instead
    ignore: ['/webhooks/**'],   // pages that take requests from elsewhere on purpose
    trustedOrigins: ['https://app.example.com'], // sites whose pages may post to this one
    methods: ['POST', 'PUT', 'PATCH', 'DELETE'], // what is checked
  },
}
```

Use `csrf: false` to turn it off altogether.

**Behind a proxy** that does not pass the `Host` header on, set `X-Forwarded-Host` in the proxy, or list your public address in `trustedOrigins`.

**Method override.** Requests that a plugin turns into other methods (an HTML form can only send `GET` and `POST`) are checked with the method they end up as.

### Paths

Wherever an option takes paths, `*` stands for one segment and `**` for any number of them: `/blog/*` is `/blog/a-post`, `/blog/**` is `/blog` and everything below it.

## Rate limiting

Rules say how many requests a client can make to a path in a window of time:

```javascript
rateLimit: {
  rules: [
    // 5 login attempts per minute
    { path: '/login', methods: ['POST'], limit: 5, window: 60 },
    // 300 requests per minute to anything else
    { path: '/**', limit: 300, window: 60 },
  ],
}
```

- `path` is a pattern or a list of them, `methods` is optional (every method when left out).
- `limit` requests are allowed per `window` seconds.
- `by` is `'ip'` (the default) or `'user'`. The latter counts requests per signed in user, and per address for visitors. List the auth plugin before this one for it to know who is signed in.

A request is counted against every rule that matches it. When one of them says no, the client gets a `429 Too Many Requests` with a `Retry-After` header. Every answer to a request a rule applies to carries the state of the limit, as in the [IETF draft](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/): `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset`.

The windows slide: the requests of the previous window still count in proportion to how much of it is left, so a client cannot make a full allowance at the end of a window and another at the start of the next.

Rules also apply to requests PocketBase answers itself, so `{ path: '/api/collections/users/auth-with-password', ... }` protects PocketBase's own login.

**Addresses.** Clients are told apart by `request.ip`, which is what PocketBase works out: the address of the connection, or the one in the headers of the proxies you list as trusted in PocketBase's settings. Behind a reverse proxy, set that up, or every client has the address of the proxy.

**Counters live in the memory of PocketBase**, shared by all of its JS runtimes, and are lost when it restarts. Counters of windows that are over are swept away.

### Limiting anything

Pages, loaders and middlewares get `rateLimit`:

```javascript
// pages/login/+post.js
module.exports = ({ body, rateLimit }) => {
  const { email } = body()
  // At most 5 attempts per hour for each email address, throws a 429 beyond that
  rateLimit.enforce(`login:${email}`, { limit: 5, window: 3600 })
  // ...
}
```

`rateLimit.hit(key, { limit, window })` does the same without throwing and returns the decision: `{ allowed, limit, remaining, resetIn, retryAfter }`.

## Security headers

Sent with every page (not with static files, nor with PocketBase's own API):

| Header                                                       | Default                                          |
| ------------------------------------------------------------ | ------------------------------------------------ |
| `X-Content-Type-Options`                                     | `nosniff`                                        |
| `X-Frame-Options`                                            | `SAMEORIGIN`                                     |
| `Referrer-Policy`                                            | `strict-origin-when-cross-origin`                |
| `Permissions-Policy`                                         | `camera=(), microphone=(), geolocation=()`       |
| `Strict-Transport-Security`                                  | `max-age=15552000`, only for requests over HTTPS |
| `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy` | not sent                                         |

```javascript
headers: {
  frameOptions: 'DENY',            // or false to leave it out
  referrerPolicy: 'no-referrer',
  permissionsPolicy: 'camera=(self)',
  crossOriginOpenerPolicy: 'same-origin',
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }, // or false
}
```

`headers: false` sends none of them.

A request is over HTTPS when PocketBase terminates TLS itself or the proxy in front of it says so with `X-Forwarded-Proto: https`. HSTS is sticky: browsers keep to HTTPS for `maxAge` seconds, think twice before adding `includeSubDomains` or `preload`.

## Content Security Policy

There is none unless you describe one. A policy that is too strict breaks pages, so start with `reportOnly`:

```javascript
csp: {
  reportOnly: true,
  directives: {
    'default-src': ["'self'"],
    'script-src': ["'self'", '{nonce}'],
    'img-src': ["'self'", 'data:'],
    'object-src': ["'none'"],
    'upgrade-insecure-requests': true,
  },
}
```

`{nonce}` becomes `'nonce-...'` with a new random value for each request, which pages get as `csp.nonce`:

```html
<script nonce="<%= csp.nonce %>">
  console.log('allowed to run')
</script>
```

The nonce is made when a page first reads `csp.nonce`. Pages that never do have a policy with a nonce nobody got to see, and nothing in them is tied to the visitor: the [page cache](/docs/plugins/page-cache) can keep them. A page that reads the nonce is made for each visitor and is never kept.

## Errors

Requests are refused by throwing PocketBase errors, which PocketPages turns into responses with the same status: a `403` for CSRF failures, a `429` for rate limits. Visitors see a short message in production, and the reason in `debug` mode (`CSRF token missing`, `CSRF origin not allowed`...). Clients that ask for JSON, and requests that are not for a page, get JSON.

To show your own pages, handle the error in a plugin with the `onError` hook (see the [plugin authoring guide](/docs/plugins/authoring)).

## What pages get

|                                             |                                                                 |
| ------------------------------------------- | --------------------------------------------------------------- |
| `csrf.token()`                              | A token for a form or a script to send back                     |
| `csrf.field()`                              | A hidden `<input>` with it                                      |
| `csrf.meta()`                               | A `<meta name="csrf-token">` tag with it                        |
| `csrf.hxHeaders()`                          | The JSON for an `hx-headers` attribute                          |
| `csp.nonce`                                 | The nonce of the request, `''` when the policy has no `{nonce}` |
| `rateLimit.hit(key, { limit, window })`     | Counts a request, returns the decision                          |
| `rateLimit.enforce(key, { limit, window })` | The same, and throws a 429 beyond the limit                     |
