---
title: رفع الملفات (File Uploads)
description: وسيط لرفع الملفات بأمان عالٍ، مع فحص الحجم والنوع (MIME)، والتخزين المباشر لخدمات الـ APIs في Barq.
---

# رفع الملفات (File Uploads)

توفر إضافة `@barqel/barq-upload` وسيطاً فائق الأداء لتمشيط ومعالجة طلبات `multipart/form-data`، مع فحص صارم لأحجام الملفات، وأنواعها، وتخزينها الآمن بدون أي اعتماديات خارجية.

## التثبيت

```bash
bun add @barqel/barq-upload
```

## البداية السريعة

استخدم الوسيط لحماية مسارات הـ API الخاصة بك وتحديد شروط رفع الملفات:

```ts
import { App, json } from "@barqel/barq";
import { upload, type UploadedFile } from "@barqel/barq-upload";

const app = new App();

const documentUpload = upload({
  dest: "./storage/documents",
  maxFileSize: 10 * 1024 * 1024, // الحد الأقصى 10 ميجابايت
  maxFiles: 3,                   // السماح بـ 3 ملفات كحد أقصى في الطلب
  accept: ["application/pdf"],   // قبول ملفات PDF فقط
});

app.post("/api/documents", documentUpload, (ctx) => {
  // يتم وضع الملفات المفحوصة والمحفوظة داخل ctx.state.files
  const files = ctx.state.files as UploadedFile[];
  
  if (files.length === 0) {
    return json({ error: "لم يتم رفع أي ملف" }, 400);
  }

  return json({
    uploaded: files.map(f => ({
      name: f.name,
      savedAs: f.savedAs,
      size: f.size
    }))
  }, 201);
});

app.listen(3000);
```

## ميزات الأمان التلقائية

يفرض الوسيط القواعد الأمنية *قبل* وصول الطلب إلى المعالج النهائي:
* يُرجع استجابة `413 Payload Too Large` فوراً إذا تجاوز حجم الملف `maxFileSize` أو تم تخطي `maxFiles`.
* يُرجع استجابة `415 Unsupported Media Type` إذا لم يكن نوع الملف ضمن قائمة `accept`.
* يُولد أسماء ملفات عشوائية باستخدام UUID المشفر افتراضياً لمنع هجمات التسلل عبر المسارات (Directory Traversal).

## التخزين في الذاكرة مقابل القرص

إذا لم تمرر خيار `dest`، سيقوم الوسيط بفحص الملفات والاحتفاظ بها ككائنات `File` قياسية في الذاكرة. يُعتبر هذا الأسلوب ممتازاً لرفع الملفات وتوجيهها مباشرة إلى AWS S3 أو Cloudflare R2 دون كتابتها على القرص المحلي:

```ts
const memoryUpload = upload({ maxFileSize: 5 * 1024 * 1024 });

app.post("/api/avatar", memoryUpload, async (ctx) => {
  const files = ctx.state.files as UploadedFile[];
  const avatarFile = files[0].file; // كائن File قياسي
  
  await s3Client.putObject({
    Bucket: "avatars",
    Key: `usr_123.png`,
    Body: avatarFile,
  });

  return json({ success: true });
});
```

## خيارات الإعداد

| الخيار | النوع | القيمة الافتراضية | الوصف |
| :--- | :--- | :--- | :--- |
| `dest` | `string` | `undefined` | مسار المجلد لحفظ الملفات بشكل دائم على القرص |
| `maxFileSize` | `number` | `Infinity` | الحد الأقصى المسموح به لحجم الملف بالبايت |
| `maxFiles` | `number` | `Infinity` | الحد الأقصى لعدد الملفات المقبولة في الطلب الواحد |
| `accept` | `string[]` | `undefined` | مصفوفة بالأنواع المسموحة (مثل `["image/png"]`) |
| `generateFilename` | `(file: File) => string` | `UUID + Ext`| دالة مخصصة لتوليد اسم الملف قبل الحفظ |
| `createDestDir` | `boolean` | `true` | إنشاء مجلد الحفظ `dest` تلقائياً إن لم يكن موجوداً |
