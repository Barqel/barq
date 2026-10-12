---
title: Response Compression
description: Zero-dependency, high-performance gzip, deflate, and brotli HTTP response compression for Barq.
---

# Response Compression

The `@barqel/barq-compress` plugin provides automated HTTP response compression supporting `brotli`, `gzip`, and `deflate` using native Web Streams `CompressionStream` and `node:zlib`.

## Installation

```bash
bun add @barqel/barq-compress
```

## Quick Start

Apply compression across all routes via `app.plugin()`:

```ts
import { App, json } from "@barqel/barq";
import { compressPlugin } from "@barqel/barq-compress";

const app = new App();

app.plugin(
  compressPlugin({
    threshold: 1024,
    encodings: ["br", "gzip", "deflate"],
  }),
);

app.get("/items", () => {
  return json({
    data: Array.from({ length: 500 }, (_, i) => ({ id: i, name: `Item ${i}` })),
  });
});

app.listen(3000);
```

## Encoding Negotiation

The plugin parses incoming `Accept-Encoding` quality weights (`q=...`) and selects the highest-priority encoding:

1. `br` (Brotli)
2. `gzip`
3. `deflate`

## Automatic Filtering & Thresholds

* Responses smaller than `threshold` bytes (default 1024 / 1KB) are served uncompressed to avoid compression overhead.
* Only compressible MIME types (`text/*`, `application/json`, `application/javascript`, `image/svg+xml`, `application/wasm`) are processed.
* Automatically appends `Vary: Accept-Encoding` and adjusts `Content-Length`.

## Configuration Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `threshold` | `number` | `1024` | Minimum response size in bytes required for compression |
| `encodings` | `CompressionAlgorithm[]` | `["br", "gzip", "deflate"]` | List of enabled compression algorithms |
| `filter` | `(contentType, ctx) => boolean` | Built-in MIME filter | Custom predicate to determine compressible payloads |
