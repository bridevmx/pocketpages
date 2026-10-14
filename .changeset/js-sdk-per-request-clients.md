---
'pocketpages-plugin-js-sdk': patch
---

Clear the cache of PocketBase clients at the start of every page request. Plugins now live as long as the JS runtime does, not a single request, and clients must not outlive the request they were created for.
