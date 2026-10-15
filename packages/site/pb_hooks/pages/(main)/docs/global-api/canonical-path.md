---
title: canonicalPath - The Address of a Page
description: The address of the page that serves a URL path, for plugins and middleware that decide who may go where.
---

# `canonicalPath` - The Address of a Page

- **Type**: `(pathname: string) => string`
- **Description**: The address of the page that serves a URL path. Paths no page serves are returned as they are.

Every page has one address (see [routing](/docs/routing)), but a URL can still be written with a trailing slash, and static files also answer to their fingerprinted name. `canonicalPath()` gives the one address, so a rule written for it holds for all of them:

| File                      | URL                                             | `canonicalPath()`   |
| ------------------------- | ----------------------------------------------- | ------------------- |
| `pages/account/index.ejs` | `/account`, `/account/`                         | `/account`          |
| `pages/posts/[id].ejs`    | `/posts/5`, `/posts/5/`                         | `/posts/5`          |
| `pages/files/report.pdf`  | `/files/report.pdf`, `/files/report.<hash>.pdf` | `/files/report.pdf` |

```javascript
canonicalPath('/account/') // '/account'
canonicalPath('/api/health') // '/api/health', no page serves it
canonicalPath('/account/index') // '/account/index', no page serves it
```

For the request being served, `request.canonicalPath` has it already. Check rules against both the path of the URL and this one, and let the request through only if both are allowed. The [RBAC plugin](/docs/plugins/rbac) does.
