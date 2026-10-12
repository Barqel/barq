---
title: عميل الخدمات المصغرة (Client)
description: عميل HTTP عالي المرونة للخدمات المصغرة مع دعم إعادة المحاولة وقاطع الدائرة ونقل التتبع في Barq.
---

# عميل الخدمات المصغرة (Client)

توفر حزمة `@barqel/barq-client` عميل HTTP مخصصاً للتواصل بين الخدمات المصغرة (Microservices)، مع دعم إعادة المحاولة التلقائية (Exponential Backoff)، وقاطع الدائرة (Circuit Breaker)، ونقل ترويسات التتبع `X-Request-Id` عبر الخدمات.

## التثبيت

```bash
bun add @barqel/barq-client
```

## البداية السريعة

### الاستخدام المستقل

```ts
import { createClient } from "@barqel/barq-client";

const paymentsApi = createClient({
  baseUrl: "https://payments.internal.net",
  timeoutMs: 5000,
  retry: { retries: 3, minDelayMs: 100 },
  circuitBreaker: { failureThreshold: 5, recoveryTimeMs: 30000 },
});

const res = await paymentsApi.post("/v1/charge", {
  json: { amount: 100 },
});

const data = await res.data<{ id: string; status: string }>();
```

### التكامل التلقائي مع تتبع الطلبات

عند استخدام الإضافة `clientPlugin()`، يتوافر العميل داخل `ctx.state.client` ويقوم تلقائياً بتمرير معرّف `X-Request-Id` الخاص بالطلب الحالي للخدمات اللاحقة:

```ts
import { App, json } from "@barqel/barq";
import { clientPlugin } from "@barqel/barq-client";

const app = new App();

app.plugin(
  clientPlugin({
    baseUrl: "http://inventory-service:8080",
  }),
);

app.get("/order/:id", async (ctx) => {
  const client = (ctx.state as any).client;
  const res = await client.get(`/items/${ctx.params.id}`);

  return json(await res.data());
});

app.listen(3000);
```

## قاطع الدائرة (Circuit Breaker)

يعمل قاطع الدائرة المدمج عبر 3 حالات لمنع انهيار الخوادم (Cascading Failure):
* `CLOSED`: الوضع الطبيعي لتمرير الطلبات.
* `OPEN`: ينفتح القاطع عند تجاوز `failureThreshold` من الأخطاء المتتالية، ويرفض أي طلبات لاحقة فوراً برمز استثناء `CircuitBreakerOpenError`.
* `HALF_OPEN`: بعد انقضاء `recoveryTimeMs`، يمرر القاطع عينة تجريبية لفحص تعافي الخدمة الخارجية.
