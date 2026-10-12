---
title: Rate Limiting
description: High-performance, zero-dependency in-memory rate limiting with sliding window support for Barq.
---

# Rate Limiting

The `@barqel/barq-rate-limit` plugin provides efficient, zero-dependency rate limiting with automated header management (RFC 6585 and IETF RateLimit standards).

## Installation

```bash
bun add @barqel/barq-rate-limit
```

## Quick Start

### Global Rate Limiting

Apply a limiter globally to all incoming requests using `app.plugin()`:

```ts
import { App, json } from "@barqel/barq";
import { rateLimiter } from "@barqel/barq-rate-limit";

const app = new App();

app.plugin(
  rateLimiter({
    windowMs: 60 * 1000,
    max: 100,
  }),
);

app.get("/api/data", () => json({ status: "ok" }));
app.listen(3000);
```

### Route-specific Rate Limiting

Apply strict limits to sensitive endpoints (such as authentication or password resets):

```ts
import { App, json } from "@barqel/barq";
import { rateLimit } from "@barqel/barq-rate-limit";

const app = new App();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    error: "Too Many Requests",
    message: "Too many login attempts. Please try again later.",
  },
});

app.post("/login", authLimiter, (ctx) => {
  return json({ authenticated: true });
});
```

## Key Generators

By default, the client IP (`ctx.ip`) is used. Custom identifiers such as API keys or user IDs can be configured:

```ts
rateLimit({
  windowMs: 60 * 1000,
  max: 1000,
  keyGenerator: (ctx) => ctx.req.headers.get("x-api-key") ?? ctx.ip,
});
```

## Response Headers

The middleware automatically sets standard and legacy headers:

* `RateLimit-Limit`: Maximum requests permitted per window.
* `RateLimit-Remaining`: Remaining request quota.
* `RateLimit-Reset`: Seconds remaining until quota reset.
* `Retry-After`: Seconds to wait before retrying (when status is 429).
* `X-RateLimit-*`: Legacy counterparts for backwards compatibility.

## Configuration Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `windowMs` | `number` | `60000` | Window time frame in milliseconds |
| `max` | `number \| (ctx) => number` | `100` | Maximum requests permitted per window |
| `keyGenerator` | `(ctx) => string` | `ctx.ip` | Key derivation function for client identification |
| `skip` | `(ctx) => boolean` | `undefined` | Predicate to bypass rate limiting |
| `statusCode` | `number` | `429` | HTTP status code for rate limit rejection |
| `message` | `unknown` | Object | Custom response body payload |
| `standardHeaders` | `boolean` | `true` | Enables `RateLimit-*` headers |
| `legacyHeaders` | `boolean` | `true` | Enables `X-RateLimit-*` headers |
