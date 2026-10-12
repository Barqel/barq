---
title: API Gateway (Proxy)
description: Zero-dependency, high-performance HTTP reverse proxy and API Gateway plugin for Barq.
---

# API Gateway (Proxy)

The `@barqel/barq-proxy` plugin transforms Barq into a lightning-fast reverse proxy and API Gateway, securely forwarding requests to backend microservices, stripping hop-by-hop headers, and handling data streams effortlessly.

## Installation

```bash
bun add @barqel/barq-proxy
```

## Quick Start

Route traffic matching a specific prefix to a backend service:

```ts
import { App } from "@barqel/barq";
import { proxy } from "@barqel/barq-proxy";

const app = new App();

app.all(
  "/api/billing/*path",
  proxy({
    target: "http://billing-service:8080",
    changeOrigin: true,
    pathRewrite: (path) => path.replace("/api/billing", ""),
  }),
);

app.listen(3000);
```

## Intercepting Requests and Responses

You can dynamically inject headers or inspect responses before they are sent to the client using `onProxyReq` and `onProxyRes`:

```ts
app.all(
  "/api/secure/*path",
  proxy({
    target: "http://internal-secure-api:4000",
    headers: {
      "X-Gateway-Secret": process.env.GATEWAY_SECRET,
    },
    onProxyReq: async (reqInit, ctx) => {
      // Add dynamic headers
      (reqInit.headers as Headers).set("X-Request-Id", ctx.state.requestId);
    },
    onProxyRes: async (proxyRes, ctx) => {
      // Modify response headers
      const headers = new Headers(proxyRes.headers);
      headers.delete("Server"); 
      headers.set("X-Proxy-Cache", "MISS");
      
      return new Response(proxyRes.body, {
        status: proxyRes.status,
        headers,
      });
    },
  }),
);
```

## Configuration Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `target` | `string` | **Required** | The target URL to proxy requests to (e.g., `http://localhost:8080`) |
| `changeOrigin` | `boolean` | `false` | Updates the `Host` header to match the target URL |
| `pathRewrite` | `(path, ctx) => string \| Promise<string>` | `undefined` | Function to dynamically rewrite the URL path |
| `headers` | `Record<string, string> \| Function` | `undefined` | Additional headers to append to the proxied request |
| `onProxyReq` | `(reqInit, ctx) => void` | `undefined` | Hook triggered before the request is forwarded |
| `onProxyRes` | `(proxyRes, ctx) => Response` | `undefined` | Hook triggered before the response is sent back |
