---
title: OpenAPI & Swagger
description: Generate OpenAPI 3.1 specifications and serve interactive documentation using Scalar or Swagger UI in Barq.
---

# OpenAPI & Swagger Documentation

The `@barqel/barq-openapi` plugin provides automatic OpenAPI 3.1 specification generation and interactive API documentation for Barq applications.

It adheres to the "Single Source of Truth" design: route schemas are defined once to handle request validation, TypeScript type inference, and documentation generation simultaneously.

## Installation

Install the plugin alongside Barq:

```bash
bun add @barqel/barq-openapi
```

## Quick Start

Register the plugin using `app.plugin()`:

```ts
import { App, json } from "@barqel/barq";
import { openapi } from "@barqel/barq-openapi";

const app = new App();

app.plugin(
  openapi({
    title: "Store API",
    version: "1.0.0",
    description: "High-performance API built with Barq",
    docsPath: "/docs",
    specPath: "/openapi.json",
    ui: "scalar",
  }),
);

app.get(
  "/products/:id",
  {
    schema: {
      tags: ["Products"],
      summary: "Get product by ID",
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      responses: {
        200: { description: "Product details returned" },
      },
    },
  },
  (ctx) => {
    const valid = ctx.valid as { params: { id: string } };
    return json({ id: valid.params.id, name: "Keyboard" });
  },
);

app.listen(3000);
```

Visit `http://localhost:3000/docs` to view the interactive API reference, and `http://localhost:3000/openapi.json` for the raw specification.

## Schema-driven Validation & Documentation

When a route includes a `schema` property, Barq automatically attaches validation middleware and extracts parameter definitions. Validated data is exposed via `ctx.valid`.

```ts
import { z } from "zod";

const CreateProductSchema = z.object({
  name: z.string().min(2),
  price: z.number().positive(),
  category: z.enum(["electronics", "clothing", "books"]),
});

app.post(
  "/products",
  {
    schema: {
      tags: ["Products"],
      summary: "Create a new product",
      body: CreateProductSchema,
      responses: {
        201: {
          description: "Product successfully created",
          content: z.object({
            id: z.string(),
            name: z.string(),
            price: z.number(),
          }),
        },
        422: {
          description: "Validation failed",
        },
      },
    },
  },
  (ctx) => {
    const { body } = ctx.valid as { body: z.infer<typeof CreateProductSchema> };
    return json({ id: "prod_1", ...body }, 201);
  },
);
```

## Authentication & Security Schemes

Configure security schemes such as Bearer tokens or API keys globally:

```ts
app.plugin(
  openapi({
    title: "Secure API",
    version: "1.0.0",
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
  }),
);

app.get(
  "/profile",
  {
    schema: {
      tags: ["User"],
      summary: "Retrieve authenticated profile",
      security: [{ bearerAuth: [] }],
    },
  },
  (ctx) => json({ user: ctx.state.user }),
);
```

## Route Groups

Schemas declared within `app.group()` automatically inherit group path prefixes:

```ts
app.group("/api/v1", (v1) => {
  v1.get(
    "/health",
    {
      schema: {
        tags: ["System"],
        summary: "Service health probe",
      },
    },
    () => json({ status: "healthy" }),
  );
});
```

## Configuration Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `title` | `string` | `"API Documentation"` | Title displayed in the API document and UI |
| `version` | `string` | `"1.0.0"` | API version number |
| `description` | `string` | `undefined` | Overview description for the API |
| `docsPath` | `string` | `"/docs"` | Path where the interactive documentation is served |
| `specPath` | `string` | `"/openapi.json"` | Path where the OpenAPI 3.1.0 JSON document is served |
| `ui` | `"scalar" \| "swagger"` | `"scalar"` | UI rendering engine (`scalar` or `swagger`) |
| `securitySchemes` | `Record<string, OpenAPISecurityScheme>` | `undefined` | Security definitions for authentication |
| `servers` | `Array<{ url: string; description?: string }>` | `undefined` | Server URLs list |
