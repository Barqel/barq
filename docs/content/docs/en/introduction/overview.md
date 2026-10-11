---
title: What is Barq?
description: Discover Barq, a fast, lightweight HTTP framework for Bun and Node.js, with native WebSocket support on Bun.
---

**Barq** is a high-performance HTTP framework for [Bun](https://bun.sh/) and **Node.js**, built with TypeScript and designed to create HTTP applications and APIs efficiently, without external packages in its core. Native WebSocket routes currently require Bun.

Barq starts with a simple principle: **every unnecessary operation along the request path deserves scrutiny.** Its architecture focuses on reducing avoidable work, matching routes efficiently, and deferring data processing until the application actually needs it.

The goal is to combine **high performance, a straightforward development experience, and clear control over application behavior**, while using TypeScript to support type-safe development.

## Engineering philosophy

Performance rarely comes from a single isolated optimization. It comes from design decisions that work together to reduce the work required to process each request.

### Fast routing with Radix / Segment Trie

Barq uses a tree-based routing structure to match incoming requests instead of scanning every registered route sequentially.

This structure helps organize routes and find matching handlers efficiently, including static paths and parameterized paths, according to the routing patterns supported by the framework.

### Pre-analysis of execution paths

Barq analyzes selected characteristics of request handlers when routes are registered, with the goal of identifying suitable execution paths and reducing repeated work during request handling.

Where the handler's structure allows it, the framework can use direct execution paths and avoid creating a request context that the handler does not need.

This approach aims to reduce overhead in the hot path—the portion of code executed repeatedly for incoming requests.

### Lazy resource initialization

Not every request needs all of its associated data. Where possible, Barq defers parsing data that a handler does not explicitly request, such as query parameters, cookies, and selected request information.

This reduces unnecessary work for simple requests while keeping the data available when needed.

### A core with zero external dependencies

Barq's core is designed to run without external runtime packages. Framework-managed functionality includes areas such as routing, cookie handling, cryptography, and proxy policies.

This approach gives the project greater control over its components and reduces reliance on external packages within the core itself.

> **Important:** Zero dependencies means the core has no external package dependencies. It does not mean every application built with Barq must be dependency-free; applications can add the libraries they need.

## Key features

### Flexible HTTP routing

Barq supports common HTTP methods, including:

`GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `HEAD`, and `OPTIONS`.

It also supports multiple route patterns, such as named parameters, optional parameters, and wildcard paths, according to the framework's routing syntax.

```ts
app.get("/users/:id", (ctx) => {
  return json({ id: ctx.params.id });
});
```

In this example, the handler reads `id` from the route parameters and returns it in a JSON response.

### Middleware and request lifecycle hooks

Barq provides mechanisms for running shared logic around request handling, including `before` and `after` hooks, with support for passing typed request state through `ctx.state`.

These mechanisms help organize shared functionality such as request logging, authorization checks, and attaching data needed by handlers, without duplicating the same logic across routes.

### Built-in CORS

Barq provides configuration for Cross-Origin Resource Sharing (CORS), including preflight requests.

This helps control how browser-based applications access APIs, with policies for allowed origins, methods, and headers.

### Data validation with Standard Schema

Barq supports integration with libraries compatible with the [Standard Schema](https://standardschema.dev/) specification, enabling the use of tools such as Zod, Valibot, and ArkType where supported by the available integration interfaces.

Keeping validation rules separate from request-handling logic can make applications clearer and easier to maintain.

### Built-in WebSocket support

On Bun, Barq supports building WebSocket services alongside HTTP routes, with WebSocket upgrades, pre-authentication mechanisms, and session data passed to the socket through the framework's supported interfaces.

This makes Barq suitable for applications that need bidirectional communication, including real-time notifications, live updates, and interactive services.

### Security as part of the design

Barq includes security mechanisms intended to support more controlled service configurations, including:

- **Signed cookies:** HMAC-SHA256 for verifying the integrity of signed cookies.
- **Reverse-proxy policies:** Controls for handling proxy information and forwarded addresses according to the configured trust policy.
- **Open-redirect protection:** Controls intended to reduce the risk of redirecting users to untrusted destinations.

These mechanisms do not replace application-level security reviews, input validation, or deployment hardening. Actual protection depends on how the relevant interfaces are configured and used.

## Why Barq?

| Principle | Practical benefit |
|---|---|
| Performance first | Reduce unnecessary work during request handling. |
| Lightweight core | Minimize external dependencies within the framework itself. |
| TypeScript | Keep code organized and benefit from type safety during development. |
| Flexible routing | Build clear HTTP APIs with multiple route patterns. |
| Integration freedom | Choose validation libraries, databases, and services to fit your project. |
| Built-in capabilities | Provide core HTTP, CORS, and WebSocket functionality within the framework. |

## Who is Barq for?

Barq is designed for developers who want to build fast HTTP services with Bun or Node.js while keeping their architecture clear and retaining the freedom to choose the rest of their stack. Choose Bun when you need Barq's native WebSocket support.

It can be a good fit for:

- APIs for web and mobile applications.
- HTTP services that need efficient request processing.
- WebSocket applications and real-time communication.
- TypeScript-based backend systems.
- Services that aim to minimize external dependencies within their framework.

## Get started with Barq

The best way to understand Barq is to build a small application, then expand it with the routes, middleware, and features your project needs.

Follow the [Quickstart Guide](/en/docs/getting-started/quickstart) to create your first application, or explore the [API Reference](/en/docs/api-reference) for details about the available interfaces.

**Barq — Speed by design. Simplicity in practice.**
