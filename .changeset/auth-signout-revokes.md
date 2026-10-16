---
'pocketpages-plugin-auth': minor
---

**Security fix.** `signOut()` only cleared the cookie of the browser that called it: the token that was in it, or any copy of it, kept working (replay) until it expired on its own, because PocketBase's auth tokens need nothing from the server to be checked. Found running a real sign in/sign out/replay sequence against a lab app. `signOut()` now also rotates the signed in user's token key, so sign out invalidates that token everywhere, right away. Pass `{ everywhere: false }` to go back to only clearing this cookie.
