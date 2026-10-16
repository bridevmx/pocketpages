---
'pocketpages': patch
---

**Fix**, found while verifying the path traversal fix: `resolve('../x')` ("level jumping", documented to skip the local `_private` directory and resolve from a parent level) never actually looked in a `_private` directory at that level. `_private/../x` is just `x` once the path is joined and cleaned, so it searched the parent folder itself, not its `_private`, and almost always failed. Leading `../` are now stripped and used to move up that many levels before searching `_private` from there, upward, as the rest of `resolve()` does.
