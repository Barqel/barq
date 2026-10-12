---
title: ناقل الأحداث (Event Bus)
description: ناقل أحداث لاتزامني خفيف وسريع بنظام الأنواع ودعم الأحداث المتشعبة في Barq.
---

# ناقل الأحداث (Event Bus)

توفر إضافة `@barqel/barq-events` ناقل وموزع أحداث داخلي فائق السرعة بدون أي اعتماديات، يدعم التنفيذ التفرعي والتسلسلي، والأنواع الصارمة، والاشتراك بالرموز العامة (Wildcards مثل `order.*`).

## التثبيت

```bash
bun add @barqel/barq-events
```

## البداية السريعة

```ts
import { App, json } from "@barqel/barq";
import { eventsPlugin, EventBus } from "@barqel/barq-events";

interface Events {
  "user.created": { id: string; email: string };
}

const app = new App();
app.plugin(eventsPlugin<Events>());

const events = (app as any).events as EventBus<Events>;

events.on("user.created", async (payload) => {
  await sendWelcomeEmail(payload.email);
});

events.on("user.*", (payload, eventName) => {
  console.log(`تم إطلاق الحدث: ${eventName}`);
});

app.post("/users", async (ctx) => {
  const user = { id: "1", email: "user@example.com" };
  await (ctx.state as any).events.emit("user.created", user);
  return json(user, 201);
});

app.listen(3000);
```
