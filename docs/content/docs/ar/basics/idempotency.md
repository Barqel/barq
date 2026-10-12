---
title: مفتاح عدم التكرار (Idempotency)
description: تنفيذ نمط Idempotency Key بأداء فائق لمنع تكرار العمليات الحساسة (مثل الدفع) في Barq.
---

# مفتاح عدم التكرار (Idempotency)

تضمن إضافة `@barqel/barq-idempotency` التعامل الآمن مع إعادة إرسال الطلبات دون تنفيذ العملية مرتين (مثل منع الخصم المزدوج للأموال). تطبق الإضافة نمط ترويسة `Idempotency-Key` القياسي والمعتمد في منصات كبرى مثل Stripe.

## التثبيت

```bash
bun add @barqel/barq-idempotency
```

## البداية السريعة

حماية مسار الدفع باشتراط وجود ترويسة `Idempotency-Key`:

```ts
import { App, json } from "@barqel/barq";
import { idempotency } from "@barqel/barq-idempotency";

const app = new App();

app.post(
  "/api/charge",
  idempotency({ enforceHeader: true }),
  async (ctx) => {
    const { amount } = await ctx.json<any>();
    
    // هذا الكود سيُنفذ مرة واحدة فقط لكل مفتاح
    await processPayment(amount);

    return json({ success: true, amount });
  }
);

app.listen(3000);
```

## آلية العمل

1. **الطلب الأول**: عندما يرسل العميل طلب `POST` بـ `Idempotency-Key`، يقوم Barq بتسجيل المفتاح كـ `IN_PROGRESS` (قيد التنفيذ).
2. **التنفيذ والحفظ**: يُنفذ معالج المسار، يعترض Barq الاستجابة، يحفظ محتواها وترويساتها في الذاكرة، ويغير حالة المفتاح إلى `DONE`.
3. **الطلبات المتزامنة**: إذا وصل طلب ثانٍ بنفس المفتاح بينما الطلب الأول لا يزال قيد التنفيذ، يُرجع السيرفر فوراً `409 Conflict` لتجنب تعارض البيانات (Race Conditions).
4. **الطلبات المكررة**: إذا أُعيد إرسال نفس المفتاح بعد اكتمال الطلب الأول، يتجاهل السيرفر التنفيذ ويرد بالاستجابة المحفوظة مسبقاً، مع إضافة ترويسة `X-Idempotent-Replayed: true`.

*ملاحظة: طلبات `GET` و `HEAD` تعتبر متطابقة (Idempotent) بطبيعتها، ولذلك يتجاهلها الوسيط تلقائياً.*

## خيارات الإعداد

| الخيار | النوع | القيمة الافتراضية | الوصف |
| :--- | :--- | :--- | :--- |
| `headerName` | `string` | `"idempotency-key"` | اسم الترويسة المراد فحصها |
| `ttlMs` | `number` | `86400000` (24 ساعة) | مدة الاحتفاظ بالاستجابة في الذاكرة بالملي ثانية |
| `enforceHeader`| `boolean` | `false` | إذا كان `true`، يرفض الطلب برمز `400` في حال غياب الترويسة |
| `errorMessage` | `unknown` | Object | استجابة مخصصة عند غياب الترويسة الإجبارية |
| `conflictMessage`| `unknown` | Object | استجابة مخصصة للطلبات المتزامنة المتعارضة `409` |
| `store` | `IdempotencyStore`| `MemoryIdempotencyStore` | محرك تخزين مخصص (يمكن ربطه بـ Redis) |
