---
title: التخزين المؤقت (Caching & ETag)
description: تخزين مؤقت للاستجابات فائق الأداء مع توليد ETags ومعالجة الطلبات الشرطية في Barq.
---

# التخزين المؤقت (Caching & ETag)

توفر إضافة `@barqel/barq-cache` نظام تخزين مؤقت في الذاكرة (In-Memory Cache) للاستجابات، مع توليد تلقائي لترويسة `ETag` ودعم الرد برمز `304 Not Modified` لتوفير استهلاك البيانات بدون أي اعتماديات خارجية.

## التثبيت

```bash
bun add @barqel/barq-cache
```

## البداية السريعة

تطبيق التخزين المؤقت لتسريع واجهات API التي تقرأ بيانات ثقيلة بشكل متكرر:

```ts
import { App, json } from "@barqel/barq";
import { cachePlugin } from "@barqel/barq-cache";

const app = new App();

app.plugin(
  cachePlugin({
    ttlMs: 60 * 1000, // دقيقة واحدة
    enableEtag: true,
  }),
);

app.get("/api/trends", async () => {
  const data = await heavyDatabaseQuery();
  return json(data);
});

app.listen(3000);
```

## آلية العمل

1. **الطلبات الجديدة (MISS)**: يصل الطلب لمعالج المسار، ويتم استنساخ الاستجابة الصادرة وحفظها في الذاكرة مع حساب بصمة `ETag` (عبر SHA-1). تُرسل الاستجابة للعميل مع ترويسة `X-Cache: MISS`.
2. **الطلبات المتكررة (HIT)**: يتم الرد مباشرة من الذاكرة دون تنفيذ معالج المسار نهائياً، مع ترويسة `X-Cache: HIT`.
3. **الطلبات الشرطية**: إذا أرسل العميل ترويسة `If-None-Match` مطابقة للـ ETag المخزن، يتم إرجاع استجابة فارغة برمز `304 Not Modified` لتوفير استهلاك الباندويث.

## تخصيص مفتاح الكاش

افتراضياً، يتم استخدام `${method}:${url}` كمفتاح للحفظ. يمكنك تخصيص المفتاح ليعتمد على معلمات معينة أو لغة المتصفح:

```ts
cachePlugin({
  ttlMs: 30000,
  keyGenerator: (ctx) => {
    const lang = ctx.queryParam("lang") ?? "ar";
    return `${ctx.req.method}:${ctx.pathname}?lang=${lang}`;
  },
})
```

## خيارات الإعداد

| الخيار | النوع | القيمة الافتراضية | الوصف |
| :--- | :--- | :--- | :--- |
| `ttlMs` | `number` | `60000` | مدة بقاء الاستجابة في الذاكرة بالملي ثانية |
| `methods` | `string[]` | `["GET", "HEAD"]` | طرق HTTP المسموح بتخزينها |
| `enableEtag` | `boolean` | `true` | حساب ETag ومعالجة `If-None-Match` |
| `cacheControl` | `boolean` | `true` | إضافة ترويسة `Cache-Control` |
| `keyGenerator` | `(ctx) => string` | `method:url` | دالة توليد مفتاح الحفظ |
| `skip` | `(ctx) => boolean` | `undefined` | دالة شرطية لتخطي الكاش |
| `store` | `CacheStore` | `MemoryCacheStore` | محرك التخزين (يمكن تبديله بـ Redis مثلاً) |
