---
title: Microservice HTTP Client
description: Zero-dependency, resilient HTTP client with retries, circuit breaker, and distributed trace propagation for Barq.
---

# Microservice HTTP Client

The `@barqel/barq-client` package provides an outgoing HTTP client designed for microservice architectures, featuring automatic retries with exponential backoff, circuit breaking, request timeouts, and transparent `X-Request-Id` tracing propagation.

## Installation

```bash
bun add @barqel/barq-client
```

## Quick Start

### Standalone Client

```ts
import { createClient } from "@barqel/barq-client";

const paymentsApi = createClient({
  baseUrl: "https://payments.internal.net",
  timeoutMs: 5000,
  retry: { retries: 3, minDelayMs: 100 },
  circuitBreaker: { failureThreshold: 5, recoveryTimeMs: 30000 },
});

const res = await paymentsApi.post("/v1/charge", {
  json: { amount: 100 },
});

const data = await res.data<{ id: string; status: string }>();
```

### Application Plugin with Trace Propagation

When mounted via `clientPlugin()`, the client is injected into `ctx.state.client` and automatically forwards the current request's `X-Request-Id` to downstream services:

```ts
import { App, json } from "@barqel/barq";
import { clientPlugin } from "@barqel/barq-client";

const app = new App();

app.plugin(
  clientPlugin({
    baseUrl: "http://inventory-service:8080",
  }),
);

app.get("/order/:id", async (ctx) => {
  const client = (ctx.state as any).client;
  const res = await client.get(`/items/${ctx.params.id}`);

  return json(await res.data());
});

app.listen(3000);
```

## Circuit Breaker

The built-in Circuit Breaker transitions between three states:
* `CLOSED`: Normal operation, requests are dispatched.
* `OPEN`: Triggered when `failureThreshold` consecutive requests fail (5xx / network errors). Subsequent calls reject immediately with `CircuitBreakerOpenError` to prevent cascading outages.
* `HALF_OPEN`: Automatically entered after `recoveryTimeMs` to probe downstream service recovery.

## Configuration Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `baseUrl` | `string` | `undefined` | Target API base URL |
| `timeoutMs` | `number` | `10000` | Abort timeout per request attempt in ms |
| `headers` | `Record<string, string>` | `undefined` | Default outgoing headers |
| `retry` | `RetryOptions \| false` | `3 retries` | Retry configuration (exponential backoff + jitter) |
| `circuitBreaker` | `CircuitBreakerOptions \| false` | `Enabled` | Circuit breaker policy |
