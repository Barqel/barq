---
title: الملفات الثابتة وتطبيقات SPA
description: تقديم الملفات الثابتة بأعلى كفاءة، ودعم تطبيقات الصفحة الواحدة (SPA)، والتحكم في التخزين المؤقت في Barq.
---

# الملفات الثابتة وتطبيقات SPA

توفر إضافة `@barqel/barq-static` حلاً فائق الأداء لتقديم الملفات الثابتة (Static Files) بدون أي اعتماديات خارجية. تستفيد الإضافة في Bun من نداءات النظام المباشرة عبر `Bun.file()`.

## التثبيت

```bash
bun add @barqel/barq-static
```

## البداية السريعة

ربط مجلد الملفات العامة بالمشروع:

```ts
import { App } from "@barqel/barq";
import { staticFiles } from "@barqel/barq-static";

const app = new App();

app.plugin(
  staticFiles({
    root: "./public",
    prefix: "/assets",
    maxAge: 86400,
  }),
);

app.listen(3000);
```

تصبح الملفات داخل `./public` متاحة عبر المسار `/assets` (مثل `/assets/style.css`).

## دعم تطبيقات الصفحة الواحدة (SPA Fallback)

لدعم مسارات الواجهات الأمامية (مثل React و Vue و Svelte)، فعّل خيار `spa: true` لتحويل الطلبات غير الموجودة تلقائياً إلى `index.html`:

```ts
app.plugin(
  staticFiles({
    root: "./dist/client",
    spa: true,
  }),
);
```

## الاستخدام المباشر كمعالج مسار

يمكن استخدام دالة `serveStatic` مباشرة مع مسارات محددة:

```ts
import { serveStatic } from "@barqel/barq-static";

app.get("/files/*path", serveStatic({ root: "./storage" }));
```

## الأمان والحماية من Path Traversal

تفرض الإضافة فحصاً صارماً على المسارات لمنع هجمات التسلل خارج المجلد الجذري (مثل استخدام `../` أو محارف الـ Null Byte). كما يتم حجب الملفات المخفية (مثل `.env`) تلقائياً.

## خيارات الإعداد

| الخيار | النوع | القيمة الافتراضية | الوصف |
| :--- | :--- | :--- | :--- |
| `root` | `string` | **مطلوب** | مسار المجلد على القرص |
| `prefix` | `string` | `""` | البادئة للرابط (URL Prefix) |
| `index` | `string \| false` | `"index.html"` | اسم الملف الافتراضي للمجلد |
| `spa` | `boolean \| string` | `false` | تفعيل الرجوع التلقائي لملف SPA |
| `maxAge` | `number` | `0` | مدة التخزين المؤقت بالثواني |
| `immutable` | `boolean` | `false` | إضافة ترويسة `immutable` للكاش |
| `etag` | `boolean` | `true` | تفعيل الـ ETag ورمز 304 عند عدم التغيير |
| `dotfiles` | `"ignore" \| "deny" \| "allow"` | `"ignore"` | سياسة التعامل مع الملفات التي تبدأ بنقطة |
| `setHeaders` | `(res, path, stat) => void` | `undefined` | دالة مخصصة لإضافة ترويسات قبل الإرسال |
