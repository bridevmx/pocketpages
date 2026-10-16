---
'pocketpages-plugin-ejs': patch
---

**Security fix.** `include()`'s own path confinement (separate from `resolve()`'s, fixed in `pocketpages` itself) compared paths as plain text: `candidate.startsWith(pagesRoot)` treats a sibling directory like `pages-backup` as being inside `pages`, because "pages" is a text prefix of its name, though it is not under it at all. Confirmed in a browser against a real PocketBase: `include('../../pages-backup/x')` served a file outside `pages`. The same loose check also let an include path that looks absolute (`/etc/passwd`, a Windows drive, a UNC path) replace `pagesRoot` outright once resolved, instead of staying under it. Both now check real containment, the same way `resolve()` does.
