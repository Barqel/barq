---
title: Caching & ETag
description: High-performance, zero-dependency HTTP response caching and ETag generation for Barq.
---

# Caching & ETag

The `@barqel/barq-cache` plugin provides fast, in-memory HTTP response caching with automatic `ETag` generation and `304 Not Modified` conditional request handling.

## Installation

```bash
bun add @barqel/barq-cache
```

## Quick Start

Apply caching globally to improve performance of read-heavy APIs:

```ts
import { App, json } from "@barqel/barq";
import { cachePlugin } from "@barqel/barq-cache";

const app = new App();

app.plugin(
  cachePlugin({
    ttlMs: 60 * 1000, // 1 minute
    enableEtag: true,
  }),
);

app.get("/api/trends", async () => {
  const data = await heavyDatabaseQuery();
  return json(data);
});

app.listen(3000);
```

## How It Works

1. **Cache MISS**: The request reaches the route handler. The response is intercepted, its body is cloned and stored in memory alongside its computed `ETag` (using SHA-1), and `X-Cache: MISS` is appended to the response.
2. **Cache HIT**: Subsequent requests are served directly from memory, skipping the route handler entirely. The response includes `X-Cache: HIT`.
3. **Conditional Requests**: If the client sends an `If-None-Match` header matching the cached `ETag`, the plugin immediately returns a `304 Not Modified` empty response, saving bandwidth.

## Custom Key Generation

By default, the cache key is `${method}:${url}`. You can customize it to include authorization tokens or specific query parameters:

```ts
cachePlugin({
  ttlMs: 30000,
  keyGenerator: (ctx) => {
    const lang = ctx.queryParam("lang") ?? "en";
    return `${ctx.req.method}:${ctx.pathname}?lang=${lang}`;
  },
})
```

## Configuration Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `ttlMs` | `number` | `60000` | Time to live in milliseconds |
| `methods` | `string[]` | `["GET", "HEAD"]` | HTTP methods to cache |
| `enableEtag` | `boolean` | `true` | Computes ETag and handles `If-None-Match` |
| `cacheControl` | `boolean` | `true` | Appends `Cache-Control: public, max-age=...` |
| `keyGenerator` | `(ctx) => string` | `method:url` | Cache key derivation function |
| `skip` | `(ctx) => boolean` | `undefined` | Predicate to bypass caching dynamically |
| `store` | `CacheStore` | `MemoryCacheStore` | Custom storage backend implementation |
