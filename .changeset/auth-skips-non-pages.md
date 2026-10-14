---
'pocketpages-plugin-auth': patch
---

Do not validate the auth cookie for static files and requests PocketPages does not render (PocketBase API, admin UI). Needs a version of `pocketpages` that passes `route` to `onRequest`, and works as before without.
