---
title: Routing
description: Learn how to register HTTP routes, access path and query parameters, organize routes into groups, and handle unsupported methods in Barq.
---

**Routing** determines how your application handles incoming HTTP requests. When a client requests a path such as `/users/42`, Barq matches the request against your registered routes and HTTP methods, then invokes the appropriate handler to produce a response.

Barq provides a direct API for registering routes, working with parameters, grouping related endpoints, and organizing reusable functionality through plugins.

## HTTP methods

Barq provides a method for each supported HTTP method. Choose the method that best describes the operation your route performs.

| Method | Typical use |
|---|---|
| `get()` | Read or retrieve a resource. |
| `post()` | Create a resource or perform an operation. |
| `put()` | Replace or fully update a resource according to your application's rules. |
| `patch()` | Partially update a resource. |
| `delete()` | Delete a resource. |
| `head()` | Request response headers without the response body. |
| `options()` | Inspect the methods or options available for a route. |
| `all()` | Register a handler for all HTTP methods supported by Barq. |

### A practical example

```ts
import { App, json } from "@barqel/barq";

const app = new App();

app.get("/health", () => json({ ok: true }));

app.post("/users", createUser);
app.put("/users/:id", replaceUser);
app.patch("/users/:id", updateUser);
app.delete("/users/:id", deleteUser);

app.head("/health", healthHead);
app.options("/users", usersOptions);
```

Each route handles a different operation:

- `GET /health` returns the application's health status.
- `POST /users` invokes the user-creation handler.
- `PUT /users/:id` invokes the user-replacement handler.
- `PATCH /users/:id` invokes the user-update handler.
- `DELETE /users/:id` invokes the user-deletion handler.

Functions such as `createUser` and `replaceUser` are placeholders for handlers you define in your application. Barq does not provide these application-specific functions automatically.

### Registering a handler for all methods

Use `all()` when one path needs to handle every HTTP method supported by Barq:

```ts
app.all("/webhook", handleWebhook);
```

This can be useful when an endpoint needs to process different methods through a shared handler, such as certain external notification endpoints. Prefer a specific method when an operation only needs one; explicit routes make your API easier to understand.

### Adding middleware before a handler

Route methods accept zero or more middleware functions before the final handler.

```ts
app.get(
  "/account",
  requireAuthentication,
  loadAccount,
  (ctx) => json({ account: ctx.state.account }),
);
```

Here, the authentication and account-loading middleware are registered before the final handler. Their actual behavior depends on how you implement them: middleware should either allow the request to continue or terminate it with an appropriate response.

A handler can return a `Response` directly or return a `Promise` that resolves to a `Response`. This supports asynchronous operations such as retrieving records from a database.

## Path parameters

Path parameters let you extract values directly from a URL path instead of registering a separate route for every possible value.

For example, rather than defining separate routes for users `1`, `2`, and `3`, register one parameterized route:

```ts
app.get("/users/:userId", (ctx) => {
  return json({ userId: ctx.params.userId });
});
```

For a request such as `GET /users/42`, `ctx.params.userId` contains the string `"42"`.

### Multiple parameters

A route can contain multiple parameters:

```ts
app.get("/users/:userId/posts/:postId", (ctx) => {
  return json({
    userId: ctx.params.userId,
    postId: ctx.params.postId,
  });
});
```

For this request:

```http
GET /users/42/posts/7
```

The response is:

```json
{
  "userId": "42",
  "postId": "7"
}
```

Barq extracts each value from its position in the path. TypeScript can infer parameter names and their types when you register a route using a string literal. Parameter values are strings, even when they look like numbers.

### Optional parameters

Add `?` after a parameter name to make it optional:

```ts
app.get("/articles/:slug?", (ctx) => {
  return json({
    slug: ctx.params.slug ?? null,
  });
});
```

This pattern allows the route to match with or without a `slug`, according to Barq's routing rules.

For example:

- `/articles/barq-routing` provides the `slug` value `"barq-routing"`.
- `/articles` provides no `slug` value, which the example converts to `null` using `?? null`.

Barq expands optional segments into route alternatives when registering routes. A single pattern supports up to eight optional parameters. Avoid excessive optional segments; separate routes are often easier to understand.

### Wildcard parameters

Use `*name` to capture the remainder of a path in a single parameter:

```ts
import { App, text } from "@barqel/barq";

const app = new App();

app.get("/files/*path", (ctx) => {
  return text(ctx.params.path);
});
```

This route can capture the path after `/files/`, such as `docs/guide.md` in the following request:

```http
GET /files/docs/guide.md
```

A wildcard parameter must appear at the end of the route because it captures the remaining path.

**Security note:** Never treat a parameter as trusted input simply because the route matched. Validate values and convert them to the required types before using them. For example, validate that a user ID is a valid integer, and ensure file paths cannot access files outside an allowed directory.

## Query parameters

Query parameters appear after `?` in a URL. They are commonly used for search terms, pagination, sorting, and other request options.

Consider this request:

```http
GET /products?category=books&page=2
```

Use `ctx.queryParam(name)` to read a single value:

```ts
app.get("/products", (ctx) => {
  const category = ctx.queryParam("category");
  const page = ctx.queryParam("page");

  return json({ category, page });
});
```

Use `ctx.queryParamAll(name)` when a parameter may appear multiple times and you need all its values:

```ts
app.get("/search", (ctx) => {
  const tags = ctx.queryParamAll("tag");

  return json({ tags });
});
```

For example, the following request supplies multiple values for the same parameter:

```http
GET /search?tag=laravel&tag=bun&tag=typescript
```

If you need the standard JavaScript `URLSearchParams` interface, use `ctx.query`:

```ts
app.get("/products", (ctx) => {
  const page = ctx.query.get("page");
  const categories = ctx.query.getAll("category");

  return json({ page, categories });
});
```

**Which approach should you use?**

- Use `queryParam()` when you need one value.
- Use `queryParamAll()` when you need every occurrence of a specific parameter.
- Use `ctx.query` when you need the standard `URLSearchParams` API.

Query values are strings, too. If `page` represents a page number, validate it and convert it to a number before using it in calculations or database queries.

## Route groups

Route groups help organize routes that share a prefix or middleware. They are particularly useful as an application grows to include areas such as users, administration, and products.

### Creating a group

```ts
app.group("/api/v1", requireApiKey, (api) => {
  api.get("/users/:id", (ctx) => {
    return json({ id: ctx.params.id });
  });

  api.group("/admin", (admin) => {
    admin.get("/summary", () => json({ ok: true }));
  });
});
```

This example creates a group with the `/api/v1` prefix and attaches the `requireApiKey` middleware. It then registers a user route and a nested administration group.

The resulting paths are:

- `/api/v1/users/:id`
- `/api/v1/admin/summary`

Barq combines the prefixes of nested groups, so you do not need to repeat `/api/v1` in every route.

### Sharing middleware across routes

Attach middleware to a group when several routes need shared logic, such as API-key validation or access checks.

```ts
app.group("/api/v1", requireApiKey, (api) => {
  api.get("/profile", getProfile);
  api.get("/settings", getSettings);
});
```

Both routes share the `requireApiKey` middleware instead of declaring it separately on each route.

Make sure your middleware actually performs the required checks. Registering middleware on a group does not automatically provide a particular authentication or authorization mechanism.

### What can a group do?

Barq's group interface supports:

- Registering HTTP methods, including `all()`.
- Creating nested groups with `group()`.
- Registering WebSocket routes with `ws()`.
- Registering plugins with `plugin()`.
- Adding middleware with `use()`.

The group's `use()` method adds middleware to routes registered in that group. Use it when you want to organize middleware separately from route definitions, while keeping the actual registration order in mind.

## Plugins

Plugins let you organize reusable functionality for an application or a route group.

Register a plugin on the application:

```ts
app.plugin(myPlugin, options);
```

Or register it on a group:

```ts
app.group("/api/v1", (api) => {
  api.plugin(myPlugin, options);
});
```

In both examples, `myPlugin` is a plugin function defined in your project, and `options` represents the options you pass to it.

Barq plugins are ordinary functions. Barq does not automatically load plugin modules or resolve their dependencies. Import the plugin and initialize its dependencies as appropriate for your application, then pass the required options according to the plugin's API.

See the Plugins documentation for more details about plugin registration and the functionality plugins can provide.

## HTTP method mismatches

A request can match a registered path even when the requested HTTP method has no handler for that path. This is different from requesting a path that does not exist.

### `405 Method Not Allowed`

If Barq finds a matching path but has no handler for the requested method, it returns:

```http
405 Method Not Allowed
Allow: GET, HEAD
```

The `Allow` header lists the methods permitted for that path. The methods shown here are illustrative; the actual value depends on the registered route.

For example, if `/health` is registered with `GET` only and a client sends a `POST` request, Barq may return `405` instead of `404`.

### `404 Not Found`

If Barq cannot find a matching route, it returns a `404` response. You can customize this behavior with `app.notFound()`.

The distinction is important:

- `404`: No route matches the request.
- `405`: A route matches, but the requested HTTP method is not allowed for it.

This distinction makes client-facing errors clearer and helps you diagnose routing problems during development.

## Best practices

- **Choose the appropriate HTTP method:** Use `GET` for reads, `POST` for creation or operations, and `PATCH` for partial updates.
- **Use descriptive parameter names:** Prefer `:userId` and `:postId` over vague names.
- **Validate incoming values:** Path and query parameters are strings that may require validation and conversion.
- **Organize related routes into groups:** Share prefixes and middleware where appropriate.
- **Avoid excessive optional segments:** Keep route definitions readable and maintainable.
- **Distinguish missing routes from unsupported methods:** Use the `404` and `405` behavior to make failures easier to understand.
- **Use plugins for shared functionality:** Do not assume Barq automatically loads plugin dependencies.

With these features, you can build clear HTTP APIs that start with simple routes and grow into larger, well-organized groups without making route definitions difficult to maintain.