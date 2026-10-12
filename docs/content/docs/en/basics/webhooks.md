---
title: Webhook Verification
description: Zero-dependency HMAC signature verification and replay protection for Stripe, GitHub, Shopify, and custom webhooks in Barq.
---

# Webhook Verification

The `@barqel/barq-webhooks` plugin provides timing-safe cryptographic signature validation and replay attack protection for incoming webhooks across major payment and SaaS providers.

## Installation

```bash
bun add @barqel/barq-webhooks
```

## Quick Start

Validate Stripe webhooks with automatic timestamp tolerance checks:

```ts
import { App, json } from "@barqel/barq";
import { verifyWebhook } from "@barqel/barq-webhooks";

const app = new App();

app.post(
  "/webhooks/stripe",
  verifyWebhook({
    provider: "stripe",
    secret: process.env.STRIPE_WEBHOOK_SECRET!,
    toleranceSeconds: 300,
  }),
  (ctx) => {
    const event = ctx.state.webhookPayload as any;
    console.log("Verified event:", event.type);
    return json({ received: true });
  }
);

app.listen(3000);
```

## Supported Providers

* `stripe`: Validates `stripe-signature` (`t=...,v1=...`) with timestamp drift and replay attack mitigation.
* `github`: Validates `x-hub-signature-256` (`sha256=...`).
* `shopify`: Validates `x-shopify-hmac-sha256` (base64 encoded HMAC).
* `standard`: Validates generic HMAC-SHA256 headers (`x-signature-256`).
* `custom`: Supports custom signature extraction and validation functions.

## GitHub Webhooks Example

```ts
app.post(
  "/webhooks/github",
  verifyWebhook({
    provider: "github",
    secret: process.env.GITHUB_WEBHOOK_SECRET!,
  }),
  (ctx) => {
    const payload = ctx.state.webhookPayload;
    return json({ ok: true });
  }
);
```

## Context State

Once verified, the following properties are attached to `ctx.state`:
* `ctx.state.webhookPayload`: Parsed JSON payload (or raw string if not JSON).
* `ctx.state.webhookRaw`: The exact unparsed raw body string used during signature verification.
* `ctx.state.webhookProvider`: The matched provider identifier.

## Configuration Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `provider` | `"stripe" \| "github" \| "shopify" \| "standard" \| "custom"` | `"standard"` | Target webhook provider format |
| `secret` | `string \| (ctx) => Promise<string>` | **Required** | Secret key or dynamic resolver |
| `toleranceSeconds`| `number` | `300` | Replay tolerance window in seconds (for Stripe) |
| `headerName` | `string` | `"x-signature-256"` | Header name for standard and custom providers |
| `parseJson` | `boolean` | `true` | Automatically parses raw body to JSON |
| `onInvalidSignature` | `(ctx, err) => Response` | `undefined` | Custom handler for rejected signatures |
