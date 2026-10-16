---
title: Plugins
description: Extend PocketPages with custom functionality using its powerful plugin architecture.
---

# Plugins

PocketPages has a highly **flexible plugin architecture** that allows you to extend the framework far beyond templating. Plugins can interact with various stages of your application, from request and response handling to rendering and extending the API context.

## Official Plugins

PocketPages comes with several official plugins.

**Rendering and data**

- [**EJS**](/docs/plugins/ejs): Template processing with enhanced features
- [**JS SDK**](/docs/plugins/js-sdk): PocketBase JavaScript SDK integration
- [**Micro Dash**](/docs/plugins/micro-dash): Lightweight utility functions for data manipulation
- [**Realtime**](/docs/plugins/realtime): Server-Sent Events (SSE) support
- [**Datastar**](/docs/plugins/datastar): Reactive UI integration

**Users**

- [**Authentication**](/docs/plugins/auth): Complete auth system with multiple methods
- [**RBAC**](/docs/plugins/rbac): Protect pages by sign in, role and email verification
- [**Session**](/docs/plugins/session): Cookie sessions and flash messages
- [**Security**](/docs/plugins/security): CSRF protection, rate limiting, security headers and CSP

**Forms and content**

- [**Forms**](/docs/plugins/forms): Parse and validate forms and file uploads, `PUT`/`DELETE` from HTML forms
- [**Pagination**](/docs/plugins/pagination): Page numbers, links and a nav bar
- [**i18n**](/docs/plugins/i18n): Translations, plural forms and language in the address
- [**SEO**](/docs/plugins/seo): Meta tags, Open Graph, JSON-LD, `sitemap.xml`, `robots.txt` and RSS

**Speed**

- [**Page Cache**](/docs/plugins/page-cache): Keep rendered pages in memory

## What Can Plugins Do?

- **Extend Request and Response:**  
  Use hooks such as `onRequest` and `onResponse` to modify request processing and response delivery. `onRequest` can answer a request itself (a cached page, `robots.txt`, a rate limit).
- **Customize Rendering:**  
  Intercept and modify output with the `onRender` hook, and with `onAfterRender` once the layouts are applied.
- **Extend the API:**  
  Add custom functions or even integrate entire sub-applications via `onExtendContextApi`.
- **Handle Errors:**  
  Show your own pages for errors with `onError`.

## Plugin Processing Order

Plugins are processed in the order they appear in your `plugins` array. This is particularly important when plugins modify content, as each plugin's output becomes the input for the next plugin.

For example, a plugin that post-processes the HTML rendered by the EJS plugin has to come after it:

```javascript
module.exports = {
  plugins: [
    // First: Process EJS templates
    'pocketpages-plugin-ejs',
    // Second: Receives the HTML the EJS plugin rendered
    'my-html-post-processor',
  ],
}
```

This sequential processing allows you to:

- Chain transformations
- Extend functionality incrementally
- Control how content is processed

Consider the processing order when configuring plugins that work together or modify the same types of content.

## A Good Order

When you use several of the official plugins together, this order works. A plugin that depends on what another found out goes after it, and the page cache goes last so that every request still goes through the others:

```javascript
module.exports = {
  plugins: [
    'pocketpages-plugin-ejs',
    'pocketpages-plugin-js-sdk', // the auth plugin needs it
    'pocketpages-plugin-auth', // finds out who is signed in
    'pocketpages-plugin-session', // before the plugins that leave flash messages
    { name: 'pocketpages-plugin-i18n', locales: ['en', 'es'] }, // takes /es off the address
    'pocketpages-plugin-forms', // reads _method for PUT and DELETE
    'pocketpages-plugin-pagination',
    'pocketpages-plugin-security', // rate limits, CSRF, headers
    {
      name: 'pocketpages-plugin-rbac',
      rules: [{ path: '/admin/**', roles: ['admin'] }],
    },
    'pocketpages-plugin-seo', // head tags, sitemap.xml, robots.txt
    'pocketpages-plugin-page-cache', // last
  ],
}
```

Their READMEs say which ones they need to come after.
