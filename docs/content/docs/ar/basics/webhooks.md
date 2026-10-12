---
title: استقبال والتحقق من Webhooks
description: التحقق الآمن من تواقيع HMAC وحماية من هجمات إعادة الإرسال لـ Stripe و GitHub و Shopify في Barq.
---

# استقبال والتحقق من Webhooks

توفر إضافة `@barqel/barq-webhooks` وسيطاً فائق الأداء للتحقق الآمن زمنياً (Timing-safe) من تواقيع الـ HMAC والحماية من هجمات إعادة الإرسال (Replay Attacks) لخدمات الدفع والمنصات السحابية.

## التثبيت

```bash
bun add @barqel/barq-webhooks
```

## البداية السريعة

استقبال وفحص تواقيع Stripe مع فحص صلاحية الطابع الزمني تلقائياً:

```ts
import { App, json } from "@barqel/barq";
import { verifyWebhook } from "@barqel/barq-webhooks";

const app = new App();

app.post(
  "/webhooks/stripe",
  verifyWebhook({
    provider: "stripe",
    secret: process.env.STRIPE_WEBHOOK_SECRET!,
    toleranceSeconds: 300,
  }),
  (ctx) => {
    const event = ctx.state.webhookPayload as any;
    console.log("تم تأكيد الحدث:", event.type);
    return json({ received: true });
  }
);

app.listen(3000);
```

## المزودون المدعومون

* `stripe`: فحص ترويسة `stripe-signature` مع الطابع الزمني لمنع هجمات Replay.
* `github`: فحص ترويسة `x-hub-signature-256`.
* `shopify`: فحص ترويسة `x-shopify-hmac-sha256` المشفرة بصيغة Base64.
* `standard`: فحص التواقيع القياسية `x-signature-256`.
* `custom`: تخصيص دالة فحص وتوقيع مخصصة.

## المتغيرات المحقونة في سياق الطلب

بعد نجاح التحقق، تتوافر البيانات التالية داخل `ctx.state`:
* `ctx.state.webhookPayload`: كائن JSON المفحوص والمعالج.
* `ctx.state.webhookRaw`: النص الخام الأصلي كما ورد في الطلب (ضروري لإعادة التوقيع أو التدقيق).
* `ctx.state.webhookProvider`: اسم المزود المطابق.

## خيارات الإعداد

| الخيار | النوع | القيمة الافتراضية | الوصف |
| :--- | :--- | :--- | :--- |
| `provider` | `"stripe" \| "github" \| "shopify" \| "standard" \| "custom"` | `"standard"` | نوع مزود الـ Webhook |
| `secret` | `string \| (ctx) => Promise<string>` | **مطلوب** | المفتاح السري المخصص للتحقق |
| `toleranceSeconds`| `number` | `300` (5 دقائق) | نافذة السماح بالانحراف الزمني (لـ Stripe) |
| `headerName` | `string` | `"x-signature-256"` | اسم الترويسة للمزود القياسي والمخصص |
| `parseJson` | `boolean` | `true` | تحويل النص الخام تلقائياً إلى JSON |
| `onInvalidSignature` | `(ctx, err) => Response` | `undefined` | دالة استجابة مخصصة عند فشل التوقيع |
