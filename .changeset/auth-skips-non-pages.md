---
'pocketpages-plugin-auth': patch
---

Do not validate the auth cookie for the requests PocketBase answers itself: its API (`/api/...`) and its admin UI (`/_/...`). Everything else is looked at as before, including static files and addresses a plugin may still rewrite into a page.
