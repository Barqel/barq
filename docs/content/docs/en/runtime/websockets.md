---
title: WebSocket Connections
description: Configure Barq WebSocket routes on Bun, authenticate before upgrade, pass session data, and set message and resource limits.
---

WebSocket connections let you build features that exchange data in real time, such as live chat, instant notifications, and live dashboards.

Barq's WebSocket API uses Bun's native WebSocket engine. It is available when running on Bun; the Node.js HTTP adapter does not implement WebSocket upgrades. On Bun, you can register a route, validate a request before upgrading the connection, pass user data to event handlers, and configure resource limits.

## Creating a WebSocket connection

Use `app.ws()` to register a WebSocket route and define handlers for connection events, incoming messages, and connection closure.

The following example creates a chat endpoint at `/chat`:

```ts
import { App, type WebSocketHandlers } from "@barqel/barq";

interface SocketSession {
  userId: string;
  role: string;
}

const handlers: WebSocketHandlers<SocketSession> = {
  open(ws) {
    console.log(`Connected: ${ws.data.userId}`);
    ws.send(`Welcome ${ws.data.userId}!`);
  },

  message(ws, msg) {
    ws.send(`Echo: ${msg}`);
  },

  close(ws, code, reason) {
    console.log(`Disconnected: ${ws.data.userId}`);
  },
};

const app = new App();

app.ws(
  "/chat",
  handlers,
  (ctx) => {
    const token = ctx.queryParam("token");

    if (!token) return false;

    return {
      data: {
        userId: "user_42",
        role: "moderator",
      },
    };
  },
);

app.listen(3000);
```

This example has three main parts: session data, event handlers, and request validation before the connection is upgraded.

## Understanding event handlers

`WebSocketHandlers<SocketSession>` defines the functions used to handle the connection lifecycle.

### `open(ws)`

Runs when a WebSocket connection opens successfully.

In this example, the handler reads `ws.data.userId` to identify the user and sends a welcome message:

```ts
open(ws) {
  console.log(`Connected: ${ws.data.userId}`);
  ws.send(`Welcome ${ws.data.userId}!`);
}
```

Use this event to initialize connection state or send an initial message to the client.

### `message(ws, msg)`

Runs when a message arrives from the client.

```ts
message(ws, msg) {
  ws.send(`Echo: ${msg}`);
}
```

The example echoes the message back with an `Echo:` prefix, making it useful for testing the connection. In a real application, you can parse the message, validate its contents, and perform the appropriate action.

Do not assume that incoming messages or their contents are trustworthy. Validate the message type, structure, and user permissions before performing sensitive operations.

### `close(ws, code, reason)`

Runs when the connection closes. It receives the close code and reason along with the WebSocket object.

```ts
close(ws, code, reason) {
  console.log(`Disconnected: ${ws.data.userId}`);
}
```

Use this event to clean up connection state or record the reason for closure. If your application maintains a list of connected users, update it when necessary.

## Authenticating before the connection upgrade

The third argument to `app.ws()` lets you provide a `beforeUpgrade` function that validates a request before a WebSocket connection is established.

```ts
app.ws(
  "/chat",
  handlers,
  (ctx) => {
    const token = ctx.queryParam("token");

    if (!token) return false;

    return {
      data: {
        userId: "user_42",
        role: "moderator",
      },
    };
  },
);
```

In this example:

1. `ctx.queryParam("token")` reads the `token` query parameter from the request URL.
2. If the token is missing, the function returns `false` to reject the upgrade.
3. If the request passes validation, the function returns an object containing `data`.
4. The session data is made available to WebSocket handlers through `ws.data`.

**Important:** The presence of a token does not prove that a user is authenticated. In a real application, validate the token, its signature, expiration, and the permissions of its owner before accepting the connection. The example shows where validation belongs; it does not implement complete token verification.

### Passing session data

Use `SocketSession` to define the shape of the data available to your handlers:

```ts
interface SocketSession {
  userId: string;
  role: string;
}
```

Then return the session data from `beforeUpgrade`:

```ts
return {
  data: {
    userId: "user_42",
    role: "moderator",
  },
};
```

Your event handlers can then read these values from `ws.data`:

```ts
open(ws) {
  console.log(ws.data.userId);
  console.log(ws.data.role);
}
```

This approach makes session information available to handlers without requiring them to extract it from the request again for every event.

In this example, `userId` and `role` are hard-coded for demonstration. In a real application, session data should come from the actual authentication result, not from client-supplied values or fixed values in the source code.

### Connecting from a client

A client can connect to `/chat` and include a token in the connection URL:

```ts
const socket = new WebSocket(
  "ws://localhost:3000/chat?token=YOUR_TOKEN",
);
```

Replace `YOUR_TOKEN` with a valid token for your application environment. Never use a real token in public examples or open repositories.

Keep in mind that authentication tokens in URLs may appear in server logs or monitoring tools. For sensitive applications, choose an authentication method appropriate to your environment and check whether your Barq version supports passing authentication data through upgrade request headers.

## Configuring message and resource limits

The `websocket` option lets you configure limits for incoming message size, queued outgoing data, and idle connections:

```ts
const app = new App({
  websocket: {
    maxPayloadLength: 64 * 1024,
    backpressureLimit: 256 * 1024,
    idleTimeout: 60,
  },
});
```

These values are examples. Choose limits based on your message patterns and expected number of connections, and configure them using the WebSocket options in `AppOptions`.

### `maxPayloadLength`

Sets the maximum incoming message size in bytes, according to the behavior of the configured option.

In this example:

```ts
maxPayloadLength: 64 * 1024
```

The value is 65,536 bytes, or 64 KiB.

Choose a limit based on the size of messages your application expects. Avoid allowing unnecessarily large messages; an appropriate limit helps control resource usage caused by oversized payloads.

### `backpressureLimit`

Sets the allowed limit for backpressure caused by outgoing data that has not yet been sent, according to Barq's implementation.

```ts
backpressureLimit: 256 * 1024
```

This value is 256 KiB.

Backpressure can occur when the server sends data faster than a client can receive it. An appropriate limit helps control the amount of queued data, but verify what happens when the limit is reached: are messages rejected, dropped, or does the connection close?

Do not assume this option guarantees delivery of every message. If messages are important, design your application protocol to handle failures, reconnections, or acknowledgments where necessary.

### `idleTimeout`

Sets the idle timeout in seconds, according to the configured WebSocket behavior:

```ts
idleTimeout: 60
```

In this example, the value is 60 seconds.

Choose a timeout that matches the connection's purpose. Chat applications and live dashboards may need long-lived connections, while terminating idle connections can help reduce resource usage.

Check the definition of `idleTimeout` in Barq's implementation and Bun's settings to confirm what counts as idle and whether messages or periodic connection signals affect the timeout.

## Best practices

- Authenticate users and verify their permissions before accepting WebSocket connections.
- Do not treat the presence of a `token` as proof of valid authentication.
- Use `SocketSession` to define the session data available to event handlers.
- Validate incoming messages before performing sensitive operations.
- Set `maxPayloadLength` according to expected message sizes.
- Configure `backpressureLimit` to match your sending rate and clients' ability to receive data.
- Choose an appropriate idle timeout and test network interruptions and reconnections.
- Never log secret tokens or sensitive authentication data.
- Test resource limits under realistic conditions before using them in production.
