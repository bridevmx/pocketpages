---
'pocketpages': patch
---

**Security fix.** `resolve()` and `include()` built the path to look for from `_private` and the path a page or module passed them, without checking that `..` in it could not walk out of `pages`. A path with enough `..` segments could read an arbitrary file on disk (found running real path-traversal attempts against a lab app, where it read a file outside `pages`). Both now refuse a path that would leave the `_private` tree they are looking in.
