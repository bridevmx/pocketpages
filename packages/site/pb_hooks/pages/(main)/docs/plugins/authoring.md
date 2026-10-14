# Plugin Authoring Guide

PocketPages plugins are powerful tools that can extend and modify the behavior of your application. This guide will help you understand how to create plugins and use the various hooks available.

## Plugin Structure

A plugin is a factory function that takes configuration options and returns an object with hook methods. Here's the basic structure:

```javascript
module.exports = (config, options) => {
  // Initialize plugin with config and options
  return {
    name: 'my-plugin',
    // Hook methods, all of them optional
    onRequest(context) {
      /* ... */
    },
    onRender(context) {
      /* ... */
    },
    handles(context) {
      /* ... */
    },
    onExtendContextApi(context) {
      /* ... */
    },
    onAfterRender(context) {
      /* ... */
    },
    onResponse(context) {
      /* ... */
    },
    onError(context) {
      /* ... */
    },
  }
}
```

### Plugin Lifecycle

PocketBase runs request handlers in a pool of JavaScript runtimes. A plugin factory runs **once per runtime** (the first time the runtime serves a request), not once per request, and the plugin it returns is used for every request that runtime handles after that. A runtime only handles one request at a time.

This makes it cheap to set things up in the factory, but anything the factory keeps in a variable lives across requests. Do not keep per-request state there, or reset it in a hook that runs for every request (`onRequest`, or `onExtendContextApi` for requests that PocketPages renders).

### Configuration Parameters

The plugin factory receives two parameters:

1. `config: PluginFactoryConfig` - Core configuration object containing:

   - `pagesRoot` - Root directory of pages
   - `config` - Global PocketPages configuration
   - `globalApi` - Global context API
   - `routes` - Array of route definitions
   - `dbg` - Debug logging function

2. `options: PluginOptionsBase` - Plugin-specific options including:
   - `debug` - Enable debug mode
   - Any custom options defined by your plugin

## How a Request Is Served

1. **`onRequest`** of every plugin, in order. Any of them can answer the request and stop here.
2. If a route matches the URL (a page, or a file in `pages`), PocketPages builds the context API, then calls **`onExtendContextApi`** of every plugin.
3. Middleware (`+middleware.js`) and loaders (`+load.js`, `+get.js`, `+post.js`...) run. One that redirects ends the request.
4. **`onRender`** of every plugin turns the page into HTML. Layouts are rendered the same way, innermost first.
5. **`onAfterRender`** of every plugin gets the finished HTML.
6. **`onResponse`** sends it.
7. Anything thrown along the way goes to **`onError`**. If no plugin sends a response, PocketPages does.
8. Requests no route matches, and those no plugin answered, go on to PocketBase.

Plugins are called in the order they are listed in `+config.js`, at every step.

## Available Hooks

Plugins can implement any of these hooks to modify application behavior:

### `onRequest(context: RequestContext): void | boolean`

Called at the start of each request, before any processing begins.

```javascript
onRequest({ request, response, route }) {
  // Add headers, check auth, rewrite the URL...
}
```

`route` is the route the address **as it came in** is going to be served by, `null` if it matches none (so it is not for PocketPages to serve, as with PocketBase API requests), and `undefined` with versions of PocketPages that do not say. Check it if the work you do is only useful for pages, and return early otherwise: `route.isStatic` tells files that are served as they are from pages. Remember that a plugin ahead of yours may have changed the address: `route` follows `request.url` as it is after each plugin.

Requests that no route matches go straight back to PocketBase, without creating the `request` and `response` objects, when no plugin has an `onRequest` hook. Every plugin that has one makes PocketPages do that work for all requests, so keep it cheap: look at `route` and `request.method` first, and leave anything that asks PocketBase for something (headers, the URL, cookies...) for after.

**Return `true` to answer the request yourself.** Nothing else runs for it, not the plugins after yours, not the page, not PocketBase. Send a response first:

```javascript
onRequest({ request, response }) {
  if (request.pathname === '/robots.txt') {
    response.text(200, 'User-agent: *\nAllow: /')
    return true
  }
}
```

A plugin that changes `request.url` here sends the request to the route of the new URL, and the plugins after it see that route. This is how the i18n plugin takes `/es` off the address.

**Throw to refuse.** PocketBase's error classes (`NotFoundError`, `ForbiddenError`, `UnauthorizedError`, `TooManyRequestsError`, `BadRequestError`, `new ApiError(status, message)`) are answered with their status, and go through `onError` hooks first:

```javascript
onRequest({ request }) {
  if (tooManyRequests(request.ip)) throw new TooManyRequestsError('Slow down')
}
```

### `onRender(context: RenderContext): string`

Transform content during the rendering process.

```javascript
onRender({ api, content, filePath, plugins }) {
  // Transform content
  // Process templates
  // Add features
  return modifiedContent;
}
```

### `handles(context: HandlesContext): boolean`

Determine if this plugin should handle a specific file.

```javascript
handles({ route, filePath }) {
  return filePath.endsWith('.md'); // Handle markdown files
}
```

### `onExtendContextApi(context: ExtendContextApiContext)`

Add methods to the context API available to pages. Called for requests PocketPages renders, after every plugin's `onRequest`, so what other plugins found out about the request is there (the signed in user, for instance).

```javascript
onExtendContextApi({ api }) {
  api.myHelper = () => {
    // Add custom functionality
  };
}
```

The context API is copied for every middleware and loader. Give your helpers a single object (`api.forms`) rather than a handful of functions, and make that object cheap to build: the work belongs in the methods, done when a page calls them.

### `onAfterRender(context: AfterRenderContext): string | void`

Called with the HTML of a page once its layouts are applied, right before it is sent. Return the HTML to send instead, or nothing to leave it as it is. Only called for pages that are sent as HTML (not for JSON, nor for pages that redirected).

```javascript
onAfterRender({ api, content }) {
  return content.replace('</body>', '<script src="/analytics.js"></script></body>')
}
```

### `onResponse(context: ResponseContext): boolean`

Final processing before sending the response.

```javascript
onResponse({ api, content }) {
  // Modify final output
  // Add headers
  // Handle caching
  return false; // Continue processing
}
```

### `onError(context: ErrorContext): void | boolean`

Called when something goes wrong while a request is being served: in a plugin, a middleware, a loader, a template. `context` has the `error`, its `status` (the one of PocketBase's error classes, `500` for anything else), the `request`, the `response`, the `route` (`null` if there is none) and, if the error happened while a page was being served, the `api`.

Return `true` when you have sent a response. Otherwise the next plugin gets to try, and then PocketPages answers: the status text (`Forbidden`, `Not Found`...) in production, the message and the stack with `debug: true`, as JSON for clients that ask for it and for requests that are not for pages.

```javascript
onError({ status, response, request }) {
  if (status === 404 && !request.header('Accept').includes('json')) {
    response.html(404, '<h1>Nothing here</h1>')
    return true
  }
}
```

Errors of the PocketBase JS SDK (`ClientResponseError`) and anything else that is not one of PocketBase's error classes are internal errors, whatever their `status` says.

## The Request and the Response

Plugins and pages share one `request` and one `response`:

- `request.state` is an object for plugins to leave things in, for each other and for the pages. Use the name of your plugin as the key (`request.state.session`). It starts empty for every request.
- `request.method` can be changed. Loaders (`+post.js`, `+delete.js`...) are picked by it, so a plugin can turn the `POST` of an HTML form into a `DELETE`.
- `request.pathname` is the path of the URL, much cheaper than `request.url.pathname`, which has the whole URL parsed. `request.ip` and `request.secure` tell where it comes from and whether it came over HTTPS.
- `request.canonicalPath` is the address of the page that serves the request. A page answers at more than one address (`/account` and `/account/index`), so a plugin that decides who may go where checks both `pathname` and `canonicalPath`.
- A plugin that checks the request has to see the one that gets served. Plugins that change the address (`i18n`) or the method (`forms`) go before it in the list; a check that must hold whatever the order can also be made in `onExtendContextApi`, which runs after every `onRequest`. Static files never get there.
- `response.beforeSend(callback)` runs `callback` right before the response goes out. This is where cookies and headers are set for things that change while the page runs (a session, a CSRF token). Callbacks run once each, in order, also for requests that go on to PocketBase.
- `response.cookie()` can be called more than once per response: all cookies are sent, and a cookie with a name that was set earlier replaces it. `response.addHeader()` adds a header without replacing the ones before it (`Vary`, `Link`).
- `response.status(code)` sets the status the page will be sent with (a form that did not validate is a `422`).
- `response.text()` and `response.noContent()` send plain text (or the type you set) and an empty response (`304`).
- `response.sent()` tells whether something was written already.

See [request](/docs/context-api/request) and [response](/docs/context-api/response) for all of it.

## Helpers for Plugins

The [global API](/docs/global-api) has what plugins need so that each of them doesn't make its own:

- `secret(purpose)`, `sign(value)` and `unsign(signed)`: keys and signatures that belong to the app and survive restarts. See [secret](/docs/global-api/secret).
- `pathMatcher(patterns)`: a function that tells whether an address matches patterns like `/admin/**`. See [pathMatcher](/docs/global-api/path-matcher).
- `canonicalPath(pathname)`: the address of the page that serves a path. See [canonicalPath](/docs/global-api/canonical-path).

## Best Practices

1. **Early Returns**: Use early returns for cleaner code flow

   ```javascript
   handles({ filePath }) {
     if (!filePath.endsWith('.md')) return false;
     return true;
   }
   ```

2. **Factory Pattern**: Return an API object instead of using classes

   ```javascript
   module.exports = (config, options) => {
     const api = {
       onRender: () => {
         /* ... */
       },
       // other methods
     }
     return api
   }
   ```

3. **Debug Logging**: Use the provided debug function

   ```javascript
   module.exports = ({ dbg }, options) => {
     dbg('Initializing plugin', { options })
     // ...
   }
   ```

4. **Options Are Data**: The configuration passes through PocketBase's store on its way to the plugin, so options can be strings, numbers, booleans, arrays and objects. Functions work in the config only for plugins that are themselves written in it (and they run in whichever runtime asks). Take patterns as text (`'/admin/**'`) and make the function in the factory.

5. **Check Your Options**: Throw from the factory for options you don't know, so that a typo is an error and not a feature that quietly does nothing.

6. **Cookies**: `request.cookies()` reads values that look like JSON as JSON. Start the values of your cookies with a letter and a dot (`v1.`) so they are always text. Sign what you can't trust to the browser with `sign()`, and check it before you do anything with it.

7. **Say What You Need**: A plugin that depends on another (RBAC needs to know who is signed in, so it needs the auth plugin first) should say so in its README, and in its error messages if it can tell.

## Example Plugins

### Content Transformer

```javascript
module.exports = (config, options) => {
  return {
    handles: ({ filePath }) => filePath.endsWith('.custom'),
    onRender: ({ content }) => {
      return content.toUpperCase() // Transform to uppercase
    },
  }
}
```

### API Extension

```javascript
module.exports = (config, options) => {
  return {
    onExtendContextApi: ({ api }) => {
      api.formatDate = (date) => {
        return new Date(date).toLocaleDateString()
      }
    },
  }
}
```

## Extending Global API

Plugins can extend the global API during initialization by modifying the `globalApi` object in the factory config. This makes functionality available across all pages and other plugins.

The global API includes core utilities like:

- `url()` - URL parsing
- `stringify()` - JSON stringification
- `env()` - Environment variable access
- `store()` - Global state management
- Logging functions (`dbg`, `info`, `warn`, `error`)

### Example: Adding Global Functions

Here's how the JS SDK plugin extends the global API with a PocketBase client:

```javascript
const jsSdkPluginFactory = (config, extra) => {
  const { globalApi } = config
  const host = extra?.host ?? `http://localhost:8090`

  // Store PocketBase instance
  let pb = null

  // Add pb() to the global API
  globalApi.pb = () => {
    if (pb) return pb
    pb = new PocketBase(host)
    return pb
  }

  return {}
}
```

This makes `pb()` available everywhere through the global API:

```javascript
// In any page or plugin
const pb = pb()
const records = pb.collection('posts').getList()
```

### Best Practices for Global API Extensions

1. **Lazy Initialization**: Initialize expensive resources only when first requested

   ```javascript
   let instance = null
   globalApi.myApi = () => {
     if (instance) return instance
     instance = new ExpensiveResource()
     return instance
   }
   ```

2. **Namespacing**: Use clear naming to avoid conflicts

   ```javascript
   globalApi.myPlugin = {
     helper1: () => {
       /* ... */
     },
     helper2: () => {
       /* ... */
     },
   }
   ```

3. **Type Safety**: Define types for your extensions

   ```typescript
   declare module 'pocketpages' {
     interface PagesGlobalContext {
       myApi: () => MyApiType
     }
   }
   ```

4. **Documentation**: Document the API you're exposing
   ```javascript
   /**
    * Returns configured API client
    * @param {object} options - Optional configuration
    * @returns {ApiClient} Configured client instance
    */
   globalApi.myApi = (options) => {
     // Implementation
   }
   ```
