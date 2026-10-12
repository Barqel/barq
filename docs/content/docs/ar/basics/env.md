---
title: إدارة المتغيرات البيئية (Env)
description: فحص صارم ومكتوب للأنواع لمتغيرات البيئة مع إيقاف التشغيل المبكر عند نقص الإعدادات في Barq.
---

# إدارة المتغيرات البيئية (Env)

توفر إضافة `@barqel/barq-env` نظاماً آمناً للتحقق من متغيرات البيئة (`process.env` أو `Bun.env`)، وتحويل الأنواع تلقائياً، وإيقاف إقلاع السيرفر مبكراً (Fail-fast) في حال غياب أي متغير سري هام.

## التثبيت

```bash
bun add @barqel/barq-env
```

## البداية السريعة

```ts
import { createEnv, env } from "@barqel/barq-env";

export const config = createEnv({
  PORT: env.port({ default: 3000 }),
  DATABASE_URL: env.url(),
  JWT_SECRET: env.string({ min: 32 }),
  DEBUG: env.boolean({ default: false }),
  NODE_ENV: env.enum(["development", "production", "test"] as const, {
    default: "development",
  }),
});
```

## الربط كإضافة مع التطبيق

```ts
import { App } from "@barqel/barq";
import { envPlugin, env } from "@barqel/barq-env";

const app = new App();

app.plugin(
  envPlugin({
    API_KEY: env.string(),
  })
);

app.get("/service", (ctx) => {
  const apiKey = (ctx.state as any).env.API_KEY;
  return new Response("OK");
});
```
