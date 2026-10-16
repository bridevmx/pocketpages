# PocketPages Session Plugin

Sessions and flash messages for PocketPages, kept in a cookie.

- **Nothing to set up**: no table, no store. The session lives in an encrypted, signed cookie, so it works the same across all of PocketBase's JS runtimes, and survives restarts.
- **Costs nothing when unused**: a request that never touches the session does no work for it and sets no cookie.
- **Flash messages** for what you want to say after a redirect.

It needs `pocketpages` 0.23 or newer.

## Installation

```bash
npm install pocketpages-plugin-session
```

## Setup

```javascript
// +config.js
module.exports = {
  plugins: ['pocketpages-plugin-ejs', 'pocketpages-plugin-session'],
}
```

## Usage

Pages, loaders and middlewares get `session`:

```javascript
// pages/cart/add/+post.js
module.exports = ({ session, formData, redirect }) => {
  const { productId } = formData()
  const cart = session.get('cart', [])
  cart.push(productId)
  session.set('cart', cart)
  session.flash('success', 'Added to your cart')
  redirect('/cart')
}
```

```html
<!-- pages/cart/index.ejs -->
<%% for (const message of session.flashes('success')) { %>
<p class="notice"><%%= message %></p>
<%% } %> You have <%%= session.get('cart', []).length %> items.
```

### Methods

|                                |                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------ |
| `session.get(key, fallback?)`  | The value of `key`, `fallback` if there is none                                      |
| `session.has(key)`             | Whether there is a value for `key`                                                   |
| `session.all()`                | A copy of everything                                                                 |
| `session.set(key, value)`      | Keeps `value`. `undefined` removes it. Returns the session, so calls can be chained. |
| `session.delete(key)`          | Removes `key`                                                                        |
| `session.clear()`              | Forgets everything and takes the cookie away: what to do on sign out                 |
| `session.flash(type, message)` | Leaves a message for the **next** request                                            |
| `session.flashes()`            | The messages the previous request left, by type: `{ success: ['Saved'], error: [] }` |
| `session.flashes(type)`        | Only those of one type, as an array                                                  |
| `session.hasFlashes()`         | Whether there are messages waiting                                                   |

Values have to survive `JSON.stringify()`: strings, numbers, booleans, arrays and plain objects. Anything else throws when you set it.

### Flash messages

A flash message is for the request after the one that leaves it, which is the page a redirect takes the browser to. It cannot be read by the request that leaves it, and **is gone once it has been read**: a redirect to a page that does not show messages does not lose them, the next page that reads them gets them.

The same message is not left twice: `session.flash('error', 'Sign in first')` on every redirect to a login page leaves one message, not one per redirect. The messages waiting are never more than `flashLimit` (20), counting the ones not yet read; when there would be more, the oldest go. And when the cookie would not fit in `maxBytes`, flash messages are dropped, the oldest first, before anything else is: only data that is too big by itself makes `session.set()` fail (see below).

### Sign in, sign out

The session is not a login. The [auth plugin](/docs/plugins/auth) keeps who is signed in. Use the session for the rest: a cart, the step of a wizard, a preference. Call `session.clear()` when someone signs out so none of it stays behind.

## Options

```javascript
module.exports = {
  plugins: [
    'pocketpages-plugin-ejs',
    {
      name: 'pocketpages-plugin-session',
      cookieName: 'pp_session', // where the browser keeps it
      maxAge: 604800, // seconds a session lasts: 7 days
      rolling: true, // keep it alive while it is used
      sameSite: 'lax', // 'lax', 'strict' or 'none'
      secure: 'auto', // true, false, or 'auto': when the request came in over HTTPS
      domain: 'example.com', // to share it with subdomains, leave out otherwise
      maxBytes: 3800, // the most the cookie can grow to
      flashLimit: 20, // the most messages waiting, read or not
      secret: '...', // see below
    },
  ],
}
```

**Rolling.** With `rolling: true` (the default) a session that is used stays alive: once half of its time is gone, the next request that touches it renews it. With `false` it ends `maxAge` seconds after it started, whatever happens.

## How safe is it?

The cookie is `HttpOnly` (scripts cannot read it), `SameSite=Lax`, `Secure` over HTTPS, encrypted (AES-256-GCM, what [`$security.encrypt()`](https://pocketbase.io/docs/js-overview/#security) does) and signed. The signature is checked before anything is decrypted, so what a browser makes up never reaches the decryption. Someone who has the cookie cannot read it nor change it, only keep sending it as it is until it ends.

The keys come from the secret of the app: the `POCKETPAGES_SECRET` environment variable if it is set, and the secret PocketBase signs the tokens of superusers with otherwise (see [`secret()` in the global API](/docs/global-api)). Either way sessions survive restarts. Rotating that secret ends every session. To give sessions a secret of their own, use the `secret` option (read it from the environment, `env('SESSION_SECRET')`, and keep it out of your repository).

**A cookie session cannot be revoked from the server.** If a cookie leaks, it works until it ends. That is a fair price for needing no storage, but it makes it a poor place for anything that must be undone from elsewhere (signing a user out of every device, say). Keep that in the database.

## Size

A cookie can be about 4 KB at the most. The session is encrypted and encoded, which makes it a third bigger. When what you keep would not fit in `maxBytes` (flash messages left over are dropped first to make room), the request fails with an error. Keep ids in the session and the data in the database.

## For plugin authors

The session is also available as `request.state.session` as soon as this plugin's `onRequest` has run, so the plugins listed after it can use it (the [RBAC plugin](/docs/plugins/rbac) leaves a flash message for the login page that way). List the session plugin before them.
