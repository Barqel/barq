---
title: In-Memory Testing Client
description: High-speed, zero-dependency in-memory HTTP testing client for Barq applications.
---

# In-Memory Testing Client

The `@barqel/barq-testing` package allows you to execute end-to-end HTTP integration tests directly in memory without binding to network ports or managing server lifecycles (`app.listen()` / `server.stop()`).

## Installation

```bash
bun add -d @barqel/barq-testing
```

## Quick Start

```ts
import { describe, expect, it } from "bun:test";
import { App, json } from "@barqel/barq";
import { testClient } from "@barqel/barq-testing";

const app = new App();
app.get("/users/:id", (ctx) => json({ id: ctx.params.id, name: "Ada" }));

describe("User Routes", () => {
  const client = testClient(app);

  it("retrieves user profile", async () => {
    const res = await client.get("/users/42");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "42", name: "Ada" });
  });
});
```

## Request Options

Pass query parameters, JSON bodies, headers, cookies, or simulated client IP addresses:

```ts
const res = await client.post("/api/checkout", {
  query: { currency: "USD", dryRun: true },
  json: { itemId: "item_123", quantity: 2 },
  headers: { Authorization: "Bearer token" },
  cookies: { session: "sess_abc" },
  ip: "203.0.113.195",
});
```

## Enhanced Response Helpers

The returned response extends the standard `Response` object with convenient testing helpers:

* `res.cookies`: A `Map` of parsed `Set-Cookie` attributes (`res.cookies.get("session")?.value`).
* `res.header(name)`: Shorthand for `res.headers.get(name)`.
* `res.json()`, `res.text()`, `res.blob()`, `res.arrayBuffer()`: Standard Fetch body consumption.

## Configuration Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `baseUrl` | `string` | `"http://localhost"` | Default URL prefix for relative paths |
| `defaultHeaders` | `Record<string, string>` | `undefined` | Headers attached to every request |
| `defaultIp` | `string` | `"127.0.0.1"` | Fallback simulated client IP |
