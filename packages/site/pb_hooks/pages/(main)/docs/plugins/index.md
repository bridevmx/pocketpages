---
title: Plugins
description: Extend PocketPages with custom functionality using its powerful plugin architecture.
---

# Plugins

PocketPages has a highly **flexible plugin architecture** that allows you to extend the framework far beyond templating. Plugins can interact with various stages of your application, from request and response handling to rendering and extending the API context.

## Official Plugins

PocketPages comes with several official plugins:

- **EJS Plugin**: Template processing with enhanced features
- **Realtime Plugin**: Add Server-Sent Events (SSE) support
- **Authentication Plugin**: Complete auth system with multiple methods
- **JS SDK Plugin**: PocketBase JavaScript SDK integration
- **Micro Dash Plugin**: Lightweight utility functions for data manipulation

## What Can Plugins Do?

- **Extend Request and Response:**  
  Use hooks such as `onRequest` and `onResponse` to modify request processing and response delivery.
- **Customize Rendering:**  
  Intercept and modify output with the `onRender` hook.
- **Extend the API:**  
  Add custom functions or even integrate entire sub-applications via `onExtendContextApi`.

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
