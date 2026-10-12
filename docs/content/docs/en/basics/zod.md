---
title: Zod Validation
description: High-performance, ergonomic Zod validation middleware for Barq APIs.
---

# Zod Validation

The `@barqel/barq-zod` plugin provides dedicated Zod middleware for validating request bodies, query parameters, route parameters, and headers with automated type inference onto `ctx.valid`.

## Installation

```bash
bun add @barqel/barq-zod zod
```

## Quick Start

### Single Target Validation (`zValidator`)

```ts
import { App, json } from "@barqel/barq";
import { zValidator } from "@barqel/barq-zod";
import { z } from "zod";

const app = new App();

const UserSchema = z.object({
  name: z.string().min(3),
  age: z.number().int().min(18),
});

app.post("/users", zValidator("json", UserSchema), (ctx) => {
  const { body } = ctx.valid as { body: z.infer<typeof UserSchema> };
  return json({ user: body }, 201);
});

app.listen(3000);
```

### Multi-Target Validation (`validateZod`)

Validate path parameters and query strings concurrently:

```ts
import { validateZod } from "@barqel/barq-zod";

app.get(
  "/products/:id",
  validateZod({
    params: z.object({ id: z.string().regex(/^\d+$/) }),
    query: z.object({ currency: z.enum(["USD", "EUR"]).default("USD") }),
  }),
  (ctx) => {
    const valid = ctx.valid as { params: { id: string }; query: { currency: string } };
    return json({ id: valid.params.id, currency: valid.query.currency });
  }
);
```
