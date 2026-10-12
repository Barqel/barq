---
title: Environment Configuration
description: Zero-dependency, type-safe environment variable schema validation and early crash detection for Barq.
---

# Environment Configuration

The `@barqel/barq-env` plugin provides type-safe environment variable schema parsing, type coercion, and fail-fast startup validation for Barq applications.

## Installation

```bash
bun add @barqel/barq-env
```

## Quick Start

```ts
import { createEnv, env } from "@barqel/barq-env";

export const config = createEnv({
  PORT: env.port({ default: 3000 }),
  DATABASE_URL: env.url(),
  JWT_SECRET: env.string({ min: 32 }),
  DEBUG: env.boolean({ default: false }),
  NODE_ENV: env.enum(["development", "production", "test"] as const, {
    default: "development",
  }),
});
```

If any required variable is missing or malformed, Barq halts boot immediately and displays formatted diagnostics.

## App Plugin Integration

```ts
import { App } from "@barqel/barq";
import { envPlugin, env } from "@barqel/barq-env";

const app = new App();

app.plugin(
  envPlugin({
    API_KEY: env.string(),
  })
);

app.get("/service", (ctx) => {
  const apiKey = (ctx.state as any).env.API_KEY;
  return new Response("OK");
});
```
