---
'pocketpages-plugin-ejs': minor
---

Templates are compiled once and kept (new `cache` option, default on unless PocketBase runs with `--dev`), files are read without going through `pocketbase-node` (which converted them one character at a time), and `include()` lookups are remembered. Output is collected in an array instead of with `__output +=`, which copies the whole string every time in goja, so rendering time grows with the square of the page size.
