---
title: رفع الملفات والبيانات المختلفة
description: تعامل مع FormData والملفات والتدفقات والتحقق منها على Bun وNode.js، مع توضيح اختلاف واجهات حفظ الملفات.
---

يدعم Barq أجسام طلبات HTTP والبيانات الثنائية على Bun وNode.js. تستخدم أمثلة حفظ الملفات `Bun.write()` الخاصة بـBun؛ استخدم واجهات نظام الملفات في Node.js عند تشغيل هذه الأمثلة عليه.

عند استخدام Node.js، استورد Barq من `@barqel/barq/node`. يتوفر `File` عالميًا في Node.js 20 فأحدث؛ أما في Node.js 18، فاستورده من `node:buffer` قبل استخدام فحوص `instanceof File` الواردة أدناه.

لحفظ `avatar` في المسار الأول على Node.js، استخدم واجهات نظام الملفات وأنشئ اسمًا داخليًا للملف بدلًا من الوثوق باسم يرسله العميل:

```js
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

const fileName = `${randomUUID()}.upload`;
await mkdir("./uploads", { recursive: true });
await writeFile(
  `./uploads/${fileName}`,
  Buffer.from(await avatar.arrayBuffer()),
);
```

يمكن استخدام واجهات التدفق في Node.js للملفات الكبيرة. وينبغي أيضًا ضبط حدود حجم الطلبات في خادم HTTP أو الوكيل العكسي؛ إذ إن `maxRequestBodySize` خيار خاص بخادم Bun.

## 1. قراءة FormData ورفع الملفات

لقراءة بيانات النماذج (`multipart/form-data` أو `application/x-www-form-urlencoded`) بما في ذلك الملفات، استخدم `await ctx.formData()`:

```ts
import { App, json, HttpError } from "@barqel/barq";

const app = new App({
  // ضبط الحد الأقصى لحجم جسم الطلب (مثلاً 10 ميجابايت)
  maxRequestBodySize: 10 * 1024 * 1024,
});

app.post("/upload", async (ctx) => {
  const form = await ctx.formData();

  // قراءة حقل نصي
  const username = form.get("username");

  // قراءة الملف
  const avatar = form.get("avatar");

  if (!(avatar instanceof File)) {
    throw new HttpError(400, { error: "يرجى رفع ملف صالح" });
  }

  // خصائص الملف القياسية
  console.log("الاسم:", avatar.name);
  console.log("النوع:", avatar.type); // مثل image/png
  console.log("الحجم بالبايت:", avatar.size);

  // حفظ الملف على القرص باستخدام سرعة Bun الفائقة
  await Bun.write(`./uploads/${avatar.name}`, avatar);

  return json({
    success: true,
    file: avatar.name,
    size: avatar.size,
  });
});
```

### رفع ملفات متعددة (Multiple Files)

إذا كان النموذج يحتوي على حقل يرفع أكثر من ملف بنفس الاسم:

```ts
app.post("/upload-multiple", async (ctx) => {
  const form = await ctx.formData();
  const files = form.getAll("documents");
  const saved: string[] = [];

  for (const item of files) {
    if (item instanceof File) {
      await Bun.write(`./uploads/${item.name}`, item);
      saved.push(item.name);
    }
  }

  return json({ uploaded: saved });
});
```

---

## 2. التحقق من صحة الملفات (File Validation)

يمكنك التحقق من نوع الملف (MIME Type) وحجمه قبل قبوله وحفظه:

```ts
app.post("/upload-avatar", async (ctx) => {
  const form = await ctx.formData();
  const file = form.get("avatar");

  if (!(file instanceof File)) {
    throw new HttpError(422, { error: "الملف مطلوب" });
  }

  // 1. التحقق من النوع
  const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedMimeTypes.includes(file.type)) {
    throw new HttpError(422, { error: "يُسمح فقط بصور JPG أو PNG أو WEBP" });
  }

  // 2. التحقق من الحجم (مثلاً 2 ميجابايت كحد أقصى)
  const maxBytes = 2 * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new HttpError(422, { error: "حجم الملف يتجاوز 2 ميجابايت" });
  }

  await Bun.write(`./uploads/${Date.now()}-${file.name}`, file);
  return json({ message: "تم قبول الصورة بنجاح" });
});
```

### استخدام Zod للتحقق من FormData والملفات

تدعم مكتبة Zod كائنات `File` القياسية عبر `z.instanceof(File)`:

```ts
import { z } from "zod";
import { HttpError, json } from "@barqel/barq";

const UploadSchema = z.object({
  title: z.string().min(3),
  file: z.instanceof(File)
    .refine((f) => f.size <= 5 * 1024 * 1024, "أقصى حجم مسموح 5 ميجابايت")
    .refine((f) => ["application/pdf"].includes(f.type), "يجب رفع ملف PDF فقط"),
});

app.post("/documents", async (ctx) => {
  const form = await ctx.formData();
  
  const result = UploadSchema.safeParse({
    title: form.get("title"),
    file: form.get("file"),
  });

  if (!result.success) {
    throw new HttpError(422, {
      error: "فشل التحقق من البيانات",
      issues: result.error.format(),
    });
  }

  const { title, file } = result.data;
  await Bun.write(`./docs/${file.name}`, file);

  return json({ success: true, title }, 201);
});
```

---

## 3. معالجة الملفات الضخمة بالتدفق (Streaming)

إذا كان حجم الملف كبيراً جداً (مثل الفيديوهات أو النسخ الاحتياطية)، تجنب تحميله بالكامل في الذاكرة. استخدم `ctx.bodyStream` أو `ctx.stream()` لكتابة التدفق مباشرة على القرص:

```ts
app.post("/upload-large", async (ctx) => {
  const stream = ctx.bodyStream;

  if (!stream) {
    throw new HttpError(400, { error: "لم يتم إرسال تدفق بيانات" });
  }

  // كتابة التدفق مباشرة دون استهلاك ذاكرة الخادم (RAM)
  await Bun.write("./uploads/large-file.bin", stream);

  return json({ message: "تم استقبال وحفظ الملف بنجاح" });
});
```

---

## 4. البيانات الثنائية والنصوص الخام

* **`ctx.arrayBuffer()`**: لجلب بايتات الطلب الخام ومعالجتها (مثل Webhook أو بروتوكول ثنائي).
* **`ctx.blob()`**: للتعامل مع البيانات الثنائية مع نوع الـ MIME المرتبط بها.
* **`ctx.text()`**: لقراءة النصوص العادية، XML، أو CSV.
