---
title: Server Configuration and Shutdown
description: Configure HTTP servers for Bun and Node.js, noting Bun-only TLS, clustering, and lifecycle options in Barq.
---

Barq gives you direct control over your HTTP server and its lifecycle, from the listening address and resource limits to an orderly shutdown when restarting the application or deploying a new release.

In this guide, you will learn how to configure the server, handle shutdown signals, and run multiple workers on Linux.

> **Runtime support:** Node.js supports HTTP through `@barqel/barq/node` and honors the `hostname` and `port` options. TLS, Bun server limits, WebSockets, worker clustering, and `app.stop()` are Bun-specific. The Node.js adapter returns a server handle; call `await server.stop()` to close it. It does not provide graceful connection draining.

## Configuring the server

Create an application with `App`, then call `app.listen()` to start accepting requests.

```ts
import { App } from "@barqel/barq";

const app = new App({
  hostname: "127.0.0.1",
  port: 3000,
  idleTimeout: 30,
  maxRequestBodySize: 1_048_576,
  development: false,
});

const server = app.listen();

console.log(`Listening on ${server.hostname}:${server.port}`);
```

### Understanding the server options

| Option | Purpose | Example |
| --- | --- | --- |
| `hostname` | The network address the server binds to. | `127.0.0.1` for local connections only. |
| `port` | The default listening port. | `3000` |
| `idleTimeout` | The allowed idle connection timeout, in seconds. | `30` |
| `maxRequestBodySize` | The maximum request body size, in bytes. | `1_048_576`, or 1 MiB. |
| `development` | Controls whether the application runs in development mode. | `false` in this production-oriented example. |
| `tls` | Bun's TLS options for serving HTTPS. | Certificate and key settings supported by Bun. |

Configure only the options your application needs. Avoid increasing resource limits without a clear reason.

### Choosing a listening address and port

The `hostname` option specifies the network address the server binds to. For example:

- `127.0.0.1`: accepts local connections from the same machine.
- `0.0.0.0`: listens on available network interfaces, subject to network and firewall configuration.

If other devices need to reach your server, make sure the binding address and network rules allow those connections. Do not choose `0.0.0.0` simply because it is convenient; use it when external access is required.

You can set the port when creating the application:

```ts
const app = new App({
  hostname: "127.0.0.1",
  port: 3000,
});

const server = app.listen();
```

Or pass it directly to `listen(port?)`:

```ts
const server = app.listen(4000);
```

A port passed to `listen(port?)` takes precedence over the `port` value supplied to the constructor.

If neither location specifies a port, Bun may select an available port automatically. Read `server.port` to discover the actual port instead of assuming it matches a fixed value.

### Setting resource limits

Both `maxRequestBodySize` and `idleTimeout` affect how the server handles requests and connections.

**`maxRequestBodySize` — maximum request body size**

The value is measured in bytes. In the following example, a request body can be up to 1 MiB:

```ts
const app = new App({
  maxRequestBodySize: 1_048_576,
});
```

This limit matters when accepting JSON, form submissions, or files. Choose a size that matches the data your application expects. Avoid accepting unnecessarily large bodies, since appropriate limits help control memory and resource usage.

The value must be a non-negative safe integer.

**`idleTimeout` — idle connection timeout**

The value is measured in seconds and must be between `0` and `255`. A value of `0` disables the timeout.

```ts
const app = new App({
  idleTimeout: 30,
});
```

Choose a timeout that fits your application's connection patterns. Do not assume that a timeout suitable for ordinary HTTP requests is also suitable for long-lived connections such as WebSockets. Review the requirements for each connection type and the relevant Bun settings.

### Serving HTTPS with TLS

The `tls` option accepts TLS settings provided by Bun. This option is not implemented by the Node.js HTTP adapter. Use it when a Bun application needs to accept HTTPS connections directly:

```ts
const app = new App({
  port: 3000,
  tls: {
    // Add TLS options supported by Bun,
    // such as certificate and key paths.
  },
});
```

This is an illustrative example. Supply actual certificate and key values according to Bun's configuration and your deployment environment. Do not commit private keys or sensitive credentials to a public repository.

If HTTPS is terminated by a reverse proxy such as Nginx or by your hosting platform, you may not need to configure TLS inside the application.

## Graceful shutdown

When the application receives a shutdown signal such as `SIGINT` or `SIGTERM`, it is better to stop it in an orderly way than to terminate the process immediately. The `app.stop()` lifecycle method described here applies to Bun's server.

Call `await app.stop(hardTimeoutMs?)` to begin shutdown and wait for the result:

```ts
let stopping = false;

async function shutdown() {
  if (stopping) return;
  stopping = true;

  const result = await app.stop(5_000);

  console.log("Stopped", result);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
```

The `stopping` flag prevents the shutdown routine from running more than once if multiple signals arrive. The `5_000` millisecond timeout allows five seconds before the hard shutdown limit is reached.

### Understanding the shutdown result

The result includes two fields:

- `forced`: indicates whether reaching the hard timeout caused shutdown to be forced.
- `pending`: reports information about remaining connections according to Bun's shutdown result.

The default timeout is five seconds when no other value is supplied.

Graceful shutdown does not guarantee that every request will finish. Connections or ongoing work may remain until the timeout expires. Test shutdown behavior with your actual application, especially if it handles long-running requests or important tasks.

### When should you use graceful shutdown?

Use it when:

- Restarting the application.
- Deploying a new release.
- Stopping a service as part of an automated deployment.
- Shutting down in response to operating-system signals.

In production, make sure your process manager or deployment platform gives the application enough time to shut down before forcibly terminating the process.

## Running multiple workers on Linux

`app.cluster(port?)` is a Bun-only way to run multiple workers on Linux. It starts one Bun worker per logical CPU and uses `reusePort` to share the port.

```ts
const app = new App();

app.cluster(3000);
```

Pass a fixed, non-zero port when using `cluster()` on Linux.

Multiple workers can process requests across separate processes and may help use available CPU resources more effectively. Actual performance depends on your application, resource usage, and workload. Measure the results rather than assuming that adding workers will always improve performance.

### What happens on other operating systems?

- **Linux:** `cluster()` starts multiple workers using `reusePort`.
- **macOS and Windows:** `cluster()` starts a single listener in one process.

Do not assume that calling `cluster()` creates multiple processes on every operating system.

### Stopping the server

Use `app.stop()` to stop the server through Barq's shutdown mechanism:

```ts
await app.stop();
```

When using Bun clustering, `app.stop()` also stops the worker processes started by `app.cluster()`. It does not close resources managed by your application, such as database connections; shut those down separately.

## Best practices

- Set `hostname` and `port` according to your runtime environment and how clients reach the server.
- Choose an appropriate request body limit instead of accepting unnecessarily large payloads.
- Set idle timeouts according to the application's connection patterns.
- Read `server.port` when Bun may choose a port automatically.
- Handle `SIGINT` and `SIGTERM`, and test shutdown while requests are still running.
- Use `cluster()` on Linux when needed, then compare performance before and after enabling it.
- Keep certificates, private keys, and sensitive credentials out of source code.
