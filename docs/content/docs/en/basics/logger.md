---
title: Logging & Tracing
description: Zero-dependency structured HTTP logger, performance timing, and request correlation tracing for Barq.
---

# Logging & Tracing

The `@barqel/barq-logger` plugin provides high-performance, zero-dependency structured logging, response time measurement, and automated `X-Request-Id` correlation tracing for Barq.

## Installation

```bash
bun add @barqel/barq-logger
```

## Quick Start

### Global Logger

Attach structured logging across all routes via `app.plugin()`:

```ts
import { App, json } from "@barqel/barq";
import { loggerPlugin } from "@barqel/barq-logger";

const app = new App();

app.plugin(
  loggerPlugin({
    mode: "auto",
    level: "info",
    skip: (ctx) => ctx.pathname === "/health",
  }),
);

app.get("/health", () => json({ status: "ok" }));
app.get("/api/data", () => json({ items: [1, 2, 3] }));

app.listen(3000);
```

## Context Logger (`ctx.state.log`)

Inside any route handler, access the request-bound logger via `ctx.state.log`. Emitted messages automatically inherit the current `requestId`:

```ts
import { type RequestLogger } from "@barqel/barq-logger";

app.post("/users", async (ctx) => {
  const log = ctx.state.log as RequestLogger;
  const body = await ctx.json<any>();

  log.info("Creating user record", { email: body.email });

  try {
    const user = await saveUser(body);
    return json(user, 201);
  } catch (err) {
    log.error("Failed to persist user", err, { email: body.email });
    return json({ error: "Creation failed" }, 500);
  }
});
```

## Output Modes

* `pretty`: Terminal-formatted colored output with status badges and elapsed durations (ideal for local development).
* `json`: Single-line newline-delimited JSON objects (NDJSON) optimized for CloudWatch, Datadog, Elasticsearch, and Grafana Loki in production environments.
* `auto`: Defaults to `json` when `NODE_ENV=production`, otherwise uses `pretty`.

## Request ID Correlation

Every request receives an `X-Request-Id` header (either reused from incoming request headers or generated via `crypto.randomUUID()`). The identifier is returned in the response header and mapped to `ctx.state.requestId`.

## Configuration Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `level` | `"debug" \| "info" \| "warn" \| "error" \| "silent"` | `"info"` | Minimum threshold log level |
| `mode` | `"auto" \| "json" \| "pretty"` | `"auto"` | Format mode for stdout/stderr |
| `headerName` | `string` | `"x-request-id"` | Correlation identifier header name |
| `generateId` | `() => string` | `crypto.randomUUID()` | Custom ID generator |
| `skip` | `(ctx) => boolean` | `undefined` | Route skip condition |
| `output` | `(record, formatted) => void` | `undefined` | Custom transport destination hook |
