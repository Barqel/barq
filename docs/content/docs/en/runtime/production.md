---
title: Production and Security
description: Prepare Barq HTTP applications on Bun or Node.js with secure proxy trust, secret management, resource limits, and input validation.
---

Barq provides building blocks for HTTP and WebSocket applications, but **application security is a shared responsibility between the framework, your application, and its deployment environment**. The framework cannot determine which proxies you trust, protect every secret automatically, or choose the right resource limits for every service.

This guide covers the key settings and practices to review before running a Barq application in production.

> **Runtime support:** HTTP applications run on Bun or Node.js through `@barqel/barq/node`. The Node.js adapter does not apply Bun server limits, TLS settings, WebSockets, clustering, or `app.stop()`; configure equivalent limits in your Node.js server or reverse proxy. Call `await server.stop()` to close a Node.js adapter server.

## Trust only known proxies

A Barq application may run behind a reverse proxy such as Nginx or behind a load balancer. In this setup, the proxy may add headers such as `X-Forwarded-For` to indicate the original client's IP address.

These headers are not automatically trustworthy. A client may supply forged forwarding headers if proxy trust is configured incorrectly.

By default, Barq ignores forwarding headers and uses the IP address Bun sees on the direct connection. If your application runs behind a reverse proxy, explicitly configure the proxies you trust:

```ts
import { App } from "@barqel/barq";

const app = new App({
  trustProxy: ["127.0.0.1", "::1", "10.20.0.0/16"],
});
```

This example trusts the local loopback addresses and an internal network range. **Use only the actual addresses and networks of your proxies.** These values are illustrative, not a universal production configuration.

### How proxy trust works

When `trustProxy` is enabled, Barq examines the `X-Forwarded-For` chain starting from the nearest hop toward the client, stopping at the first untrusted address according to the configured trust rules.

This helps the application determine the client address without blindly trusting every address listed in the header.

The configuration also supports:

```ts
const app = new App({
  trustProxy: true,
});
```

However, `true` trusts every hop. This can be unsafe if clients can connect directly to your application or provide forged forwarding headers.

Follow these practices:

- Enable proxy trust only when you need it.
- Specify known IP addresses or network ranges instead of enabling unrestricted trust.
- Restrict network access so clients cannot bypass the trusted proxy.
- Do not rely on the resolved client IP for sensitive security decisions unless your proxy configuration is correct.

## Keep error details private

Detailed error messages can expose internal routes, database information, or implementation details. Your application should handle errors differently in development and production.

Set the application to production mode:

```ts
import { App } from "@barqel/barq";

const app = new App({
  development: false,
});
```

For unexpected exceptions, Barq includes the error message and stack trace only when development mode is enabled; otherwise, it returns a generic `500` response. Ensure that a custom `onError()` handler preserves this boundary and does not expose internal details to clients.

### Log details on the server

Record diagnostic information in server-side logs so you can investigate failures while returning a general, appropriate response to the client.

For example, a client usually needs to know that a request failed, not the full database exception or an internal file path.

Logs can also contain sensitive information. Do not log passwords, access tokens, or secrets simply to make debugging easier.

## Protect cookies and secrets

Your application may rely on cookie-signing secrets, API keys, and TLS private keys. Treat these values as secrets that do not belong in your source repository.

### Store secrets securely

Read `cookieSecret`, API keys, and TLS keys from environment variables or a secrets manager appropriate for your deployment.

Avoid hardcoding real secrets:

```ts
// Illustrative example only. Never commit a real secret.
const cookieSecret = process.env.COOKIE_SECRET;
```

Validate the presence and suitability of required secrets when the application starts, rather than running with empty or insecure default values.

Use a high-entropy signing secret and define a rotation policy appropriate to your service. Account for the impact of changing a secret on existing cookies or signed data.

### Cookie security settings

When using cookies, review these security options:

- `secure: true`: Requests that the cookie be sent only over HTTPS connections.
- `HttpOnly`: Prevents browser JavaScript from directly reading the cookie, reducing exposure to certain cookie-theft attacks.
- `SameSite`: Helps control whether the cookie is sent with cross-site requests, depending on the setting and use case.

Keep `HttpOnly` enabled unless browser JavaScript genuinely needs access to the cookie.

**Signing a cookie does not encrypt it.** Signing helps detect unauthorized modification, but it does not make the contents confidential. Do not store passwords, API keys, or other secrets in cookie values simply because the cookies are signed.

## Limit resource consumption

Large requests, long-lived connections, and unbounded data streams can consume server resources. Configure limits that fit your application's workload instead of leaving resources unrestricted.

Barq provides important settings, including:

- `maxRequestBodySize`: The maximum request-body size.
- `idleTimeout`: The timeout for an idle connection.
- WebSocket payload limits: To restrict the size of messages accepted by the application.
- Backpressure: To handle incoming work when demand exceeds available processing capacity.

Choose values based on expected payload sizes, connection counts, and available resources. There is no single configuration suitable for every application: an API that accepts large images has different requirements from a service that receives only small JSON messages.

### Long-running requests

Keep timeouts enabled for ordinary requests. If a specific request needs a long-running stream, you can use `ctx.disableTimeout()` to disable the timeout for that request, according to Barq's behavior.

Do not disable timeouts for every request just to support one special case. Unbounded connections can consume resources and affect other users.

Test resource limits under realistic load and monitor memory usage, connection counts, and request-processing times.

## Validate client input

Do not assume incoming data is valid just because TypeScript assigns types to it in your code. Type annotations do not validate data at runtime.

### Path and query parameters

Path and query parameters are strings. If you expect a number or a value with specific constraints, validate and convert it before use.

```ts
app.get("/users/:id", (ctx) => {
  const id = Number(ctx.params.id);

  if (!Number.isSafeInteger(id) || id <= 0) {
    return json({ error: "Invalid user ID" }, 400);
  }

  return json({ id });
});
```

This example illustrates why an identifier should be validated before use. It assumes `json` is available in the application's scope, as in other Barq examples.

### JSON request bodies

Use `validateJson()` to validate request bodies with a Standard Schema-compatible schema or a custom validation function.

```ts
app.post(
  "/users",
  validateJson(CreateUserSchema, (ctx, body) => {
    return json({ user: body }, 201);
  }),
);
```

This prevents the route handler from relying on unverified assumptions about the shape of incoming data.

Structural validation does not replace authorization or business-rule checks. Even if a request body has valid types, the user may not be allowed to perform the operation or access the requested resource.

## Production deployment

Before deploying your application, ensure that the process lifecycle, network configuration, secrets, and timeouts are appropriate for production.

### Run under a process supervisor

Run your Bun or Node.js entry point under a process supervisor or container platform that can restart a failed process. This helps restore service after unexpected crashes, but it does not replace monitoring or investigating the cause of failures.

Ensure that your runtime environment also handles the `SIGTERM` signal, which is commonly used to request an orderly process shutdown.

### Stop the application gracefully

On Bun, Barq provides `app.stop()` to stop the HTTP server and drain requests. With the Node.js adapter, `app.stop()` does not stop the HTTP server; retain the handle returned by `app.listen()` and call `await server.stop()` to close it. The adapter does not drain in-flight requests.

Use a clear shutdown sequence:

1. Stop accepting new work using the mechanism supported by your runtime environment.
2. Allow in-flight requests a reasonable amount of time to finish.
3. Call the appropriate Barq shutdown mechanism.
4. Ensure the process exits within the shutdown deadline configured by your platform.

Neither shutdown method closes external resources created by your application, such as database connections or background workers. Close those resources in your own shutdown sequence.

### Configure TLS

You can configure TLS directly in Bun or terminate TLS at a trusted reverse proxy in front of the application. The Node.js adapter uses plain HTTP; terminate TLS at a proxy when using that adapter.

In either setup:

- Never commit private keys to your repository.
- Restrict access to certificate and key files to the processes that need them.
- Monitor certificate expiration and renewal.
- If TLS terminates at a reverse proxy, protect the connection between the proxy and the application according to your deployment requirements.

## Pre-release checklist

- [ ] Set `development: false`.
- [ ] Trust only known proxies when `trustProxy` is required.
- [ ] Store secrets outside the repository and validate them at startup.
- [ ] Review cookie settings, especially `Secure`, `HttpOnly`, and `SameSite`.
- [ ] Configure request-size limits, timeouts, and WebSocket message limits in the selected runtime or reverse proxy.
- [ ] Validate client input with `validateJson()` or appropriate explicit checks.
- [ ] Ensure error details and secrets are not exposed to clients or logs.
- [ ] Test graceful shutdown and process recovery after failures.
- [ ] Verify TLS configuration and certificate renewal.

Production security is not a single option or setting. It is a set of complementary decisions that determine who can reach your application, which data it accepts, how it handles failures, and how much of your resources each request can consume.