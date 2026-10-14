---
title: Custom Configuration with +config.js
description: Configuration options for file processing and routing in pb_hooks/pages, including plugin configuration, debugging, and boot process.
---

# Custom Configuration with `+config.js`

In the `pb_hooks/pages/` root, you can create a `+config.js` file to define custom configuration options for your application. This file allows you to control how files are processed within your app through plugins and other settings.

```
pb_hooks/
  pages/
    +config.js
```

## Example Configuration

Here is an example of a basic `+config.js` file:

```javascript
module.exports = {
  plugins: [
    // String format (shorthand)
    'pocketpages-plugin-ejs',

    // Object format with name
    {
      name: 'pocketpages-plugin-ejs', // npm package name
      extensions: ['.ejs', '.md'],
      debug: false,
    },

    // Direct factory function
    (config, options) => ({
      // plugin implementation
    }),

    // Object format with explicit factory function
    {
      fn: (config, options) => ({
        // plugin implementation
      }),
      debug: false,
      // other options...
    },
  ],
  debug: false,
}
```

You can also export a function that takes the [globalApi](/docs/global-api) as an argument.

This allows you to leverage things like `env()` and more in your config.

```javascript
module.exports = function (api) {
  return {
    plugins: [
      {
        name: 'pocketpages-plugin-js-sdk',
        host: api.env('POCKETPAGES_HOST'),
      },
      'pocketpages-plugin-ejs',
    ],
    debug: true,
  }
}
```

## Configuration Options

- **`plugins`**: An array that specifies which plugins to use and their configurations. Plugins can be specified in several ways:

  - As a string (shorthand for npm package name)
  - As an object with `name` property specifying an npm package
  - As a plugin factory function directly
  - As an object with `fn` property containing a factory function

  The `debug` option defaults to `false` for all plugin formats.

- **`debug`**: A boolean that enables internal PocketPages debugging output to the console. When set to `true`, it will output information about routes, parameters, and other internal details that are helpful for troubleshooting. Defaults to `false`.

- **`cache`**: A boolean that controls whether PocketPages (and the plugins) remember what they read from disk, instead of reading it again on every request: compiled templates, where `include()` and `resolve()` found their files, and the contents of files loaded with `resolve()` in `raw`, `script` or `style` mode. Defaults to `true`, except when PocketBase runs with `--dev`, where it defaults to `false` so that edits show up on the next request.

  With caching on, edits to templates, partials and resolved files are picked up when PocketBase restarts. It does so by itself when `pb_hooks` changes (`--hooksWatch`, on by default, except on Windows). Set `cache: false` if you edit files while the app runs without restarting.

## Plugin Configuration Formats

PocketPages supports several formats for configuring plugins. Here are all the valid formats:

## Plugin Processing Order

The order of plugins in the `plugins` array determines their processing order. Each plugin's `onRender` hook is called in sequence, with the output of one plugin becoming the input for the next.

For example, when a plugin turns the content of a file into something else after EJS has rendered it:

```javascript
module.exports = {
  plugins: [
    // Processes first - renders the EJS in the file
    {
      name: 'pocketpages-plugin-ejs',
      extensions: ['.ejs', '.txt'],
    },
    // Processes second - receives what the EJS plugin rendered
    'my-text-transformer',
  ],
}
```

This configuration allows you to:

1. Use EJS features in every file the transformer handles
2. Process the resulting content
3. Output the final result

Changing the order would run the transformer first, then EJS - which might be desirable in some cases but would prevent the transformer from seeing the result of the EJS code.

```javascript
module.exports = {
  plugins: [
    // Format 1: String shorthand (npm package name)
    'pocketpages-plugin-ejs',

    // Format 2: Object with npm package name
    {
      name: 'pocketpages-plugin-ejs',
      debug: false,
      // Any other options are passed to the plugin
      extensions: ['.ejs', '.md'],
    },

    // Format 3: Direct factory function
    (config, options) => ({
      onRequest(context) {
        config.globalApi.dbg('Request:', context.request.method)
      },
    }),

    // Format 4: Object with explicit factory
    {
      fn: (config, options) => ({
        onRequest(context) {
          config.globalApi.dbg('Request:', context.request.method)
        },
      }),
      debug: false,
      // Any other options are passed to the plugin
    },
  ],
}
```

Important notes:

- The `name` property should be the name of an npm package that exports a plugin factory
- PocketPages plugins typically follow the naming convention `pocketpages-plugin-*` (e.g. `pocketpages-plugin-ejs`, `pocketpages-plugin-auth`)
- If both `fn` and `name` are present in an object configuration, `fn` takes precedence
- The `fn` property is the only reserved key in plugin configuration objects
- All other properties in plugin configuration objects are passed as options to the plugin
- The `debug` option defaults to `false` for all plugin formats

## Debug Options

PocketPages provides two levels of debug output control:

1. **Global debugging** - Set via the top-level `debug` option. When true, enables debug output for all of PocketPages.

2. **Per-plugin debugging** - Each plugin can have its own `debug` option. This allows you to enable debug output for specific plugins while keeping others quiet. The plugin's debug option only affects debug calls within that plugin's scope.

For example, to debug only the EJS plugin:

```javascript
module.exports = {
  plugins: [
    {
      name: 'pocketpages-plugin-ejs',
      debug: true, // Only EJS plugin will output debug info
    },
    'pocketpages-plugin-auth', // Debug defaults to false
  ],
  debug: false, // Global debugging remains off
}
```
