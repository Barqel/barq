---
title: Request Context
description: Learn how to use Barq's Context to read request data, access parameters and bodies, manage timeouts and redirects, and upgrade WebSocket connections.
---

# Request Context

When an HTTP request reaches your application, a route handler needs information about that request. What URL was requested? Which parameters were supplied? How can you read the data sent by the client? Has middleware added information that other parts of the application need?

Barq provides an object called `Context`, commonly referenced as `ctx`, to bring these request details and helper methods together.

Each route handler and middleware function receives a request context through Barq's API. You can use it to access the original request, read route and query parameters, process request bodies, and perform certain operations related to the connection lifecycle.

## 1. Read request and URL information

`Context` provides properties and helpers for accessing request information. The following table explains what each member does:

| Member | Description |
| --- | --- |
| `ctx.req` | The standard Fetch API `Request` object, containing request information such as the method, headers, and URL. |
| `ctx.params` | Read-only route parameters extracted from the route pattern. |
| `ctx.url` | The request URL as a string. |
| `ctx.pathname` | The URL path without the query string. |
| `ctx.query` | A `URLSearchParams` object for reading and working with query parameters. |
| `ctx.queryParam(name)` | Returns the first value for a query parameter, or `null` if it is missing. |
| `ctx.queryParamAll(name)` | Returns all values for a query parameter that appears more than once. |
| `ctx.state` | A request-scoped state object that middleware or application code can populate. |
| `ctx.development` | Indicates whether Barq is configured to expose development details. |
| `ctx.ip` | The client IP address after applying the proxy trust policy. |

### Example: Read the URL and its parameters

Suppose you have the following route:

```ts
app.get("/products/:id", (ctx) => {
  return json({
    id: ctx.params.id,
    pathname: ctx.pathname,
    sort: ctx.queryParam("sort"),
  });
});
```

When a client sends a request to:

```text
/products/42?sort=price
```

the handler reads these values:

- `ctx.params.id` — the route parameter, containing `"42"`.
- `ctx.pathname` — the path `/products/42`, without the query string.
- `ctx.queryParam("sort")` — the value of the `sort` query parameter, which is `"price"`.

This example only reads and returns values. It does not retrieve a product from a database or verify that the product exists.

### Query parameters can appear more than once

A URL can contain multiple values for the same parameter name:

```text
/products?tag=books&tag=technology
```

If you only need the first value, use:

```ts
const tag = ctx.queryParam("tag");
```

If you need every value, use:

```ts
const tags = ctx.queryParamAll("tag");
```

In this example, `tags` contains all values associated with `tag`, in the order they appear in the request URL.

Remember that query parameters are **strings, not automatically converted data types**. If a parameter represents a number or a value from a predefined set, validate and convert it before using it in your application logic.

### `ctx.query` vs. `ctx.queryParam()`

`ctx.query` is a standard `URLSearchParams` object, while `ctx.queryParam(name)` is a convenient helper for retrieving a single value.

Use `ctx.query` when you need the standard URL API, such as iterating over parameters or checking whether a parameter exists:

```ts
const query = ctx.query;

const hasSort = query.has("sort");
const sort = query.get("sort");
```

Because `ctx.query` is mutable, changing this object changes the query parameters used through that object in the current request context. Do not assume that such changes modify the original request URL or affect other requests.

## 2. Use request state (`ctx.state`)

`ctx.state` lets you store data associated with the current request. For example, middleware can prepare information that route handlers use later.

Common use cases include:

- Storing user information after authentication.
- Keeping a request trace identifier.
- Sharing a result computed by middleware with multiple handlers.

The main benefit is that request-specific information stays associated with the current request instead of relying on a shared global variable whose value could be mixed up across concurrent requests.

**Important:** Store sensitive information in request state only when necessary. Avoid keeping request-specific data in global variables shared across requests.

## 3. Read the request body

A request may contain data sent by the client, such as a JSON object, plain text, form fields, or a file. `Context` provides different helpers for reading the body according to the expected format.

```ts
const data = await ctx.json<unknown>();
const plainText = await ctx.text();
const form = await ctx.formData();
const fileLike = await ctx.blob();
const bytes = await ctx.arrayBuffer();
const stream = ctx.bodyStream; // or ctx.stream()
```

Each helper reads or exposes the request body in a different form:

| Helper | Use case |
| --- | --- |
| `ctx.json<unknown>()` | Reads and parses the body as JSON. |
| `ctx.text()` | Reads the body as text. |
| `ctx.formData()` | Reads form data, including fields and files when sent in this format. |
| `ctx.blob()` | Reads the body as a `Blob`. |
| `ctx.arrayBuffer()` | Reads the body into an `ArrayBuffer` of bytes. |
| `ctx.bodyStream` or `ctx.stream()` | Accesses the body as a stream for incremental processing. |

### Example: Read JSON

```ts
app.post("/echo", async (ctx) => {
  const data = await ctx.json<unknown>();

  return json({ received: data });
});
```

This route reads the request body and returns the received data inside the `received` property.

Using `unknown` is intentional: it prevents TypeScript from assuming that the input has a particular structure before it has been validated.

### Does `ctx.json<T>()` validate the input?

No. The generic type in `ctx.json<T>()` helps TypeScript understand the type you want to work with, but **it does not validate incoming data at runtime**.

A client might send syntactically valid JSON that is missing a required field or contains an unacceptable value. You should therefore check the data's structure and values before relying on them.

Use `validateJson()` with an appropriate validator to check data initially treated as `unknown`. For a practical example, see [JSON Validation](/basics/validation/).

### Body caching and repeated reads

Barq's body-reading helpers temporarily cache the data they read, so cached representations can be requested more than once according to Barq's behavior.

Streams are different. Once you consume a request body through a stream, you should not assume it can be read again. Choose the appropriate reading method before processing the body, especially when handling large files or incrementally delivered data.

## 4. Redirect requests

Use `ctx.redirect(url, status?)` to redirect a client to another URL.

The method accepts a destination URL and an optional HTTP status code. Barq uses the application's `allowedRedirectHosts` setting to validate absolute redirect URLs.

This validation matters when the redirect destination comes from user input. Redirecting users to an untrusted external website can expose your application to open redirect vulnerabilities.

Before redirecting, make sure the destination is permitted and that your allowed-host configuration matches your application's requirements.

For more information about response types and redirects, see [Responses and Redirects](/basics/responses/).

## 5. Control request timeouts

When a Bun server is available, the context provides two methods for managing the current request's timeout:

- `ctx.timeout(seconds)` — sets the timeout for the current request.
- `ctx.disableTimeout()` — disables the timeout.

You may need to adjust a timeout when an operation takes longer than usual. However, disabling timeouts is not appropriate for every request. It can leave connections open for a long time if an operation does not finish as expected.

Use `ctx.disableTimeout()` only when the operation genuinely requires it, such as certain long-lived streaming scenarios. Make sure you have a clear way to terminate the connection and handle errors.

## 6. Read the client IP address

`ctx.ip` provides the client IP address after applying the proxy trust policy.

This matters when your application runs behind a reverse proxy or load balancer. In that setup, the direct connection address may belong to the proxy rather than the original client.

However, you should not automatically trust any header that contains an IP address. Which address can be trusted depends on your proxy trust configuration and how requests reach the server.

Configure proxy trust to match your actual infrastructure. An incorrect configuration may allow clients to supply misleading IP addresses. The IP address alone should never be used as an authentication or authorization mechanism.

## 7. Upgrade a connection to WebSocket

`ctx.upgrade(data?)` allows a request to be upgraded to WebSocket through the Bun server and returns the operation's success result according to Barq's API.

If you need a complete WebSocket endpoint, however, `app.ws()` is the preferred approach for registering a WebSocket route and defining its lifecycle handlers, together with the appropriate authorization checks before allowing a connection.

A WebSocket connection has a different lifecycle from an ordinary HTTP request. After a successful upgrade, the connection becomes a persistent communication channel rather than a single request-response exchange.

For this reason, do not treat `ctx.upgrade()` as a complete replacement for registering a WebSocket route and managing its events.

## Summary

`Context` gives you a unified way to access request data and the tools needed to process it. Use:

- `ctx.params` and `ctx.queryParam()` to read URL parameters.
- `ctx.req` to access the standard request object.
- Body helpers to read JSON, text, forms, and binary data.
- `ctx.state` to share request-scoped information.
- `ctx.redirect()` and timeout methods when needed.
- `ctx.ip` with a properly configured proxy trust policy.
- `app.ws()` when building WebSocket endpoints with their own lifecycle.

Choose the right helper for each task, validate untrusted data at runtime, and remember that reading data or assigning it a TypeScript type does not automatically make it safe or valid to use.
