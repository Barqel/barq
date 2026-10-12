---
title: Static Files & SPA
description: High-performance static file serving, directory mounting, ETag caching, range requests, and SPA fallbacks for Barq.
---

# Static Files & SPA

The `@barqel/barq-static` plugin provides zero-dependency static file delivery for Barq. On Bun, it leverages native `Bun.file()` system calls for maximum transfer speed.

## Installation

```bash
bun add @barqel/barq-static
```

## Quick Start

Mount a public directory to serve assets and HTML:

```ts
import { App } from "@barqel/barq";
import { staticFiles } from "@barqel/barq-static";

const app = new App();

app.plugin(
  staticFiles({
    root: "./public",
    prefix: "/assets",
    maxAge: 86400,
  }),
);

app.listen(3000);
```

Files in `./public` are served under the `/assets` URL path (e.g. `/assets/style.css`).

## Single Page Application (SPA) Fallback

For client-side routers (React, Vue, Svelte), enable `spa: true` to route non-existent path requests with `Accept: text/html` back to `index.html`:

```ts
app.plugin(
  staticFiles({
    root: "./dist/client",
    spa: true,
  }),
);
```

## Direct Handler Usage

Use `serveStatic` directly within specific route definitions:

```ts
import { serveStatic } from "@barqel/barq-static";

app.get("/files/*path", serveStatic({ root: "./storage" }));
```

## Security & Path Traversal

The plugin enforces directory boundary checks to protect against path traversal attacks (e.g. `../`, `%00`, encoded slashes). Hidden files (`.env`, `.git`) are ignored by default.

## Configuration Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `root` | `string` | **Required** | Base directory containing static files |
| `prefix` | `string` | `""` | URL prefix prepended to file routes |
| `index` | `string \| false` | `"index.html"` | Default file served for directory requests |
| `spa` | `boolean \| string` | `false` | Fallback file for SPA HTML navigation |
| `maxAge` | `number` | `0` | `Cache-Control` max-age in seconds |
| `immutable` | `boolean` | `false` | Adds `immutable` directive to `Cache-Control` |
| `etag` | `boolean` | `true` | Computes ETags and handles `304 Not Modified` |
| `dotfiles` | `"ignore" \| "deny" \| "allow"` | `"ignore"` | Policy for serving dotfiles |
| `setHeaders` | `(res, path, stat) => void` | `undefined` | Custom hook to modify outgoing headers |
