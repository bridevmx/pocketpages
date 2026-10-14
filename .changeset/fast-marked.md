---
'pocketpages-plugin-marked': minor
---

Rendered Markdown is kept (shared between all JS runtimes, new `cache` option, default on unless PocketBase runs with `--dev`), and a single Marked instance is reused instead of creating one per render.
