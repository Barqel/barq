---
title: التسجيل وتتبع الطلبات (Logger)
description: مسجل عمليات مهيكل فائق الأداء، وتتبع الطلبات، وقياس زمن الاستجابة بدون أي اعتماديات خارجية في Barq.
---

# التسجيل وتتبع الطلبات (Logger)

توفر إضافة `@barqel/barq-logger` مسجلاً مهيكلاً عالي الكفاءة بدون أي اعتماديات خارجية، يشمل تتبع الطلبات عبر معرّف `X-Request-Id` وحساب أزمنة الاستجابة بدقة بالغة.

## التثبيت

```bash
bun add @barqel/barq-logger
```

## البداية السريعة

### التسجيل الشامل للتطبيق

تفعيل المسجل على كافة المسارات:

```ts
import { App, json } from "@barqel/barq";
import { loggerPlugin } from "@barqel/barq-logger";

const app = new App();

app.plugin(
  loggerPlugin({
    mode: "auto",
    level: "info",
    skip: (ctx) => ctx.pathname === "/health",
  }),
);

app.get("/health", () => json({ status: "ok" }));
app.get("/api/data", () => json({ items: [1, 2, 3] }));

app.listen(3000);
```

## مسجل السياق الخاص بالطلب (`ctx.state.log`)

يمكنك تسجيل رسائل خاصة داخل معالجات المسارات تحمل تلقائياً معرّف الطلب `requestId`:

```ts
import { type RequestLogger } from "@barqel/barq-logger";

app.post("/users", async (ctx) => {
  const log = ctx.state.log as RequestLogger;
  const body = await ctx.json<any>();

  log.info("إنشاء مستخدم جديد", { email: body.email });

  try {
    const user = await saveUser(body);
    return json(user, 201);
  } catch (err) {
    log.error("فشل في حفظ المستخدم", err, { email: body.email });
    return json({ error: "فشل الإنشاء" }, 500);
  }
});
```

## أنماط العرض (Output Modes)

* `pretty`: تنسيق ملون وسهل القراءة للطرفية في بيئة التطوير.
* `json`: مخرجات JSON سطرية (NDJSON) عالية الأداء لبيئات الإنتاج مثل Datadog و CloudWatch و Grafana.
* `auto`: يختار `json` تلقائياً في بيئة الإنتاج (`NODE_ENV=production`) و `pretty` في بيئة التطوير.

## تتبع الطلبات (Request ID Tracing)

يتم توليد ترويسة `X-Request-Id` لكل طلب تلقائياً (أو الحفاظ على الترويسة القادمة من العميل/الوكيل)، وحقنها في الاستجابة وتوفيرها داخل `ctx.state.requestId`.
