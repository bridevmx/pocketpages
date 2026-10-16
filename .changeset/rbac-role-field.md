---
'pocketpages-plugin-rbac': minor
---

Warns (in PocketBase's log, once) when the API rules of the `users` collection let people set their own role: with PocketBase's default rules anybody can register as `admin`, or promote themselves with a `PATCH`, and the rules of this plugin would let them in. The README says how to close the field, with rules checked against PocketBase 0.25.9 and 0.40.5. The warning about a missing unique index of the memberships collection is written to the log too, not only in debug mode.
