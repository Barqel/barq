---
title: ترويسات الأمان (Helmet)
description: ترويسات أمان HTTP وسياسات CSP بأعلى كفاءة وبدون أي اعتماديات خارجية في Barq.
---

# ترويسات الأمان (Helmet)

توفر إضافة `@barqel/barq-helmet` حماية فورية لتطبيقات Barq عبر ضبط ترويسات أمان HTTP القياسية لحماية الموقع من هجمات XSS و Clickjacking و MIME-sniffing.

## التثبيت

```bash
bun add @barqel/barq-helmet
```

## البداية السريعة

### الحماية الشاملة للتطبيق

تفعيل ترويسات الأمان لجميع المسارات:

```ts
import { App, json } from "@barqel/barq";
import { helmetPlugin } from "@barqel/barq-helmet";

const app = new App();

app.plugin(helmetPlugin());

app.get("/api/data", () => json({ secure: true }));
app.listen(3000);
```

### سياسة أمان المحتوى (CSP)

تخصيص قواعد `Content-Security-Policy`:

```ts
app.plugin(
  helmetPlugin({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        objectSrc: ["'none'"],
      },
    },
  }),
);
```

## الترويسات المفعلة افتراضياً

* `X-Content-Type-Options: nosniff`: منع المتصفح من تخمين نوع المحتوى.
* `X-Frame-Options: SAMEORIGIN`: الحماية من تضمين الموقع داخل iframes لمنع الـ Clickjacking.
* `Strict-Transport-Security`: فرض اتصال HTTPS لمدة عام كامل.
* `X-Download-Options: noopen`: منع متصفح IE القديم من فتح الملفات المحملة تلقائياً.
* `X-Permitted-Cross-Domain-Policies: none`: منع ملفات Flash و PDF من قراءة البيانات.
* `X-DNS-Prefetch-Control: off`: تعطيل تخمين الـ DNS المسبق للروابط.
* `X-XSS-Protection: 0`: تعطيل الفلتر القديم منعاً للثغرات الجانبية وفق المعايير الحديثة.
* `Referrer-Policy: no-referrer`: حجب مسار المصدر المحول منه.
* `Cross-Origin-Opener-Policy: same-origin`: عزل نافذة التصفح عن النوافذ المنبثقة.
* `Cross-Origin-Resource-Policy: same-origin`: منع المواقع الأخرى من قراءة الموارد المشتركة.
* إزالة ترويسة `X-Powered-By` تلقائياً لإخفاء معلومات بيئة التشغيل.
