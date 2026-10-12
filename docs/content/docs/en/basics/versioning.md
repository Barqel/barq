---
title: API Versioning
description: Zero-dependency, flexible API versioning by headers, query parameters, or media-types for Barq.
---

# API Versioning

The `@barqel/barq-versioning` plugin allows you to manage multiple API revisions seamlessly without duplicating routes, supporting version resolution through HTTP headers, query parameters, or vendor media types.

## Installation

```bash
bun add @barqel/barq-versioning
```

## Quick Start

Route traffic on the same endpoint to different handlers based on client version:

```ts
import { App, json } from "@barqel/barq";
import { version } from "@barqel/barq-versioning";

const app = new App();

app.get(
  "/users/:id",
  version(
    {
      "1": (ctx) => json({ id: ctx.params.id, name: "Legacy User" }),
      "2": (ctx) => json({ id: ctx.params.id, firstName: "Modern", lastName: "User" }),
    },
    { defaultVersion: "1" }
  )
);

app.listen(3000);
```

Clients can specify the version in multiple ways:
* **Header**: `Accept-Version: 2` (or `Accept-Version: v2`)
* **Query Parameter**: `GET /users/42?v=2`

## Versioning Strategies

Configure the strategy via `version(map, options)` or globally via `versioningPlugin()`:

### 1. HTTP Header Strategy
```ts
version(handlers, {
  type: "header",
  header: "X-API-Version",
});
```

### 2. Query Parameter Strategy
```ts
version(handlers, {
  type: "query",
  query: "api-version",
});
```

### 3. Media-Type / Content Negotiation Strategy
```ts
version(handlers, {
  type: "media-type",
  mediaTypePrefix: "application/vnd.myapi",
});
// Matches: Accept: application/vnd.myapi.v2+json
```

## Global Plugin Integration

Automatically detect and inject the resolved version into `ctx.state.version`:

```ts
import { versioningPlugin } from "@barqel/barq-versioning";

app.plugin(
  versioningPlugin({
    header: "Accept-Version",
    defaultVersion: "1",
  })
);
```

## Configuration Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `type` | `"header" \| "query" \| "media-type" \| array` | `["header", "query"]` | Version extraction strategies |
| `header` | `string` | `"accept-version"` | Target header name for header strategy |
| `query` | `string` | `"v"` | Target query parameter name for query strategy |
| `mediaTypePrefix` | `string` | `"application/vnd.api"` | Prefix for vendor media-type matching |
| `defaultVersion` | `string` | `undefined` | Fallback version when none is provided |
| `normalize` | `(ver: string) => string` | Trims and strips `v` | Normalization hook for version strings |
| `onInvalidVersion` | `(ctx, ver, supported) => Response` | `400 Bad Request` | Custom handler for unsupported versions |
