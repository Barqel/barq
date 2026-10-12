---
title: Idempotency Keys
description: Zero-dependency, Stripe-like Idempotency Key implementation to safely retry HTTP operations in Barq.
---

# Idempotency Keys

The `@barqel/barq-idempotency` plugin ensures that APIs safely handle retries without duplicating operations (e.g., preventing double charges). It implements the standard `Idempotency-Key` header pattern used by platforms like Stripe.

## Installation

```bash
bun add @barqel/barq-idempotency
```

## Quick Start

Secure a specific route by requiring an `Idempotency-Key` header:

```ts
import { App, json } from "@barqel/barq";
import { idempotency } from "@barqel/barq-idempotency";

const app = new App();

app.post(
  "/api/charge",
  idempotency({ enforceHeader: true }),
  async (ctx) => {
    const { amount } = await ctx.json<any>();
    
    // This logic only executes once per Idempotency-Key
    await processPayment(amount);

    return json({ success: true, amount });
  }
);

app.listen(3000);
```

## How It Works

1. **Initial Request**: When a client sends a `POST` request with an `Idempotency-Key`, Barq marks the key as `IN_PROGRESS`.
2. **Execution & Caching**: The handler executes. Barq intercepts the response, caches its body, headers, and status, and marks the key as `DONE`.
3. **Concurrent Requests**: If a second request arrives with the same key while the first is still `IN_PROGRESS`, Barq immediately returns `409 Conflict` with a `Retry-After: 1` header, preventing race conditions.
4. **Replayed Requests**: If the same key is received after completion, Barq bypasses the handler and returns the identical cached response, appending the `X-Idempotent-Replayed: true` header.

*Note: `GET`, `HEAD`, and `OPTIONS` requests are inherently idempotent and automatically bypass the middleware.*

## Global Plugin Usage

To enable optional idempotency across the entire application:

```ts
import { idempotencyPlugin } from "@barqel/barq-idempotency";

app.plugin(
  idempotencyPlugin({
    ttlMs: 24 * 60 * 60 * 1000, // 24 hours
  })
);
```

## Configuration Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `headerName` | `string` | `"idempotency-key"` | The HTTP header name to inspect |
| `ttlMs` | `number` | `86400000` (24h) | Cache expiration time in milliseconds |
| `enforceHeader`| `boolean` | `false` | If `true`, returns `400 Bad Request` when header is missing |
| `errorMessage` | `unknown` | Object | Custom JSON response when header is missing |
| `conflictMessage`| `unknown` | Object | Custom JSON response for `409` concurrent conflicts |
| `store` | `IdempotencyStore`| `MemoryIdempotencyStore` | Custom storage backend (e.g., Redis) |
