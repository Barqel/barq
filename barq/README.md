# Barq

Barq is a high-performance HTTP core for Bun and Node.js, written in TypeScript. It provides a segment-trie router, typed route parameters, middleware hooks, request context helpers, cookie utilities, redirects, and graceful server shutdown. Native WebSocket support is available on Bun.

## Requirements

- Bun 1.1 or newer, or Node.js 18+ for HTTP applications. On Node.js, import `@barqel/barq/node` to enable the HTTP adapter; native WebSockets and Bun-specific server features require Bun.
- A signing secret only when using signed cookies. Store it in a secret manager or environment variable; do not commit it.

## Quick start

```js
import { App, json } from "@barqel/barq";

const app = new App();

app.get("/users/:id", (ctx) => {
  return json({ id: ctx.params.id });
});

app.listen(3000);
```

This example enables the Node.js HTTP adapter. With Bun, import from `@barqel/barq` instead. Barq's native WebSocket routes require Bun.

See [examples/README.md](./examples/README.md) for runnable examples covering routing, middleware, validation, cookies, WebSockets, errors, and server lifecycle.

See [compares/README.md](./compares/README.md) for the separate Bun project used to benchmark Barq against Elysia with Bun's client or external `oha`.

The bilingual Fumadocs site lives in [`doc/`](./doc/README.md). Run it with `cd doc && bun run dev`; English and Arabic docs are available at `/en/docs` and `/ar/docs`.

Unsigned cookies work without a signing secret. Cookies are `HttpOnly` by default; pass `httpOnly: false` only when browser JavaScript needs access. Set `secure: true` for HTTPS deployments. To use signed cookies, configure a high-entropy secret and set cookies with `ctx.cookies.setSigned(name, value)`. `getSigned` returns `null` when verification fails or no secret is configured.

Incoming cookies are parsed lazily on the first `ctx.cookies` read or mutation. Routes that never use cookies do not parse the `Cookie` header or allocate the parsed-cookie map.

Error details are hidden by default unless `development: true` or `NODE_ENV=development` is set. Set development mode deliberately; error messages and stack traces can disclose application internals.

## Routing and middleware

Routes support named parameters (`/users/:id`), optional parameters (`/posts/:id?`, up to eight per pattern), and final wildcards (`/files/*path`). Route groups add prefixes and middleware:

```ts
app.group("/api", { before: (ctx) => {
  if (!ctx.req.headers.has("authorization")) {
    return new Response("Unauthorized", { status: 401 });
  }
} }, (api) => {
  api.get("/health", () => json({ ok: true }));
});
```

Middleware `before` hooks may return a `Response` to short-circuit; `after` hooks can replace the response. Errors become HTTP responses and can be customized with `app.onError()`.

For typed request state, return an object from a middleware `before` hook and keep the typed app returned by `.use()`:

```ts
const app = new App()
  .use({ before: () => ({ user: { id: "user-1" } }) })
  .get("/me", (ctx) => json({ id: ctx.state.user.id }));
```

The object is merged into `ctx.state` at runtime; hooks returning `void` add no merge work. Chain `.use(first).use(second)` when the second middleware needs the first middleware's inferred state. `validateJson(schema, handler)` adapts any schema with a `parse(unknown)` method without adding a schema dependency:

```ts
app.post("/users", validateJson(userSchema, (_ctx, body) => json(body)));
```

Optional parameters are expanded into ordinary trie routes during registration. The matcher has no optional-route branch at request time; registration parses the original pattern once and reuses its segments. Run `bun run bench` for warmed, five-round median router measurements, including optional routes against equivalent explicit routes. Results depend on the machine and Bun version and are not a performance guarantee.

## Proxy trust and client IP

By default, forwarded headers are ignored. Configure `trustProxy` with the exact proxy IPs or CIDR ranges that connect directly to the app. Barq walks `X-Forwarded-For` from the nearest hop and stops at the first untrusted address. `trustProxy: true` trusts every hop and is unsafe when clients can reach the app directly; prefer explicit ranges.

Keep the global `idleTimeout` enabled for ordinary traffic. A value of `0` disables it; use `ctx.disableTimeout()` only for a request that needs a long-lived stream.

`app.cluster(port)` starts one Bun worker per logical CPU on Linux and binds workers with `reusePort`; `await app.stop()` terminates the workers. Windows and macOS use a single-process listener because Bun's `reusePort` option is ignored there. Clustering requires a fixed non-zero port and the application entry file must call `app.cluster()` in each worker.

WebSocket deployments can bound inbound messages with `websocket.maxPayloadLength` and queued output with `websocket.backpressureLimit`. Set limits based on the application protocol; Bun's defaults permit messages and queued data up to 16 MiB per connection.

## Development

```sh
bun install
bun run check
bun run typecheck
bun run typecheck:tests
bun test
bun run build
bun run bench
bun run bench:middleware
bun run bench:runtime
```

`dist/` is generated by the build. Tests use Bun's test runner. The package is MIT licensed; see [LICENSE](./LICENSE).
