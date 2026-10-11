---
title: Responses and Redirects
description: Return JSON, text, and empty HTTP responses, set headers, and redirect safely in Barq apps on Bun and Node.js.
---

Every HTTP request ends with a response from the server. That response might contain JSON data, plain text, no body at all, or a redirect to another URL.

Barq provides small helpers for common response types. When you need more control over the response, you can also return a standard `Response` object.

## Response types

A route handler can return a standard `Response` object or a value that Barq converts into an HTTP response.

For example, a route can return a user as JSON, a plain-text message, or a response indicating that a new resource was created.

Choosing the right response type makes your API easier to understand and helps clients interpret the result correctly.

## JSON, text, and empty responses

Barq provides three main helpers for common responses:

- `json()` returns data as JSON.
- `text()` returns plain text.
- `empty()` returns a response without a body.

```ts
import { empty, json, text } from "@barqel/barq";

// JSON data.
return json({ id: "u-42" });

// JSON with a status indicating that a resource was created.
return json({ created: true }, 201);

// JSON with an error status.
return json({ error: "Not found" }, { status: 404 });

// Plain text with an HTTP status.
return text("Accepted", 202);

// Empty response, with 204 as the default status.
return empty();
```

These examples are alternatives for different route handlers. Do not put all of the `return` statements into one handler if you expect every statement to run: the first executed `return` ends the handler.

### 1. Return JSON with `json()`

Use `json()` when you want to send an object, array, or another value suitable for JSON representation.

```ts
app.get("/users/:id", (ctx) => {
  return json({
    id: ctx.params.id,
    name: "Mona",
  });
});
```

The response might look like this:

```json
{
  "id": "42",
  "name": "Mona"
}
```

The example reads the user ID from the route parameter and returns the user's data as JSON.

By default, `json()` sets the `Content-Type` header to:

`application/json; charset=utf-8`

You can specify another content type through the response options supported by the helper.

You can also set the HTTP status using the supported call forms:

```ts
// Pass the status directly.
return json({ created: true }, 201);

// Pass response options.
return json(
  { error: "Not found" },
  { status: 404 },
);
```

Use `201 Created` when the operation has actually created a resource, and `404 Not Found` when the requested resource does not exist. Choosing the correct status makes your API easier for clients and monitoring tools to interpret.

### 2. Return text with `text()`

If the response is a simple text message, there is no need to wrap it in JSON:

```ts
app.get("/status", () => {
  return text("Service is running");
});
```

You can also specify an HTTP status:

```ts
return text("Accepted", 202);
```

When a status or response options are supplied, `text()` sets the content type to `text/plain; charset=utf-8`, according to the Barq interface described here.

Use `text()` when the text itself is the intended result, such as a short message or simple text content. If you need to return multiple fields, such as a result code, a message, and additional data, JSON is usually a better choice.

### 3. Return an empty response with `empty()`

Some operations do not need to return a response body. Barq provides this helper:

```ts
empty(status?, headers?)
```

For example:

```ts
app.post("/jobs/:id/cancel", (ctx) => {
  cancelJob(ctx.params.id);

  return empty();
});
```

`empty()` returns a response without a body. Its default status is `204 No Content`.

A `204` response indicates that the server completed the operation successfully and has no response content to send.

You can also specify the status and headers:

```ts
return empty(204, {
  "X-Operation": "completed",
});
```

Use an empty response when the client does not need additional data after the operation. If you need to return a message, a result, or details about a newly created resource, use `json()` or `text()` instead.

**Important:** Some HTTP statuses do not permit a response body, even if you try to create a response that contains one. Barq sends those responses without a body.

## When should you use the standard `Response`?

The `json()`, `text()`, and `empty()` helpers cover most common cases. Sometimes, however, you need direct control over the response, such as setting multiple headers or returning a streaming body.

In those cases, you can create and return a standard `Response` object:

```ts
app.get("/custom-response", () => {
  return new Response("Custom response", {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-App-Version": "1.0.0",
    },
  });
});
```

This example shows how to set the status and headers directly when constructing a response.

Using the standard `Response` gives you direct control over the response interface. It is useful when you need features that are not covered by the shorter helpers, including certain streaming scenarios.

Do not use it just because it is more explicit. The helpers make your code shorter and easier to read when they provide everything you need.

## Redirects

A redirect is a response that tells the client to navigate to another URL. For example, you might redirect a page after its URL changes or send a user to a result page after an operation completes.

Barq supports two redirect helpers:

```ts
redirect(url, status?)
ctx.redirect(url, status?)
```

They support the following redirect statuses:

- `301 Moved Permanently`: Indicates a permanent move.
- `302 Found`: Indicates a temporary redirect.
- `303 See Other`: Directs the client to another resource, commonly a result page after a form submission.
- `307 Temporary Redirect`: A temporary redirect that preserves the request method.
- `308 Permanent Redirect`: A permanent redirect that preserves the request method.

### Example: redirect to another URL

```ts
app.get("/old-docs", (ctx) => {
  return ctx.redirect(
    "https://docs.example.com",
    302,
  );
});
```

This route returns a temporary redirect to the documentation site.

`ctx.redirect()` lets you redirect from within a route handler. The standalone `redirect()` helper lets you create a redirect response without relying on the request context.

Choose the status based on the meaning of the operation, rather than treating all redirect statuses as interchangeable. Whether the request method is preserved can matter, especially when redirecting `POST` requests.

## Validating redirect destinations

Redirecting to an unvalidated, user-supplied URL can create an **open redirect** vulnerability. An attacker might exploit it to send users to a misleading external website.

Barq therefore restricts the accepted destination formats. A destination must be one of the following:

- A root-relative path, such as `/account`.
- An absolute HTTP or HTTPS URL, such as `https://docs.example.com`.

Protocol-relative URLs such as `//host/path`, along with URLs containing backslashes or control characters, are rejected.

### Allowing specific hosts

If your application needs to redirect to specific external domains, you can configure an allowlist when creating the application:

```ts
const app = new App({
  allowedRedirectHosts: ["docs.example.com"],
});
```

In this example, the allowlist specifies the external host permitted for redirects through `ctx.redirect()`.

`ctx.redirect()` enforces the configured host allowlist. The standalone `redirect()` helper accepts an optional third argument of type `ReadonlySet<string>` for specifying allowed hosts:

```ts
redirect(url, status?, allowedHosts?)
```

If you do not pass a list to the standalone helper, it does not restrict hosts in absolute HTTP or HTTPS URLs.

**Best practice:** Never use a user-supplied value directly as a redirect destination. Validate the destination, and prefer internal paths or a defined list of trusted hosts.

## `HEAD` requests

The HTTP `HEAD` method requests response metadata without requiring the response body. Its purpose is similar to `GET`, but the client does not need the response content.

Barq removes response bodies for `HEAD` requests while preserving response metadata.

If you need custom behavior for this method, you can register a dedicated handler with `head()`:

```ts
app.head("/status", () => {
  return empty();
});
```

This illustrative handler returns an empty response for `HEAD`. You can return appropriate headers or a status based on the route's requirements.

### When do you need a custom `HEAD` handler?

A dedicated handler can be useful when you need control over the metadata returned by a route or have specific requirements for `HEAD`.

If Barq's default behavior already meets your needs, there is no reason to add a separate handler unnecessarily.

Remember that a `HEAD` response body is not sent to the client, so do not rely on reading the response body to determine the result of the request.

## Best practices

- Use `json()` for structured data, `text()` for plain text, and `empty()` when no body is needed.
- Choose an HTTP status that accurately describes the operation's result.
- Use the standard `Response` when you need direct control over headers or the response body.
- Choose redirect statuses based on whether the redirect is temporary or permanent and whether the request method should be preserved.
- Validate redirect destinations and reject untrusted external URLs.
- Use `HEAD` when the client needs response metadata without a body.
- Do not assume every response type permits a body; some HTTP statuses require an empty response.

By choosing the right helper, status code, and redirect validation strategy, you can build clear, safe responses that clients can handle reliably.