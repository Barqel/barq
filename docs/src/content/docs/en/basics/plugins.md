---
title: Plugins Architecture
description: Learn how to split Barq applications into independent modules, compose routes and middleware, and build reusable plugins.
---

As an application grows, organizing the code becomes just as important as writing it. Instead of keeping every route, authentication rule, monitoring endpoint, and system setting in one file, you can split the application into independent modules, each with a clear responsibility.

Barq provides a plugin system based on **functional composition**, exposed through `app.plugin()` and `group.plugin()`.

The idea is simple: write a function that registers the routes, middleware, and configuration associated with a feature, then use that function to compose the feature into an application or a specific route group.

This approach does not require a complex system of classes, containers, or abstraction layers. You can organize your application with straightforward TypeScript functions while keeping responsibilities separate and code reusable.

## What is a plugin in Barq?

A plugin is a function used to register and compose parts of an application into a single functional unit. Depending on the available APIs, it can register routes, attach middleware, or create additional route groups.

The basic plugin type looks like this:

```ts
type Plugin<TOptions = unknown> = (
  app: App,
  options?: TOptions,
) => void;
```

This definition has three parts:

- `app`: The application reference where the plugin registers its components.
- `options`: Optional configuration that controls how the plugin is composed.
- `void`: The plugin function's return type. It does not need to return a value to register routes.

### What happens when you call `app.plugin()`?

When you write:

```ts
app.plugin(myPlugin, options);
```

the plugin function is invoked during application setup and performs the registration operations it contains. For example, it can:

- Register new routes.
- Attach middleware.
- Create nested route groups.
- Use the supplied options to determine which routes or behaviors to register.

Once composed, the routes registered by the plugin become part of the application.

Barq's `app.plugin()` API also supports continued fluent chaining, according to the framework's interface.

**The key distinction:** A plugin organizes how the application is built. A route handler processes an actual request when that request matches its route.

## Plugin vs. middleware vs. route handler

These components may seem similar because they all contribute to an application, but each has a different responsibility.

| Comparison | Plugin | Middleware | Route handler |
|---|---|---|---|
| When does it run? | While composing the application and registering components | During request processing, according to its position in the execution pipeline | When handling a request that matches the route |
| Main responsibility | Compose features and register their components | Apply shared behavior around request processing | Execute route-specific logic |
| Does it access `Context`? | Not necessarily; the plugin receives an application or group reference | Yes, through the request context `ctx` | Yes, through the request context `ctx` |
| Typical example | A users or monitoring module | Authentication or response timing | Fetching a user or creating an order |

### Why isn't a plugin just another middleware?

Consider this example:

```ts
// Compose a feature into the application.
app.plugin(healthPlugin, { version: "2.1.0" });
```

This call registers the plugin's components during setup.

Middleware that checks an access key, on the other hand, executes its validation logic as requests pass through it.

Composing a plugin does not mean that the plugin function itself runs for every request. However, any middleware or route handlers registered by the plugin still participate in request processing when applicable.

It is better to avoid describing plugin overhead as literally "zero nanoseconds." Composing a plugin has a setup cost. The important point is that the plugin function does not automatically become an additional step on every request after registration is complete, unless the plugin registers components that affect request processing.

## Build your first plugin: a health module

Suppose you want to expose an endpoint that reports the application's status and version, plus an optional endpoint that reports the process uptime.

Instead of registering these routes directly in your main application file, place them in a dedicated plugin:

```ts
import { App, json } from "@barqel/barq";

interface HealthPluginOptions {
  version: string;
  uptime?: boolean;
}

export function healthPlugin(
  app: App,
  options?: HealthPluginOptions,
) {
  const version = options?.version ?? "1.0.0";

  app.get("/health", () =>
    json({
      status: "healthy",
      version,
    }),
  );

  if (options?.uptime) {
    app.get("/uptime", () =>
      json({
        uptime: process.uptime(),
      }),
    );
  }
}
```

Then compose the plugin into your application:

```ts
import { App } from "@barqel/barq";
import { healthPlugin } from "./plugins/health";

const app = new App();

app.plugin(healthPlugin, {
  version: "2.1.0",
  uptime: true,
});
```

### Understanding the example

**1. Define the plugin options**

```ts
interface HealthPluginOptions {
  version: string;
  uptime?: boolean;
}
```

The interface makes `version` a required property when options are supplied, while `uptime` is optional. TypeScript can catch configuration mistakes before the application runs.

**2. Provide a default value**

```ts
const version = options?.version ?? "1.0.0";
```

The optional chaining operator (`?.`) safely accesses the options when they are available. The nullish coalescing operator (`??`) uses the default when `version` is `undefined` or `null`.

**3. Register the health route**

```ts
app.get("/health", () =>
  json({
    status: "healthy",
    version,
  }),
);
```

The plugin registers an endpoint that reports the application's status and the version configured for the module.

**4. Register an optional route**

```ts
if (options?.uptime) {
  app.get("/uptime", () =>
    json({ uptime: process.uptime() }),
  );
}
```

The `/uptime` route is registered only when `uptime` is truthy. This demonstrates how plugin options can control which components are registered during setup.

Note that `process.uptime()` reports how long the server process has been running, not how long the plugin or an individual request has been running.

### When is this design useful?

This pattern is useful when you want a feature such as health checks to be reusable across applications. Instead of copying its routes into every project, you keep them in one module and compose that module with the appropriate configuration.

You can use the same approach for users, products, billing, and monitoring modules.

## Create a route-group plugin

Not every plugin needs to register routes at the application level. Sometimes you want a module that targets a specific group, such as a users API.

You can define a function that accepts a `RouteGroup`:

```ts
import type { RouteGroup } from "@barqel/barq";
import { json } from "@barqel/barq";

export function usersCrudPlugin<
  P extends string,
  S extends object,
>(group: RouteGroup<P, S>) {
  group.get("/", () => json({ users: [] }));

  group.get("/:id", (ctx) =>
    json({ id: ctx.params.id }),
  );

  group.post("/", (ctx) =>
    json({ created: true }, 201),
  );
}
```

Then compose it into a route group:

```ts
import { App } from "@barqel/barq";
import { usersCrudPlugin } from "./plugins/users";

const app = new App();

app.group("/api/v1/users", (usersApi) => {
  usersApi.plugin(usersCrudPlugin);
});
```

### Why accept a `RouteGroup`?

Because the plugin does not need to own the entire application. It only needs the group where its routes should be registered.

In this example, the relative routes become:

| Route inside the group | Resulting path |
|---|---|
| `/` | `/api/v1/users` |
| `/:id` | `/api/v1/users/:id` |

If the group API supports registering the routes this way, the `POST /` route is also registered under the group's prefix.

The generic parameters `P` and `S` allow the plugin to work with groups that carry different type information, according to Barq's `RouteGroup` definition. You do not need to understand every detail of generics to use this pattern; the important part is that the plugin receives the group where it will register routes.

**When should you use this approach?**

Use a group plugin when you want to reuse a module under different prefixes or keep one feature's responsibilities separate from the rest of the application.

## Build a complete module: middleware and monitoring routes

In larger applications, a module may need to do more than register routes. It may also need custom middleware to protect those routes.

Suppose you want an internal monitoring module whose endpoints require an access-key header.

```ts
import type { App, Middleware } from "@barqel/barq";
import { HttpError, json } from "@barqel/barq";

interface MetricsOptions {
  apiKeyHeader: string;
}

export function metricsModule(
  app: App,
  options?: MetricsOptions,
) {
  const headerName =
    options?.apiKeyHeader ?? "x-metrics-key";

  const enforceMetricsKey: Middleware = {
    before(ctx) {
      if (!ctx.req.headers.has(headerName)) {
        throw new HttpError(401, {
          error: "Missing Metrics Access Key",
        });
      }
    },
  };

  app.group(
    "/internal/metrics",
    enforceMetricsKey,
    (metrics) => {
      metrics.get("/system", () => {
        const memory = process.memoryUsage();

        return json({ memory });
      });
    },
  );
}
```

### What does this module bring together?

The plugin combines three related pieces:

1. **Configuration:** The header used for the access key can be changed.
2. **Middleware:** The middleware checks whether the header exists before request processing continues.
3. **Routes:** The module registers an endpoint that reports memory information under the internal monitoring prefix.

Once the plugin is composed into the application, you do not need to redefine the middleware or route prefix elsewhere.

### Important security note

This example checks only whether the header **exists**. It does not validate the key's value or prove that the caller is authorized. It is not a complete authentication system and should not be treated as sufficient protection for sensitive endpoints.

In a real application, compare the supplied key against a trusted value stored in secure configuration, or use an appropriate authentication mechanism. Monitoring data should also be protected from unauthorized access.

## Engineering boundaries of the plugin system

This plugin pattern composes components during application setup rather than dynamically loading modules for each request. Understanding the implications helps you design reliable plugins.

### 1. Synchronous composition

The plugin function described by the `Plugin` type is synchronous and returns `void`. Registration of routes and dependent components should therefore happen during composition.

Do not make the plugin function `async` based on this type alone: returning a `Promise` does not match the plugin signature shown here.

If a module needs to load configuration from a file or connect to a database before registering its routes, separate asynchronous initialization from synchronous composition, and make sure initialization has completed before starting the server.

### 2. Managing external resources

Some modules may need resources beyond route registration, such as database connections, timers, or external connections.

Do not assume that registering a plugin means Barq automatically manages the lifecycle of those resources. Define a clear strategy for initializing and closing them, using the lifecycle APIs supported by your Barq version.

In particular, verify the actual server shutdown API before relying on `app.stop()` to close resources. Stopping a server and cleaning up external resources are not necessarily the same operation.

### 3. Plugins are not automatically isolated

A plugin that registers routes or middleware adds those components to the shared application. Do not treat it as a sandbox or assume that its behavior and errors are confined to its own file.

Therefore:

- Give every plugin a clear responsibility.
- Avoid route conflicts between modules.
- Validate the options passed to plugins.
- Do not allow untrusted plugins to modify the application.

## Organizing a project with plugins

You can use a directory structure that makes each module's responsibility clear, for example:

```text
src/
├── plugins/
│   ├── health.ts
│   ├── metrics.ts
│   └── users.ts
└── app.ts
```

In this structure:

- `health.ts` handles health-check routes.
- `metrics.ts` handles monitoring routes and their access requirements.
- `users.ts` handles user routes.
- `app.ts` composes the modules into the application.

This is a suggested structure, not a requirement imposed by Barq. Adjust it to fit your project's size and module boundaries.

## Best practices

- Give each plugin one clear responsibility instead of combining unrelated features.
- Pass configuration through plugin options rather than scattering hard-coded values throughout the code.
- Use `group.plugin()` when a module belongs to a route group, and `app.plugin()` when it should be composed at the application level.
- Separate asynchronous resource initialization from synchronous route registration.
- Validate authentication and authorization properly; the presence of a header does not prove access is allowed.
- Test a plugin in a small application before using it in a larger project.
- Do not assume plugins are isolated or that the resources they create will be closed automatically.

## Summary

Barq's plugin system helps you organize an application by **composing small, clearly defined functional modules**. Use plugins to bring together routes, middleware, and configuration for a single feature, then use `app.plugin()` or `group.plugin()` to compose that feature in the right place.

This lets you split your application into modules that are easier to understand, test, and reuse—without turning the project into a complex abstraction framework.