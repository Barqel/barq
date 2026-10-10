# Barq Examples

These examples are small, runnable Bun programs that demonstrate Barq's public API. They import from `../src` so they can run from a repository checkout without first building `dist/`.

## Run an example

From the repository root, run one example at a time:

```sh
bun run examples/01-quick-start.ts
```

By default, examples listen on port `3000`. Set `PORT` to choose another port:

```sh
PORT=3100 bun run examples/02-routing-and-context.ts
```

Stop a running server with `Ctrl+C`. Examples that need signed cookies require `COOKIE_SECRET`:

```sh
COOKIE_SECRET="use-a-long-random-secret" bun run examples/06-cookies-and-redirects.ts
```

The API group example expects `API_KEY`; the WebSocket example expects `WS_TOKEN`. Use random values when testing and do not commit real credentials.

## Example index

| File | Topics |
| --- | --- |
| `01-quick-start.ts` | App creation, routes, JSON/text/empty responses, listening |
| `02-routing-and-context.ts` | HTTP methods, route params, optional params, wildcards, query and request body helpers |
| `03-middleware-and-state.ts` | Typed middleware state, short-circuiting, route middleware, before/after hooks |
| `04-groups-and-plugins.ts` | Nested route groups, group middleware, reusable plugins |
| `05-json-validation.ts` | Dependency-free Validator contract and `validateJson` |
| `06-cookies-and-redirects.ts` | Unsigned and signed cookies, cookie options, redirect allowlist |
| `07-errors-and-not-found.ts` | Custom 404 and error handlers, `HttpError` |
| `08-proxy-client-ip.ts` | Explicit proxy trust and `ctx.ip` |
| `09-websockets.ts` | Upgrade authorization and WebSocket lifecycle handlers |
| `10-server-options-and-shutdown.ts` | Runtime limits, port reporting, graceful shutdown |
| `11-request-body-helpers.ts` | JSON, text, form data, Blob, ArrayBuffer, and streaming bodies |
| `12-redirects-and-timeouts.ts` | Redirect helpers, per-request timeouts, and server-sent events |

All examples are intentionally independent. They are teaching material, not a production-ready application; adapt secrets, authorization, persistence, logging, and deployment settings to your service.

For TLS, pass Bun's `tls` options to `new App({ tls: { key, cert } })`; load certificate contents from files or a secret manager rather than committing them.
