---
'pocketpages-plugin-security': minor
'pocketpages-plugin-session': minor
'pocketpages-plugin-forms': minor
'pocketpages-plugin-pagination': minor
'pocketpages-plugin-rbac': minor
'pocketpages-plugin-i18n': minor
'pocketpages-plugin-seo': minor
'pocketpages-plugin-page-cache': minor
---

New official plugins, all of them needing `pocketpages` 0.23:

- **security**: CSRF protection (masked, per-user tokens and a check of where requests come from), rate limiting shared by all JS runtimes, security headers and a Content-Security-Policy with a nonce for each request.
- **session**: encrypted, signed cookie sessions and flash messages. Nothing to set up, and no cost for requests that don't use them.
- **forms**: read forms exactly as they were sent (no more `01234` turned into `1234`), convert and validate them with a schema, show errors and old values, check file uploads, and send `PUT`, `PATCH` and `DELETE` from HTML forms.
- **pagination**: page numbers, links that keep the rest of the query string, and an accessible `<nav>`.
- **rbac**: protect pages by sign in, role and email verification from the config, with login redirects that come back to where the visitor was going.
- **i18n**: translations with variables and plurals (the rules of about 50 languages), the language in the address, `hreflang` links, and number and date formats, without `Intl`.
- **seo**: the `<head>` of a page (title, description, canonical, Open Graph, Twitter, JSON-LD, breadcrumbs), `sitemap.xml` from pages and collections, `robots.txt` and RSS feeds.
- **page-cache**: keep rendered pages in memory, shared by all JS runtimes, and serve them without running them. Only pages that are the same for everybody are kept; purge by tag, address or all at once.
