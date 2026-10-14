---
title: response - HTTP Response Object
description: Modify HTTP response headers, status codes, and content in PocketPages templates.
---

# `response` - HTTP Response Object

- **Type**: [`PagesResponse`](https://github.com/benallfree/pocketpages/blob/main/src/lib/pages/index.ts#L14-L21)
- **Description**: The `response` object provides methods to control the HTTP response in a framework-agnostic way. This abstraction ensures your templates remain compatible across PocketBase versions.

## Methods

### `file(path: string)`

Serves a file from the filesystem.

```ejs
<%%
// Serve a PDF file
response.file('/path/to/document.pdf')
%>
```

### `write(s: string)`

Writes a string directly to the response body.

```ejs
<%%
response.write('<h1>Hello World</h1>')
%>
```

### `redirect(path: string, status?: number)`

Redirects to another URL, optionally specifying a status code.

```ejs
<%%
// Simple redirect
response.redirect('/dashboard')

// Redirect with status code
response.redirect('/login', 302)
%>
```

### `json(status: number, data: any)`

Sends a JSON response with the specified status code.

```ejs
<%%
response.json(200, {
    success: true,
    data: { message: 'Hello World' }
})
%>
```

### `html(status: number, data: string)`

Sends an HTML response with the specified status code.

```ejs
<%%
response.html(200, '<h1>Hello World</h1>')
%>
```

### `text(status: number, data: string)`

Sends plain text, or the type you set with `header('Content-Type', ...)`: XML, CSV, a robots.txt.

```ejs
<%%
response.header('Content-Type', 'application/xml; charset=utf-8')
response.text(200, '<?xml version="1.0"?><note>Hello</note>')
%>
```

### `noContent(status?: number)`

Sends only a status and the headers, `204` unless told otherwise. `304` is the other usual one, for browsers that already have the page.

### `header(name: string, value?: string)`

Gets or sets a response header. If value is provided, sets the header. If value is omitted, returns the current header value.

```ejs
<%%
// Set a header
response.header('Content-Type', 'application/json')
response.header('X-Custom-Header', 'custom-value')

// Get a header value
const contentType = response.header('Content-Type')
%>
```

### `addHeader(name: string, value: string)`

Adds a header without replacing the ones with the same name already there, for headers that can be sent more than once (`Link`, `Vary`).

```ejs
<%%
response.addHeader('Vary', 'Accept-Language')
response.addHeader('Vary', 'Cookie')
%>
```

### `status(code?: number)`

The status the page is sent with, `200` unless you change it. Called without a code it only tells what it is now. A form that did not validate is a `422`, a record that isn't there a `404`:

```ejs
<%%
if (!record) {
  response.status(404)
}
%>
```

### `sent()`

True once something has been written to the response: a redirect, `echo()`, a JSON response.

### `beforeSend(callback: () => void)`

Runs `callback` right before the response goes out. Cookies and headers can be set until then, so this is the place to set the ones that depend on what the page did (a session that changed while the page ran). Callbacks run once each, in the order they were added, also for requests that go on to PocketBase.

```ejs
<%%
response.beforeSend(() => {
  response.header('X-Rendered-At', new Date().toISOString())
})
%>
```

### `cookie<T>(name: string, value: T, options?: SerializeOptions)`

Sets a cookie in the response. Values are automatically serialized based on their type T. Returns the serialized cookie string.

The `options` parameter supports the following properties:

- `domain`: The domain name for the cookie
- `encode`: Custom value encoder function
- `expires`: Expiration date
- `httpOnly`: Flags the cookie to be accessible only by the web server
- `maxAge`: Maximum age in seconds
- `path`: Cookie path (defaults to '/')
- `priority`: Cookie priority ('low', 'medium', 'high')
- `sameSite`: CSRF protection setting ('lax', 'strict', 'none')
- `secure`: Flags the cookie to be used over HTTPS only

```ejs
<%%
// Set a simple string cookie
response.cookie<string>('theme', 'dark')

// Set a cookie with a typed object
interface Preferences {
  theme: string
  fontSize: number
  notifications: boolean
}

response.cookie<Preferences>('preferences', {
    theme: 'dark',
    fontSize: 14,
    notifications: true
})

// Set a cookie with options
interface SessionData {
  userId: number
  role: string
}

response.cookie<SessionData>('session', { userId: 123, role: 'admin' }, {
    httpOnly: true,
    secure: true,
    maxAge: 3600,
    path: '/',
    sameSite: 'strict'
})

// Arrays with explicit type
response.cookie<number[]>('recentItems', [1, 2, 3, 4, 5])
%>
```

Note: When reading these cookies back using `request.cookies<T>()`, the values will be automatically parsed back into their original type T.

You can set as many cookies as you need in one response, they are all sent. Setting a cookie again with the same name replaces the one set before it, so `response.cookie('theme', 'dark')` followed by `response.cookie('theme', 'light')` sends `light`.

Text that looks like JSON (`123`, `true`, `{...}`) is read as JSON by `request.cookies()`. If you want to be sure to get text back, start the value with a letter and a dot, as the plugins do: `v1.abc`.

## Example Usage

### Complete Response with Headers

```ejs
<%%
// Set headers
response.header('Cache-Control', 'no-cache')
response.header('X-Custom-Header', 'custom-value')

// Set a cookie
response.cookie('session', 'xyz789', {
    httpOnly: true,
    secure: true
})

// Send JSON response
response.json(200, {
    success: true,
    data: { message: 'Operation completed' }
})
%>
```

### Error Handling

```ejs
<%%
if (!params.id) {
    response.header('X-Error-Type', 'validation')
    response.json(400, {
        error: 'Missing ID parameter'
    })
    return
}

if (!record) {
    response.html(404, '<h1>Record Not Found</h1>')
    return
}
%>
```

### File Download with Headers

```ejs
<%%
response.header('Content-Disposition', 'attachment; filename="document.pdf"')
response.file('/path/to/document.pdf')
%>
```
