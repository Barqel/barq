---
title: Project Structure
description: Organize Barq HTTP applications for Bun or Node.js by separating the entry point, routes, and middleware into maintainable modules.
---

# Project Structure

Barq gives you the freedom to organize your project around your application's needs. It does not generate a mandatory directory structure or force you to follow a particular application architecture.

This flexibility lets you start with a small file and gradually split your application into independent modules as its routes, features, and responsibilities grow.

In this guide, you will learn a practical way to organize a Barq project, separate routes from the entry point, and decide when a more structured architecture becomes useful.

## A suggested project structure

You can start with the following layout:

```text
my-service/
├── src/
│   ├── index.ts
│   ├── routes/
│   │   ├── health.ts
│   │   └── users.ts
│   └── middleware/
│       └── authentication.ts
├── test/
├── package.json
└── tsconfig.json
```

Each file and directory has a clear responsibility:

| File or directory | Responsibility |
| --- | --- |
| `src/` | Contains your application code. |
| `src/index.ts` | The entry point that creates and configures the application and registers its modules. |
| `src/routes/` | Contains route modules, such as health checks and user management. |
| `src/routes/health.ts` | Defines routes related to service health. |
| `src/routes/users.ts` | Defines routes related to users. |
| `src/middleware/` | Contains middleware shared across requests, such as authentication. |
| `test/` | Contains tests that verify your application's behavior. |
| `package.json` | Defines project metadata, dependencies, and scripts. |
| `tsconfig.json` | Configures TypeScript and its type-checking behavior. |

This structure is a **suggestion, not a Barq requirement**. You can rename directories, combine files, or split them differently to suit your application's size and complexity.

The examples use TypeScript. Bun can run these files directly; Node.js runs JavaScript, so compile TypeScript before starting the generated JavaScript with `node`. For Node.js, import Barq from `@barqel/barq/node`; use `@barqel/barq` with Bun.

## 1. Keep the entry point responsible for assembling the application

Your `src/index.ts` should serve as the main place where the application is assembled, rather than containing every route and piece of business logic.

You can use this file to:

- Create the application using `App`.
- Configure application-wide settings.
- Register route modules and middleware.
- Start the server using the API for your runtime.

This approach makes it easier to understand how the application is configured without having to read every route implementation first.

## 2. Separate routes into independent modules

When an application is small, defining all routes in one file may be perfectly reasonable. As the application grows, however, separating routes by responsibility makes the code easier to read, maintain, and test.

For example, create `src/routes/health.ts`:

```ts
import type { App } from "@barqel/barq";

export function registerHealthRoutes(app: App) {
  app.get("/health", () => new Response("ok"));
}
```

This module defines a function named `registerHealthRoutes`. It receives the application and registers a route for checking the service's health.

When a `GET` request reaches `/health`, the route returns a text response containing `ok`.

You can use this endpoint in smoke tests or monitoring systems to check whether the endpoint responds. However, this response alone does not verify that your database or other external services are healthy. If you need those checks, implement them separately.

### Why is this approach useful?

- **Clear responsibilities:** The health-check module does not need to contain user-management logic.
- **Easier testing:** You can test route behavior independently of unrelated modules.
- **Scalability:** You can add modules such as `products.ts` or `orders.ts` without making the entry point unnecessarily large.
- **Reusability:** You can register the same route module in multiple applications or test environments when appropriate.

## 3. Register route modules in the entry point

After separating your routes, import the registration function and call it while configuring the application.

The following example illustrates a Node.js entry point:

```ts
import { App } from "@barqel/barq";
import { registerHealthRoutes } from "./routes/health";

const app = new App();

registerHealthRoutes(app);

app.listen(Number(process.env.PORT ?? 3000));
```

Each part has a specific purpose:

1. Import `App` to create the application.
2. Import `registerHealthRoutes` from the route module.
3. Create an application instance.
4. Register the health-check route.
5. Start listening on the port specified by `PORT`, or use `3000` when the environment variable is missing.

Keep route definitions separate from the file that assembles and starts the application.

## 4. Organize middleware by responsibility

Middleware consists of reusable units of logic that run during request processing, depending on how they are registered and ordered in your application.

For example, you might place authentication logic in the following file:

```text
src/
└── middleware/
    └── authentication.ts
```

This module could verify a user's credentials before allowing a request to access protected routes.

You do not need to put every middleware function in one file. If the number of middleware modules grows, separate them by purpose, such as authentication, request logging, and input validation.

**Important:** Creating a middleware file does not mean Barq will load or apply it automatically. You must import and register it using the middleware API supported by the framework.

## 5. Organize reusable route groups

If you are building a collection of routes that needs to be reused in multiple places, you may want to organize it using `RouteGroup` or accept the type inferred by TypeScript from `group()`.

The goal is to keep related routes together in a module instead of coupling every route directly to the entire application.

Choose the approach supported by the actual Barq API in your installed version. Do not assume that `RouteGroup` accepts the same arguments as `App`; each API may have its own responsibilities and types.

When designing a reusable module, document what it needs from the application, which routes it registers, and which settings or dependencies must be available.

## 6. Does Barq manage the rest of your application?

No. Barq focuses on providing the framework and does not prescribe a specific way to manage every part of your application.

You will need to choose appropriate tools and patterns for:

- **Configuration and environment variables:** Such as the service address, port, and connection credentials.
- **Databases:** Such as connection management, query organization, and migrations.
- **Input validation:** Such as validating request data before processing it.
- **Dependency injection:** Such as providing shared services to routes without tightly coupling them to specific implementations.
- **Testing:** Such as verifying routes, response behavior, and error handling.

You do not need to introduce a complex layer for every concern from the beginning. Start with what your application actually needs, then separate responsibilities when doing so provides a practical benefit.

## 7. How is your application structured differently from the Barq repository?

It is important to distinguish between **an application that uses Barq** and **the repository used to develop Barq itself**.

The Barq repository uses directories such as these for framework development:

```text
src/       # Framework source code
test/      # Focused tests
examples/  # Runnable examples
```

In your own application, you can use `src/routes/` and `src/middleware/`, or any other structure that fits your requirements.

You do not need to copy Barq's repository layout into your application. The repository organizes framework development and testing, while your application organizes the business logic of the service you are building.

## Summary

Start with a simple structure, keep the entry point responsible for assembling the application, and separate routes and middleware when the need arises.

There is no single structure that fits every application. Good project organization makes each module's responsibility clear and makes the code easier to test and change without introducing unnecessary layers.
