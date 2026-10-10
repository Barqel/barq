---
title: Middleware and Groups
description: Learn how to share behavior across routes with middleware, share typed state, configure CORS, and organize routes into groups.
---

As an application grows, some tasks begin to repeat across multiple routes. You may need to check user permissions, measure response time, or allow a frontend hosted on another domain to send requests to your server.

Instead of repeating these tasks inside every route handler, Barq lets you use **middleware** to share behavior across routes and **route groups** to organize related routes and apply behavior to specific sets of routes.

## What is middleware?

Middleware is shared logic that runs around request handling. You can use it to log request information, check authentication data, or add headers to a response.

Barq supports two main hooks in this middleware pattern:

- `before`: Runs before the final route handler.
- `after`: Processes the response after the final route handler has executed.

These hooks help separate shared concerns from route-specific logic, making your code easier to read and maintain.

## Middleware structure

You can define middleware as an object with a `before` hook, an `after` hook, or both:

```ts
import type { Middleware } from "@barqel/barq";

export const requestTimer: Middleware = {
  before(ctx) {
    ctx.state.startTime = performance.now();
  },

  after(ctx, response) {
    const duration = (
      performance.now() - (ctx.state.startTime as number)
    ).toFixed(2);

    const headers = new Headers(response.headers);
    headers.set("X-Response-Time", `${duration}ms`);

    return new Response(response.body, {
      ...response,
      headers,
    });
  },
};
```

### How does this example work?

**1. Record the request start time**

```ts
before(ctx) {
  ctx.state.startTime = performance.now();
}
```

The hook uses `performance.now()` to record the start time and stores it in `ctx.state` so it can be accessed later.

**2. Calculate the processing duration**

```ts
const duration = (
  performance.now() - (ctx.state.startTime as number)
).toFixed(2);
```

The code subtracts the recorded start time from the current time. Calling `toFixed(2)` formats the result with two decimal places.

**3. Add a response header**

```ts
const headers = new Headers(response.headers);
headers.set("X-Response-Time", `${duration}ms`);
```

The code creates a new `Headers` object from the existing response headers, then adds `X-Response-Time` with the calculated duration.

**4. Return the response with the updated headers**

```ts
return new Response(response.body, {
  ...response,
  headers,
});
```

The hook returns a response containing the original body and the updated headers.

Once you register this middleware with your application, you can inspect response durations in developer tools or use them when monitoring requests without repeating the timing logic in every route.

> **Note:** This example measures the time between the `before` and `after` hooks along the actual execution path. Do not assume it represents the full network round-trip time between the client and server.

## Sharing typed state

Middleware often needs to extract data and make it available to a route handler. For example, authentication middleware can validate credentials and expose user information to subsequent route handlers.

Barq supports returning an object from `before` and automatically merging it into `ctx.state`, allowing TypeScript to infer the resulting types.

```ts
import { App, json } from "@barqel/barq";

const authMiddleware = {
  before(ctx) {
    const token = ctx.req.headers.get("Authorization");

    if (!token) {
      return new Response("Unauthorized", {
        status: 401,
      });
    }

    return {
      user: {
        id: "user_123",
        role: "admin",
      },
    };
  },
};

const app = new App()
  .use(authMiddleware)
  .get("/profile", (ctx) => {
    return json({
      user: ctx.state.user,
    });
  });
```

### What happens here?

1. The middleware reads the request's `Authorization` header.
2. If the header is missing, it returns a `401 Unauthorized` response.
3. If the header is present, it returns an object containing user information.
4. Barq merges the returned object into `ctx.state`, allowing the `/profile` handler to access `ctx.state.user`.

Thanks to type inference, TypeScript can determine the shape of `ctx.state.user` from the object returned by the middleware. You do not have to manually define the same type in every route.

### Why is typed state useful?

Typed state gives you a way to share data that route handlers need, such as user information or values extracted during request processing.

It also keeps your code clearer. Rather than repeating the same work in every handler, middleware performs the shared task and makes its result available through `ctx.state`.

**Security note:** This example demonstrates state sharing, not a complete authentication system. The presence of an `Authorization` header does not prove that a user is authenticated. In a real application, validate the credentials before creating the user object, and never grant administrative permissions simply because the header exists.

Likewise, if middleware returns a response directly, such as `401`, the request should not continue as though authentication had succeeded.

## Built-in CORS configuration

If your frontend runs on a different origin from your server, the browser may need permission to make the request under its Cross-Origin Resource Sharing policy, commonly known as **CORS**.

Barq provides the `cors()` helper to configure this policy without requiring an additional external package.

```ts
import { App, cors } from "@barqel/barq";

const app = new App();

app.use(
  cors({
    origin: [
      "https://myfrontend.com",
      "https://app.myfrontend.com",
    ],
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    maxAge: 86400,
  }),
);
```

### Configuration options

- `origin`: The origins allowed to make browser requests. This example allows two specific origins.
- `methods`: The permitted HTTP methods, such as `GET`, `POST`, `PUT`, and `DELETE`.
- `allowedHeaders`: The request headers clients are allowed to use, such as `Content-Type` and `Authorization`.
- `credentials`: Controls whether the CORS configuration permits credentialed requests, according to the implementation's behavior.
- `maxAge`: The number of seconds the result of a preflight request can be cached. `86400` is one day.

### What is a preflight request?

Before certain browser requests, the browser may send an initial `OPTIONS` request to check whether the server allows the requested origin, method, and headers. This is called a **preflight request**.

Barq's `cors()` handles preflight requests automatically and returns a `204 No Content` response with the appropriate CORS headers.

This removes the need to implement separate `OPTIONS` handling for requests that trigger CORS preflight checks.

### Important CORS considerations

- Allow only origins you trust. Do not permit every origin just to make development easier.
- If you use `credentials: true`, ensure that your `origin` configuration complies with CORS requirements for credentialed requests. A wildcard origin (`*`) cannot replace a specific origin in this case.
- CORS is not a replacement for authentication or authorization. It controls how browsers handle cross-origin requests; it does not prevent every type of client from sending requests to your server.

## Route groups

As an application grows, grouping related routes under a shared prefix makes the route structure easier to understand. You can also apply shared middleware to a group instead of configuring each route individually.

Barq's `app.group()` lets you create a group under a prefix and define nested groups with their own middleware.

```ts
app.group("/api/v1", requireApiKey, (v1) => {
  v1.get("/users", listUsers);

  v1.group("/admin", requireAdmin, (admin) => {
    admin.get("/metrics", getMetrics);
  });
});
```

### How are route paths constructed?

In this example:

- The outer group has the `/api/v1` prefix.
- `v1.get("/users", listUsers)` becomes `/api/v1/users`.
- The nested group adds `/admin` to the outer prefix.
- `admin.get("/metrics", getMetrics)` becomes `/api/v1/admin/metrics`.

Prefixes help you organize an API without repeating the same path segment in every route definition.

### Applying middleware to groups

In the example above, the outer group uses `requireApiKey`, while the nested group adds `requireAdmin`.

This lets you organize access requirements by route type:

- API routes that require a valid API key.
- Administrative routes that require additional permission checks.

Make sure each middleware performs the required validation. Merely receiving credentials is not enough; you must verify that they are valid and grant only the permissions the user is entitled to.

## Which feature should you use?

- Use **middleware** when you need to share behavior across routes, such as timing, authentication, or response modification.
- Use **typed state** when you need to pass computed data to route handlers while benefiting from TypeScript type inference.
- Use **`cors()`** when you need to configure the origins, methods, and headers allowed for browser requests.
- Use **route groups** when you want to organize routes under a shared prefix and apply middleware to a whole group.

You can combine these features to build a well-organized application: put shared behavior in middleware, pass data through `ctx.state`, configure CORS where needed, and organize related endpoints into clear route groups.