---
title: Event Bus & Emitter
description: Zero-dependency, asynchronous typed event bus and emitter for Barq.
---

# Event Bus & Emitter

The `@barqel/barq-events` plugin provides an in-process, zero-dependency asynchronous event bus supporting typed contracts, serial and parallel execution, and wildcard subscribers.

## Installation

```bash
bun add @barqel/barq-events
```

## Quick Start

```ts
import { App, json } from "@barqel/barq";
import { eventsPlugin, EventBus } from "@barqel/barq-events";

interface Events {
  "user.created": { id: string; email: string };
}

const app = new App();
app.plugin(eventsPlugin<Events>());

const events = (app as any).events as EventBus<Events>;

// Register async listener
events.on("user.created", async (payload) => {
  await sendWelcomeEmail(payload.email);
});

// Wildcard listener
events.on("user.*", (payload, eventName) => {
  console.log(`Event fired: ${eventName}`);
});

app.post("/users", async (ctx) => {
  const user = { id: "1", email: "user@example.com" };
  await (ctx.state as any).events.emit("user.created", user);
  return json(user, 201);
});

app.listen(3000);
```
