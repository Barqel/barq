---
title: API Reference
description: Reference for Barq's public APIs in Bun and Node.js; Bun-specific server, cluster, and WebSocket features are identified.
---

# API Reference

Barq's HTTP APIs work with Bun and Node.js. Import `@barqel/barq` when using Bun; in Node.js, import `@barqel/barq/node` to enable its HTTP adapter. WebSockets, TLS server options, and worker clustering use Bun-specific server APIs.

## 1. Core Classes

### `App<TState>`
The primary entry point for configuring and running applications.

```ts
import { App } from "@barqel/barq";
const app = new App(options?: AppOptions);
```

#### Route Registration:
* `app.get(path, ...middlewares, handler)`
* `app.post(path, ...middlewares, handler)`
* `app.put(path, ...middlewares, handler)`
* `app.delete(path, ...middlewares, handler)`
* `app.patch(path, ...middlewares, handler)`
* `app.head(path, ...middlewares, handler)`
* `app.options(path, ...middlewares, handler)`
* `app.all(path, ...middlewares, handler)`

#### Lifecycle & Server Methods:
* `app.use(...middlewares)`: Registers global middleware.
* `app.group(prefix, ...middlewares, callback)`: Groups routes under a common path prefix.
* `app.plugin(pluginFn, options?)`: Composes features via modular plugin functions.
* `app.ws(path, handlers, beforeUpgrade?)`: Registers a WebSocket endpoint.
* `app.notFound(handler)`: Customizes 404 response for unmatched paths.
* `app.onError(handler)`: Central error handler for unexpected exceptions.
* `app.listen(port?)`: Starts the server. Bun uses its native server; Node.js uses the HTTP adapter enabled by importing `@barqel/barq/node`.
* `app.cluster(port?)`: Starts multiple Bun workers on Linux using `reusePort`. Bun-only.
* `app.stop(hardTimeoutMs?)`: Gracefully drains and stops a Bun HTTP server.

---

### `Context<TParams, TState>`
The request context (`ctx`) passed to handlers and middleware:

| Property / Method | Type | Description |
| :--- | :--- | :--- |
| `ctx.req` | `Request` | The standard Fetch API Request object. |
| `ctx.params` | `TParams` | Extracted route parameters. |
| `ctx.pathname` | `string` | Normalized request path without query string. |
| `ctx.query` | `URLSearchParams` | Standard URLSearchParams instance. |
| `ctx.queryParam(name)` | `string \| null` | Fast lazy lookup of a single query parameter. |
| `ctx.queryParamAll(name)` | `string[]` | Retrieves all values for repeated query parameters. |
| `ctx.cookies` | `CookieJar` | Cookie management (reading, setting, signing). |
| `ctx.state` | `TState` | Request-scoped typed state. |
| `ctx.ip` | `string` | Resolved client IP address respecting proxy trust. |
| `ctx.json<T>()` | `Promise<T>` | Parses request body as JSON (cached). |
| `ctx.text()` | `Promise<string>` | Reads request body as text (cached). |
| `ctx.redirect(url, status?)` | `Response` | Redirects with host allowlist validation. |
| `ctx.timeout(seconds)` | `this` | Sets timeout for the current request. |
| `ctx.disableTimeout()` | `this` | Disables timeout for long-running streaming requests. |

---

## 2. Response Helpers

```ts
import { json, text, empty, redirect } from "@barqel/barq";
```

* `json(data, init?)`: Fast JSON response with prebuilt headers.
* `text(body, init?)`: Plain-text response with prebuilt headers.
* `empty(status?, headers?)`: Bodyless response (defaults to `204 No Content`).
* `redirect(url, status?, allowlist?)`: Validated HTTP redirect (301, 302, 303, 307, 308).

---

## 3. Errors & Validation

### `HttpError`
Used to throw expected HTTP errors:
```ts
throw new HttpError(status, body?, headers?);
```

### `validateJson(validator, handler)`
Standard Schema v1 compatible validation helper (works with Zod, Valibot, ArkType):
```ts
app.post("/users", validateJson(UserSchema, (ctx, body) => {
  return json({ user: body }, 201);
}));
```

---

## 4. Middleware & Security

### `cors(options?: CorsOptions)`
Built-in zero-dependency CORS middleware with automated preflight (OPTIONS) handling.

### `CookieJar`
Accessed via `ctx.cookies`:
* `cookies.get(name)`: Read unsigned cookie.
* `cookies.set(name, value, options?)`: Write cookie with secure defaults.
* `cookies.getSigned(name, secret?)`: Read and verify HMAC-SHA256 signed cookie.
* `cookies.setSigned(name, value, options?, secret?)`: Set signed cookie.
* `cookies.delete(name, options?)`: Expire and remove cookie.
