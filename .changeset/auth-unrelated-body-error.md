---
'pocketpages-plugin-auth': patch
---

**Security fix.** A request whose body PocketBase could not read for an unrelated reason (a `Content-Type` it does not parse, like `text/plain`) made the auth plugin sign the visitor out: it treated any error while enriching the auth record (which reads the request too) the same as "this token is invalid", and cleared the session cookie. Found running a real cross-site-style request with a plain `text/plain` body against a lab app: it also quietly defeated the CSRF check downstream, since a cleared cookie cannot carry a token to compare against. Only a token that `findAuthRecordByToken` itself rejects clears the cookie now; a failure while enriching the record no longer does.
