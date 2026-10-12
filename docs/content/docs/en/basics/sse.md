---
title: Server-Sent Events (SSE)
description: Zero-dependency, high-performance Server-Sent Events (SSE) streaming for real-time updates and LLM responses in Barq.
---

# Server-Sent Events (SSE)

The `@barqel/barq-sse` plugin provides Server-Sent Events streaming based on the WHATWG specification, built on Web Streams with automatic timeout management, heartbeat pings, and AsyncIterable streaming.

## Installation

```bash
bun add @barqel/barq-sse
```

## Quick Start

```ts
import { App } from "@barqel/barq";
import { sse } from "@barqel/barq-sse";

const app = new App();

app.get("/events", (ctx) => {
  return sse(ctx, async (emitter) => {
    emitter.send({ event: "connected", data: "welcome" });

    for (let i = 1; i <= 3; i++) {
      if (emitter.isClosed) break;
      await Bun.sleep(1000);
      emitter.send({
        id: i,
        event: "counter",
        data: { value: i },
      });
    }

    emitter.close();
  });
});

app.listen(3000);
```

## LLM / AI Token Streaming

Stream directly from AsyncIterables or generator functions:

```ts
import { sseStream } from "@barqel/barq-sse";

async function* tokenGenerator() {
  yield "Hello";
  yield " ";
  yield "world!";
}

app.get("/chat", (ctx) => {
  return sseStream(
    ctx,
    tokenGenerator(),
    (token) => ({ event: "delta", data: token }),
  );
});
```

## Client Disconnection & Heartbeats

The emitter automatically listens to `ctx.req.signal` for client aborts and closes resources. Automatic `: ping\n\n` comments are sent periodically to keep the connection alive across reverse proxies like Nginx.

## Configuration Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `heartbeatIntervalMs` | `number` | `15000` | Keep-alive ping comment interval in milliseconds (0 to disable) |
| `retry` | `number` | `undefined` | Client reconnection delay hint sent on initial connection |
| `headers` | `Record<string, string>` | `undefined` | Additional HTTP response headers |
