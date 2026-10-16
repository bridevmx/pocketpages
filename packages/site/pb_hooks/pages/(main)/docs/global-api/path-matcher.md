---
title: pathMatcher - Match URL Paths
description: Turn patterns like /admin/** into a function that tells whether a URL path matches, for plugins and middleware.
---

# `pathMatcher` - Match URL Paths

- **Type**: `(patterns: string | string[]) => (pathname: string) => boolean`
- **Description**: Makes a function that tells whether a URL path matches any of the patterns. Make it once, when your plugin is set up, and call it for every request.

## Patterns

- `*` stands for anything in **one** segment: `/blog/*` is `/blog/a-post`, not `/blog` and not `/blog/2024/a-post`
- `**` stands for any number of segments, none included: `/admin/**` is `/admin`, `/admin/` and everything below
- anything else has to match as it is written, case included
- a trailing `/` on the path doesn't matter

```javascript
const isAdmin = pathMatcher('/admin/**')
isAdmin('/admin') // true
isAdmin('/admin/users/1') // true
isAdmin('/administrator') // false

const isPublic = pathMatcher(['/', '/blog/*', '/docs/**'])
isPublic('/blog/hello') // true
isPublic('/blog') // false
```

Only the path is matched: take the query string off first (`request.pathname` is the path of the request).

The official plugins use it for their `include`, `exclude`, `ignore` and `rules` options.
