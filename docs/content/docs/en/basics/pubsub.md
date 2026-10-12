---
title: WebSocket Pub/Sub
description: Zero-dependency, high-performance WebSocket rooms and broadcasting plugin for Barq on Bun.
---

# WebSocket Pub/Sub (Rooms)

The `@barqel/barq-pubsub` plugin adds real-time room management and broadcasting to Barq WebSockets. It acts as a lightweight wrapper that transparently utilizes Bun's ultra-fast native C++ `ServerWebSocket.publish()` and `subscribe()` functions while maintaining an exact in-memory state map for features like room sizing and HTTP-to-WebSocket broadcasting.

## Installation

```bash
bun add @barqel/barq-pubsub
```

## Quick Start

Register the plugin and use the `pubsub` registry to manage subscriptions and broadcast messages:

```ts
import { App, json } from "@barqel/barq";
import { pubsubPlugin, type PubSubRegistry } from "@barqel/barq-pubsub";

const app = new App();

app.plugin(pubsubPlugin());
const pubsub = (app as any).pubsub as PubSubRegistry;

app.ws("/chat", {
  message(ws, msg) {
    const data = JSON.parse(msg.toString());
    
    if (data.action === "join") {
      pubsub.subscribe(ws, data.room);
    } 
    else if (data.action === "send") {
      pubsub.publish(data.room, JSON.stringify({ text: data.text }));
    }
  },
  close(ws) {
    pubsub.unsubscribeAll(ws); // Prevent memory leaks
  }
});

// Broadcast to a WebSocket room from a standard HTTP route
app.post("/api/alert", async (ctx) => {
  pubsub.publish("general", "System maintenance in 5 minutes!");
  return json({ success: true });
});

app.listen(3000);
```

## API Reference

### `subscribe(ws, room)`
Adds the socket to the specified room string. Internally calls native `ws.subscribe()` if available.

### `unsubscribe(ws, room)`
Removes the socket from the room.

### `unsubscribeAll(ws)`
Removes the socket from all subscribed rooms. Always call this inside your WebSocket `close` handler to clear references.

### `publish(room, message, compress?)`
Broadcasts a message (String, Buffer, or Uint8Array) to all connected sockets in the room. This method is highly optimized: it automatically extracts a socket belonging to the room and leverages Bun's native room broadcast mechanism.

### `publishToAll(message, compress?)`
Broadcasts a message to absolutely every connected WebSocket tracked by the registry.

### `getRoomSize(room)`
Returns the number of active sockets in the specified room.

### `getRooms(ws)`
Returns an array of strings representing all rooms the specified socket is currently subscribed to.
