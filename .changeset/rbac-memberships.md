---
'pocketpages-plugin-rbac': minor
---

Memberships: roles per group (organization, team, project) read from a collection, with `member` rules (`{ scope: 'org', atLeast: 'admin' }`) for paths like `/orgs/[org]/**`, and `rbac.member()`, `rbac.requireMember()`, `rbac.scope` and `rbac.memberships()` for pages. Nothing is kept between requests, ids are validated and every value is a query parameter, and anything unexpected fails closed.
