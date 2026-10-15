---
'pocketpages': minor
---

**Breaking:** every page has one address. `/account/index` (for `account/index.ejs`), anything after the address of a page (`/dashboard/anything`), a `[param]` with no value (`/posts` for `posts/[id].ejs`), empty segments (`//`) and backslashes in the path are no longer served by the page: they are a 404. A trailing slash is still ignored. This closes the aliases that rules written for a page's address did not cover and gives each page one URL for search engines and caches. See "One Address per Page" in the routing docs.
