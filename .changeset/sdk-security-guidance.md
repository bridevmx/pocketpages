---
'pocketpages-plugin-js-sdk': minor
---

README: a security section on reading and writing records tied to a visitor. `$app.findRecordById()` and the rest of the raw JSVM API ignore a collection's API rules entirely, so a page that reads a record by id this way shows it to anyone signed in, not only its owner, unless the filter is written by hand. Reading it through `pb({ request })` instead checks the collection's own rule, at a measured cost of about 1.3 ms more than the raw call. `rbac`'s README now points here for what its rules do not cover.
