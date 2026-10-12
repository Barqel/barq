---
title: تحديد معدل الطلبات (Rate Limiting)
description: حماية التطبيق من الإغراق وتحديد معدل الطلبات بأداء فائق وبدون اعتماديات خارجية في Barq.
---

# تحديد معدل الطلبات (Rate Limiting)

توفر إضافة `@barqel/barq-rate-limit` وسيطاً فائق الأداء للحد من عدد الطلبات، مع دعم تلقائي للترويسات القياسية (RFC 6585 ومسودة IETF).

## التثبيت

```bash
bun add @barqel/barq-rate-limit
```

## البداية السريعة

### تطبيق الحماية الشاملة (Global)

لحماية التطبيق بالكامل من الإغراق، استخدم `app.plugin()`:

```ts
import { App, json } from "@barqel/barq";
import { rateLimiter } from "@barqel/barq-rate-limit";

const app = new App();

app.plugin(
  rateLimiter({
    windowMs: 60 * 1000,
    max: 100,
  }),
);

app.get("/api/data", () => json({ status: "ok" }));
app.listen(3000);
```

### حماية مسارات محددة (Route-specific)

تطبيق قيود صارمة على مسارات تسجيل الدخول أو استعادة كلمات المرور:

```ts
import { App, json } from "@barqel/barq";
import { rateLimit } from "@barqel/barq-rate-limit";

const app = new App();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    error: "Too Many Requests",
    message: "تجاوزت الحد المسموح من المحاولات، يرجى المحاولة لاحقاً.",
  },
});

app.post("/login", authLimiter, (ctx) => {
  return json({ authenticated: true });
});
```

## تحديد هوية العميل (Key Generators)

افتراضياً يتم الاعتماد على عنوان الـ IP الخاص بالعميل (`ctx.ip`). يمكن تخصيص ذلك باستخدام مفاتيح API أو معرّف المستخدم:

```ts
rateLimit({
  windowMs: 60 * 1000,
  max: 1000,
  keyGenerator: (ctx) => ctx.req.headers.get("x-api-key") ?? ctx.ip,
});
```

## ترويسات الاستجابة (Headers)

يتم إرفاق الترويسات القياسية تلقائياً:

* `RateLimit-Limit`: الحد الأقصى للطلبات المسموحة في النافذة الزمنية.
* `RateLimit-Remaining`: عدد الطلبات المتبقية.
* `RateLimit-Reset`: عدد الثواني المتبقية حتى تجديد الحصة.
* `Retry-After`: الثواني المطلوبة للانتظار عند تجاوز الحد (رمز 429).
* `X-RateLimit-*`: الترويسات الكلاسيكية للتوافقية مع الأنظمة القديمة.
