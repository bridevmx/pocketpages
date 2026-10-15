# PocketPages Page Cache Plugin

Keeps rendered pages in memory and serves them again without running them.

- **A hit costs a lookup.** The page is not routed, loaded or rendered again: it comes out of memory, with an `ETag`, so browsers that have it are answered with a `304`.
- **Only pages that are the same for everybody are kept.** Requests that carry cookies are never served from the cache, nor added to it, and neither are responses that set one.
- **Shared by all of PocketBase's JS runtimes**, so the first visitor pays and the rest don't, whichever runtime they land on.
- **Purge what changed**, by tag, by address or all at once, from a page or from a PocketBase hook.

It needs `pocketpages` 0.23 or newer.

## Installation

```bash
npm install pocketpages-plugin-page-cache
```

## Setup

List it **last**. Plugins after it do not run for pages it answers, and you want the rest (language, rate limits, security headers, access control) to run for every request:

```javascript
// +config.js
module.exports = {
  plugins: [
    'pocketpages-plugin-ejs',
    'pocketpages-plugin-i18n',
    'pocketpages-plugin-security',
    'pocketpages-plugin-page-cache', // last
  ],
}
```

Out of the box it keeps every `GET` page for 60 seconds, for visitors who have no cookies. Say which pages, and for how long:

```javascript
{
  name: 'pocketpages-plugin-page-cache',
  ttl: 300,
  include: ['/', '/blog/**', '/docs/**'],
  exclude: ['/blog/drafts/**'],
}
```

Nothing is kept with `--dev`, where files change under the cache. Set `dev: true` to see it work while you develop.

## What is kept

A page is served from the cache, and added to it, when **all** of this is true:

- the request is a `GET` for a page, not a file, and its address, and the address of the page that serves it (`/blog` for `/blog/`), match `include` and not `exclude`. A `HEAD` request is answered from the cache when the page is there, but never adds one: it does not run what a `GET` runs for the body.
- the address does not carry a `__flash` message, the one PocketPages adds when it redirects with a message: it is for the visitor who was sent there
- the request has **no cookies** (except those you list in `ignoreCookies`), no `Authorization` header, and nobody is signed in
- the page is answered with `200`, as HTML, without having sent anything else (a redirect, `echo()`...)
- the page **sets no cookie**: a form with a CSRF token, or a page that changes the [session](/docs/plugins/session) or leaves a session flash message, does, and so is left out. This is checked when the response is about to go out, so a cookie that is set late is seen too.
- the page does not say `Cache-Control: private`, `no-store` or `no-cache`, and does not call `pageCache.skip()`
- it does not use `csp.nonce` of the [security plugin](/docs/plugins/security) (a nonce is different for every visitor)
- it is not larger than `maxBodyBytes` (256 KB)

Everything else is made as usual. The answer says what happened in the `X-Cache` header: `HIT`, `MISS` (made now, kept for the next) or `BYPASS` (made now, not kept).

### Why cookies matter so much

A cookie may be about the visitor: who is signed in, what is in a cart, which language, a flash message waiting to be shown. A page made for them is not the page for the next visitor. So with a cookie, there is no cache, which keeps private pages from ever reaching other people.

Cookies that mean nothing to the page, such as analytics, are the ones to list so that those visitors get the cached page too:

```javascript
ignoreCookies: ['_ga*', '_gid', 'consent'] // a trailing * is a wildcard
```

Only list cookies the pages do not depend on. If the page does depend on it, even a little, leave it out.

### The query string

By default `/blog?page=2` and `/blog?page=3` are different pages, and so is every other query string. Visitors can make up as many as they want, and the cache keeps the most recent ones (`maxEntries`), so pages with a lot of variety can push the useful ones out. Say what matters:

```javascript
query: ['page', 'q'] // the page depends on these parameters only: the others (utm_source...) are ignored
query: 'none' // the page does not depend on the query string
```

With a list or `'none'`, the page is made from the parameters in the list and from nothing else: the others are taken out of `request.url.query` (and so out of `params`) before the page runs, so a parameter that is not in the key can never change a page that is kept for it. A page that reads the query string some other way (`event.requestInfo()`, say) gets all of it, and should not be cached with a list. Names and values are read the way pages read them, decoded: `?%70age=7` is `?page=7`, and a name that comes twice has the value of the first.

Addresses over 512 characters are never kept.

### Variants

If a page depends on a request header, say so, and each value gets its own copy:

```javascript
vary: ['Accept-Language']
```

Pages also vary by `Host`, so one app can serve several domains, and by the address as it was asked for: `/a%2Fb` and `/a/b` are two pages.

## Purging

Pages go out of date after `ttl` seconds. For anything that changes sooner, say what a page depends on and purge it when that changes.

### Tag pages, purge tags

```javascript
// pages/blog/index.ejs, or its +load.js
module.exports = ({ pageCache }) => {
  pageCache.tag('posts') // before reading them
  return {
    posts: $app.findRecordsByFilter(
      'posts',
      'published = true',
      '-created',
      10
    ),
  }
}
```

```javascript
// pb_hooks/cache.pb.js
onRecordAfterUpdateSuccess((e) => {
  require('pocketpages-plugin-page-cache').purge('posts')
  e.next()
}, 'posts')
onRecordAfterCreateSuccess((e) => {
  require('pocketpages-plugin-page-cache').purge('posts')
  e.next()
}, 'posts')
onRecordAfterDeleteSuccess((e) => {
  require('pocketpages-plugin-page-cache').purge('posts')
  e.next()
}, 'posts')
```

Pages that depend on `posts` are made again by the next request. A page can depend on several tags (`pageCache.tag('posts', 'post:' + id)`), and a tag is a name of up to 64 letters, digits, `:`, `_`, `.` and `-`. **Call `tag()` before reading the data**: a page made while its data changes is then known to be out of date.

Purging costs next to nothing, whatever the number of pages: nothing is scanned or removed, tagged pages just know that they are old.

### Purge by address, or everything

```javascript
const { purgePath, purgeAll } = require('pocketpages-plugin-page-cache')

purgePath('/blog') // /blog, /blog/a, /blog?page=2... but not /blogger
purgeAll() // every page
```

The same functions are in pages and loaders as `pageCache.purge(tag)`, `pageCache.purgePath(prefix)` and `pageCache.purgeAll()`.

## Browsers, proxies and CDNs

Copies are sent with `Cache-Control: public, max-age=0, s-maxage=60`: shared caches (a CDN in front of PocketBase) keep the page for `ttl` seconds, browsers ask every time and get a `304` from the cache. Raise `browserMaxAge` to let browsers keep pages for a while without asking. If the page sets its own `Cache-Control`, it is left alone.

Responses carry `Vary: Cookie`, so proxies don't mix up the cookie-less page with the others.

`Content-Language`, `Link` and `X-Robots-Tag` are sent again with the copies (change the list with `headers`). Other plugins that run before this one set their headers for every request, hits included.

## Options

```javascript
{
  name: 'pocketpages-plugin-page-cache',
  ttl: 60,                  // seconds a page is kept
  browserMaxAge: 0,         // seconds browsers keep it without asking
  include: ['/**'],         // which pages
  exclude: [],              // which not
  ignoreCookies: [],        // cookies that don't stop a page from being kept
  query: 'all',             // 'all', 'none' or a list of parameters
  vary: [],                 // request headers that make different pages
  headers: ['Content-Language', 'Link', 'X-Robots-Tag'],
  maxEntries: 300,          // the most pages kept; the oldest go first
  maxBodyBytes: 262144,     // the largest page kept
  header: true,             // X-Cache: HIT / MISS / BYPASS
  dev: false,               // keep pages with --dev as well
}
```

Pages live in the memory of PocketBase and go when it restarts. 300 pages of 50 KB are about 15 MB.

`maxEntries` is kept in check also under a flood of different addresses (a crawler adding `?q=1`, `?q=2`...): after every few saves the store drops the pages that are out of date and, if there are too many, the oldest ones. The count can go over `maxEntries` by a few tens of pages at the most, for a moment. Use `query` to keep the visitors from making up pages in the first place.

## Pages that must not be kept

Anything you want to keep out of the cache, call `pageCache.skip()`:

```javascript
module.exports = ({ pageCache }) => {
  pageCache.skip()
  // ...
}
```

Pages that use the CSRF token or the session set a cookie and are left out by themselves, and pages that read `csp.nonce` too. Pages that show something about the visitor without a cookie, from the IP address or the time of day, say, are not: use `skip()` or `exclude`.
