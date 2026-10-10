---
title: Errors and Not Found Routes
description: Learn how to handle HTTP errors, customize error responses, and handle unmatched routes in Barq.
---

Errors are a normal part of any application. A requested resource might not exist, a client might send invalid input, or an unexpected failure might occur while processing a request.

Barq gives you control over these situations. You can throw an `HttpError` when you know which HTTP status to return, register an application-wide error handler, and customize the response for requests that do not match any route.

## Expected HTTP errors

Use `HttpError` when you know why a request cannot be completed and want to return a specific HTTP status, such as `400 Bad Request` or `404 Not Found`.

Suppose you have a route that retrieves an order by its ID:

```ts
import { HttpError } from "@barqel/barq";

app.get("/orders/:id", (ctx) => {
  const order = findOrder(ctx.params.id);

  if (!order) {
    throw new HttpError(404, {
      error: "Order not found",
    });
  }

  return json(order);
});
```

The handler looks up the order using `ctx.params.id`. If the order does not exist, it throws an `HttpError` with status `404` instead of returning a successful response that would misrepresent the result.

If the order exists, the handler returns its data as usual.

### How does `HttpError` work?

The constructor accepts three arguments:

```ts
new HttpError(status, body?, headers?)
```

- `status`: The HTTP status code. It must be a number between `100` and `599`.
- `body`: The response body to send to the client. If omitted, Barq creates a basic error object for the status.
- `headers`: Additional HTTP response headers, when needed.

The default error handler converts the error body to JSON.

For example, you can return a `400` response when an input value is invalid:

```ts
app.get("/reports/:year", (ctx) => {
  const year = Number(ctx.params.year);

  if (!Number.isInteger(year) || year < 2000) {
    throw new HttpError(400, {
      error: "Invalid year",
      message: "Year must be an integer greater than or equal to 2000.",
    });
  }

  return json({ year });
});
```

The principle is simple: when an error is expected and you know its cause, return an appropriate status and a useful explanation. Do not treat every rejected request as an internal server failure.

> **When should you use `HttpError`?**
>
> Use it when you know why a request should be rejected and want to choose the HTTP status explicitly, such as when a resource does not exist or an input value is invalid. For unexpected failures, such as a programming bug or an unforeseen internal operation failure, let the error handler handle the exception.

## Custom error handler

To make error responses consistent across your application, register a handler with `app.onError()`:

```ts
app.onError((error, ctx) => {
  if (error instanceof HttpError) {
    return json(
      {
        error: error.message,
        details: error.body,
      },
      error.status,
    );
  }

  console.error("Request failed:", error);

  return json(
    { error: "Internal Server Error" },
    500,
  );
});
```

The handler receives the error and the request context, then chooses the appropriate response:

1. **For an `HttpError`:** It returns the status you specified along with error information.
2. **For an unexpected error:** It logs the failure on the server and returns a generic `500 Internal Server Error` response.

This gives you control over how errors are presented instead of relying entirely on the default behavior.

### Why hide internal error details?

Unexpected errors can contain information that should not be exposed to clients, including file paths, server internals, or details that could help someone exploit a vulnerability.

Follow two rules:

- Log unexpected errors on the server so you can investigate them.
- Return a generic message to the client without exposing implementation details or secrets.

Without a custom handler, Barq hides unexpected error details in production. In development, additional details can be shown when `development: true` is enabled or `NODE_ENV=development` is set.

**Important:** When you write a custom error handler, you are responsible for the response it returns. Make sure you do not accidentally expose internal details in production.

## Customize the not-found response

When a request does not match any registered route, use `app.notFound()` to customize the response:

```ts
app.notFound((ctx) => {
  return json(
    {
      error: "Not Found",
      path: ctx.pathname,
    },
    404,
  );
});
```

This example returns a `404 Not Found` response containing the requested pathname. Including the path can help identify which URL failed to match a route. You can also adjust the response body to match the error format used elsewhere in your application.

For example, if a client requests `/orders/123/details` and no route matches that path, Barq uses the `notFound` handler to return the fallback response.

### `404` vs. `405`

These status codes represent different situations:

- **`404 Not Found`:** No route matches the request.
- **`405 Method Not Allowed`:** The route exists, but the HTTP method used is not allowed for that route.

For example, if your application defines only `GET /orders`, a `GET /orders` request matches the route, while a `POST /orders` request uses a different method. Under the Barq behavior described here, a method that is not allowed results in `405`, not `404`.

Do not assume that every request that fails to produce the expected response will reach `notFound`. This handler is intended for requests that do not match a route.

## Best practices

- Use `HttpError` for expected errors that require a specific HTTP status.
- Use `app.onError()` to centralize error handling and log unexpected failures.
- Use `app.notFound()` to return a clear response when no route matches.
- Choose status codes that accurately describe the problem. Do not use `500` for expected client input errors.
- Never expose stack traces, secrets, or sensitive server details in production responses.
- Keep error response formats consistent so clients can handle them predictably.

With these tools, you can distinguish between expected application errors, unexpected failures that need investigation, and requests that do not match a route—while keeping responses clear and secure.