---
'pocketpages': minor
---

Much faster request handling in the PocketBase JavaScript runtime (goja):

- Requests no route claims (PocketBase API calls, the admin UI, files) go straight back to PocketBase. This needs no plugin to have an `onRequest` hook, and the URL is only parsed when something asks for it.
- Routes are looked up in a tree instead of sorting and scanning all of them for every request, and `asset()` results are remembered.
- Plugin factories run once per JS runtime instead of once per request. Keep per-request state out of factory variables (see the plugin authoring guide).
- `onRequest` gets the `route` the request resolves to (`null` when there is none).
- Files read by `resolve()` in `raw`, `script` and `style` mode no longer go through `pocketbase-node`, which converted them one character at a time.
- New `cache` option in `+config.js` (default `true`, `false` with `--dev`): remembers `resolve()` lookups and the contents of the files it inlines.
- Static files requested through their fingerprinted URL are served with `Cache-Control: public, max-age=31536000, immutable`, as the asset management docs already described.
- Cheaper `dbg()` calls and JSON detection (query strings, cookies, page output), and layouts without slots skip the slot parser.
