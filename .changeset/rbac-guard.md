---
'pocketpages-plugin-rbac': minor
---

`guard(e, rule)` for the routes you register with PocketBase's `routerAdd()`: the same `auth`, `roles`, `verified` and `hide` as the rules of your pages, answered with PocketBase's own 401, 403 and 404. PocketBase's middlewares (`$apis.requireAuth()`...) only know whether someone is signed in.
