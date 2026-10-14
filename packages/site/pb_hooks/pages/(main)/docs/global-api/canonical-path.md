---
title: canonicalPath - The Address of a Page
description: The address of the page that serves a URL path, for plugins and middleware that decide who may go where.
---

# `canonicalPath` - The Address of a Page

- **Type**: `(pathname: string) => string`
- **Description**: The address of the page that serves a URL path. Paths no page serves are returned as they are.

A page answers at more than one address, so a rule written for one of them does not cover the others:

| File                      | Answers at                                          | `canonicalPath()`   |
| ------------------------- | --------------------------------------------------- | ------------------- |
| `pages/account/index.ejs` | `/account`, `/account/index`, `/account/index/more` | `/account`          |
| `pages/dashboard.ejs`     | `/dashboard`, `/dashboard/anything/at/all`          | `/dashboard`        |
| `pages/posts/[id].ejs`    | `/posts/5`, `/posts/5/more`                         | `/posts/5`          |
| `pages/files/report.pdf`  | `/files/report.pdf`, `/files/report.<hash>.pdf`     | `/files/report.pdf` |

```javascript
canonicalPath('/account/index') // '/account'
canonicalPath('/dashboard/anything') // '/dashboard'
canonicalPath('/api/health') // '/api/health', no page serves it
```

For the request being served, `request.canonicalPath` has it already. Check rules against both the path of the URL and this one, and let the request through only if both are allowed. The [RBAC plugin](/docs/plugins/rbac) does.
