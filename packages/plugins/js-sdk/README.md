# JS SDK Plugin

The JS SDK plugin (`pocketpages-plugin-js-sdk`) provides a JSVM-compatible version of the PocketBase JavaScript SDK, making it easy to interact with your PocketBase collections and authentication system.

## Installation

```bash
npm install pocketpages-plugin-js-sdk
```

## Configuration

Add the plugin to your `+config.js` file:

```javascript
module.exports = {
  plugins: [
    'pocketpages-plugin-js-sdk',
    // ... other plugins
  ],
}
```

### Options

- **`host`**: PocketBase server URL (default: `'http://localhost:8090'`)
- **`debug`**: Enable debug output for the plugin (default: `false`)

## Usage

The plugin adds a `pb()` function to the global context that returns a configured PocketBase client. The client is cached based on the host and authentication context.

```typescript
type PocketBaseClientOptions = {
  auth?: core.Record    // Auth record to use
  host?: string        // PocketBase host URL
  request?: Request    // Current request context
}

// Get a PocketBase client
const client = pb(options?: PocketBaseClientOptions)
```

### Authentication Handling

To get a client with the current request's authentication context:

```ejs
<%%
  // Get an authenticated client for the current request
  const client = pb({ request })

  // Use any PocketBase SDK method with the authenticated context
  const records = client.collection('posts').getFullList({
    sort: '-created',
    expand: 'author',
  })
%>
```

To get an unauthenticated client:

```ejs
<%%
  // Get an anonymous client
  const client = pb()
%>
```

### Client Caching

The plugin caches PocketBase clients based on:

- The host URL
- The authentication context (user ID)

This means:

- Multiple calls with the same auth context reuse the same client
- Different users get different client instances
- Anonymous requests share a common unauthenticated client

### Example: Working with Collections

```ejs
<%%
  const client = pb({ request })

  // Create a record
  const post = client.collection('posts').create({
    title: 'Hello World',
    content: 'My first post',
  })

  // Query with filters
  const published = client.collection('posts').getFullList({
    filter: 'status = "published"',
    sort: '-created',
  })
%>
```

### Example: Authentication

```ejs
<%%
  const client = pb({ request })

  try {
    // Attempt to authenticate
    const user = client.collection('users').authWithPassword(
      'user@example.com',
      'password123'
    )

    // Get the authenticated user's data
    const userData = client.authStore.model
  } catch (e) {
    // Handle authentication errors
  }
%>
```

## Benefits Over Raw JSVM API

While using the raw JSVM API might be slightly more efficient, the PocketBase REST API (via the SDK) offers several advantages:

- Well-documented and widely used API surface
- Consistent API between frontend and backend code
- Access to high-level features not easily available in raw JSVM
- Familiar JavaScript patterns and nomenclature
- Rich ecosystem of examples and community support

## Reading and writing records tied to a visitor

`$app.findRecordById()`, `$app.findFirstRecordByFilter()` and the rest of the raw JSVM API run as `$app`: PocketBase's own API rules of the collection do not apply to them at all, not even to check who the request belongs to. The filter that keeps one visitor's data away from another is then wherever you wrote it in your own code, and whoever writes a page without that filter — `$app.findRecordById('orders', params.id)`, no more — has written a page that shows anybody's order to anybody who is signed in.

```javascript
// pages/account/orders/[id]/+load.js — wrong: $app ignores the collection's rules entirely
module.exports = ({ params }) => ({
  order: $app.findRecordById('orders', params.id),
})
```

Measured against a real PocketBase, reading one record this way costs about 2.6 ms; nothing stops it from returning a record that belongs to someone else.

**Read it through `pb({ request })` instead**, so the record's own `viewRule` (or `updateRule`, `deleteRule`) decides, exactly as it would for a request to the API:

```javascript
// pages/account/orders/[id]/+load.js
module.exports = ({ pb, params, request }) => {
  try {
    const order = pb({ request }).collection('orders').getOne(params.id)
    return { order }
  } catch (e) {
    throw new NotFoundError()
  }
}
```

A visitor who is not the order's owner gets exactly what the collection's `viewRule` says a stranger gets (usually a 404, PocketBase's own). The rule is the one you already wrote for the API, or the one you will write later when you add a mobile app that talks to the same collection directly: there is only one place it can be wrong. The cost is the one honest trade-off: about 4.0 ms measured the same way, roughly 1.3 ms more than the raw call, for not having to get the filter right by hand on every page that reads a record.

Use the raw JSVM API freely for records nobody but your own code should ever reach (system collections, aggregates, batch jobs), and for public, unfiltered reads where there is nothing to protect. For anything a signed in visitor asks for by its own id, read it through the SDK: the collection's rule is checked, not reimplemented.

If the extra round trip is measured and matters on a hot path, `$app.canAccessRecord(record, info, record.collection().viewRule)` (with `info = new RequestInfo(); info.auth = request.auth`) checks the very same rule against a record you already have, for about the cost of the raw call. It is still your job to call it; the SDK's advantage is that you cannot forget to.

## SDK References

The plugin uses a special JSVM-compatible version of the PocketBase JS SDK that provides synchronous methods instead of async/await:

- [JSVM SDK Documentation](https://www.npmjs.com/package/pocketbase-js-sdk-jsvm)
- [Original JS SDK Documentation](https://github.com/pocketbase/js-sdk)
