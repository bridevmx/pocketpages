---
'pocketpages': minor
---

More for plugins to work with:

- `onRequest` can answer the request: return `true` after sending a response (`robots.txt`, a rate limit, a cached page) and nothing else runs for it. Errors thrown there are handled like the ones thrown by pages.
- New `onError` hook, called for every error raised while serving a request. Return `true` once you have sent a response; otherwise PocketPages answers. Errors raised with PocketBase's `NotFoundError`, `ForbiddenError`, `TooManyRequestsError`, `new ApiError(418, ...)` and friends now answer with their own status instead of a 500 (clients that ask for JSON, and requests that are not for a page, get JSON).
- New `onAfterRender` hook, called with the finished HTML of a page, after its layouts, so that plugins can inject into or rewrite it.
- `response.beforeSend(fn)` runs `fn` right before the response goes out, to set cookies and headers once the page has run. `response.text()`, `response.noContent()`, `response.addHeader()` and `response.sent()` are new.
- Cookies set during a request are all sent. A second `response.cookie()` used to replace the first one, whatever their names, so only one cookie could be set per response.
- `request.state` is a place for plugins to hand things to each other and to pages. Plugins can change `request.method`, and the loaders (`+post.js`, `+delete.js`...) are picked by it.
- `secret(purpose)`, `sign(value)` and `unsign(signed)` in the global API: keys derived from a secret that is stable across restarts (the `POCKETPAGES_SECRET` environment variable, or the signing secret of PocketBase's superusers).
- A middleware or loader that calls `redirect()` now ends the request, as the docs always said. The loaders after it and the page are not run, and what a template made after a redirect is not sent (it used to be appended to the redirect response).
- `response.status(code)` sets the status the page is sent with (`422` for a form that did not validate, for instance).
- `request.pathname`, `request.ip` and `request.secure` are new, and `pathMatcher()` in the global API turns patterns like `/admin/**` into a function that tests URL paths.
- `request.canonicalPath` and `canonicalPath()` in the global API give the address of the page that serves a request. A page answers at several addresses (`/account`, `/account/index`, `/account/index/anything`), so rules about who may go where have to hold for it as well as for the path of the URL.
- `request.header('Host')` returns the host of the request. Go keeps it out of the headers, so it used to be empty.
- `HEAD` requests run the loaders of `GET` (`+get.js`), as they are a `GET` without the body. They did not, which let whatever a `+get.js` guarded go by.
