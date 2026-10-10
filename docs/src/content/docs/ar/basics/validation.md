---
title: التحقق من البيانات
description: دليل شامل وكامل للتحقق من JSON، الاستعلامات، والنماذج والملفات في Barq باستخدام Zod أو التحقق المباشر.
---

قبل معالجة أي طلب في خادمك، يجب التأكد من مطابقة المدخلات للشروط المطلوبة لحماية التطبيق من الأخطاء والبيانات غير الصالحة.

يدعم Barq أسلوبين أساسيين:
1. استخدام المساعد المدمج `validateJson` المتوافق مع معيار **Standard Schema v1** (مثل Zod).
2. التحقق المباشر داخل المعالج (**بدون `validateJson`**) لكافة أنواع البيانات (JSON، الاستعلامات، النماذج، والملفات).

---

## تثبيت مكتبة Zod

إذا أردت استخدام Zod للتحقق التلقائي، ثبّتها في مشروعك:

```sh
bun add zod
```

---

## 1. استخدام Zod مع المساعد المدمج `validateJson`

مكتبة Zod تدعم معيار **Standard Schema v1** تلقائياً. عند تمرير المخطط إلى `validateJson`، يتولى Barq قراءة الـ JSON وفحصه، وإذا وُجد أي خطأ يعيد تلقائياً استجابة `422 Unprocessable Entity` تحتوي على قائمة `issues`.

### مثال كامل: إنشاء مستخدم جديد

```ts
import { App, json, validateJson } from "@barqel/barq";
import { z } from "zod";

// 1. تعريف مخطط البيانات
const CreateUserSchema = z.object({
  name: z.string().min(2, "الاسم يجب ألا يقل عن حرفين"),
  email: z.string().email("البريد الإلكتروني غير صالح"),
  age: z.number().int().positive("العمر يجب أن يكون عدداً صحيحاً موجباً"),
  role: z.enum(["user", "admin"]).default("user"),
});

const app = new App();

// 2. تسجيل المسار وتمرير المخطط
app.post(
  "/users",
  validateJson(CreateUserSchema, (ctx, body) => {
    // المتغير body مضمون وصحيح ومكتوب الأنواع بالكامل وفق المخطط:
    // body: { name: string; email: string; age: number; role: "user" | "admin" }
    return json(
      {
        message: "تم إنشاء المستخدم بنجاح",
        user: {
          name: body.name,
          email: body.email,
          age: body.age,
          role: body.role,
        },
      },
      201,
    );
  }),
);

app.listen(3000);
```

#### الاستجابة التلقائية عند إرسال بيانات خاطئة (422):
```json
{
  "error": "Validation Failed",
  "issues": [
    {
      "message": "العمر يجب أن يكون عدداً صحيحاً موجباً",
      "path": ["age"]
    }
  ]
}
```

---

## 2. التحقق المباشر من JSON بدون `validateJson`

إذا كنت تريد تخصيص شكل رسائل الأخطاء أو عدم استخدام دالة تغليف (Wrapper)، يمكنك استخدام `schema.safeParse` مباشرة داخل دالة المعالج:

### مثال كامل: تسجيل الدخول مع Zod مدمج داخل المعالج

```ts
import { App, json, HttpError } from "@barqel/barq";
import { z } from "zod";

const LoginSchema = z.object({
  username: z.string().min(3, "اسم المستخدم لا يقل عن 3 أحرف"),
  password: z.string().min(8, "كلمة المرور لا تقل عن 8 أحرف"),
});

const app = new App();

app.post("/login", async (ctx) => {
  // 1. قراءة الـ JSON يدوياً من سياق الطلب
  const rawBody = await ctx.json<unknown>();

  // 2. فحص البيانات بواسطة safeParse
  const result = LoginSchema.safeParse(rawBody);

  // 3. في حالة فشل التحقق، نقوم برمي خطأ HTTP مخصص
  if (!result.success) {
    throw new HttpError(422, {
      error: "بيانات تسجيل الدخول غير صالحة",
      details: result.error.flatten().fieldErrors,
    });
  }

  // 4. البيانات هنا مستخرجة ومضمونة
  const { username, password } = result.data;

  // تنفيذ منطق فحص كلمة المرور...
  return json({
    success: true,
    user: username,
  });
});

app.listen(3000);
```

---

## 3. التحقق من معاملات الاستعلام والمسار (`Query & Params`)

معاملات الاستعلام (`Query Parameters`) تأتي دائماً كنصوص (`string`). نستخدم في Zod ميزة **`z.coerce`** لتحويل النص تلقائياً إلى رقم أو تاريخ أو قيمة منطقية:

### مثال كامل: البحث والترقيم مع فحص المدخلات

```ts
import { App, json, HttpError } from "@barqel/barq";
import { z } from "zod";

const QueryFilterSchema = z.object({
  q: z.string().min(1, "كلمة البحث مطلوبة"),
  // z.coerce.number يحول الـ string "2" إلى number 2 تلقائياً
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  sort: z.enum(["price_asc", "price_desc", "newest"]).default("newest"),
});

const app = new App();

app.get("/products", (ctx) => {
  // تجميع معاملات الاستعلام في كائن عادي للفحص
  const rawParams = {
    q: ctx.queryParam("q"),
    page: ctx.queryParam("page"),
    limit: ctx.queryParam("limit"),
    sort: ctx.queryParam("sort"),
  };

  const validation = QueryFilterSchema.safeParse(rawParams);

  if (!validation.success) {
    throw new HttpError(400, {
      error: "معاملات البحث غير صالحة",
      details: validation.error.flatten().fieldErrors,
    });
  }

  // البيانات هنا محولة إلى أنواع صحيحة
  const { q, page, limit, sort } = validation.data;

  return json({
    query: q,
    page,
    limit,
    sort,
    items: [],
  });
});

app.listen(3000);
```

---

## 4. التحقق من النماذج ورفع الملفات (`FormData & Files`)

للتحقق من رفع الملفات وحقول النموذج، نستخدم كائن `File` القياسي مع `z.instanceof(File)` لتحديد نوع الملف وحجمه الأقصى:

### مثال كامل: رفع صورة مستخدم والتحقق من نوعها وحجمها

```ts
import { App, json, HttpError } from "@barqel/barq";
import { z } from "zod";

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 ميجابايت
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

const ProfileUploadSchema = z.object({
  title: z.string().min(2, "العنوان يجب ألا يقل عن حرفين"),
  avatar: z
    .instanceof(File, { message: "ملف الصورة مطلوب" })
    .refine((file) => file.size <= MAX_FILE_SIZE, "حجم الملف يتجاوز 2 ميجابايت")
    .refine(
      (file) => ACCEPTED_IMAGE_TYPES.includes(file.type),
      "يُسمح فقط بصور من نوع JPG أو PNG أو WEBP",
    ),
});

const app = new App({
  // تحديد الحد الأقصى لحجم الطلب على مستوى الخادم
  maxRequestBodySize: 10 * 1024 * 1024,
});

app.post("/profile/upload", async (ctx) => {
  // 1. قراءة الـ FormData من الطلب
  const form = await ctx.formData();

  // 2. استخراج الحقول وتجهيزها للفحص
  const rawData = {
    title: form.get("title"),
    avatar: form.get("avatar"),
  };

  // 3. التحقق بواسطة Zod
  const result = ProfileUploadSchema.safeParse(rawData);

  if (!result.success) {
    throw new HttpError(422, {
      error: "فشل التحقق من صحة الملف والبيانات",
      issues: result.error.flatten().fieldErrors,
    });
  }

  const { title, avatar } = result.data;

  // 4. حفظ الملف على القرص باستخدام سرعة Bun الفائقة
  const fileName = `${Date.now()}-${avatar.name}`;
  await Bun.write(`./uploads/${fileName}`, avatar);

  return json(
    {
      success: true,
      title,
      savedFile: fileName,
      fileSize: avatar.size,
    },
    201,
  );
});

app.listen(3000);
```

---

## 5. التحقق البحت بدون أي مكتبات خارجية (Pure Zero-Dependency)

إذا كنت تريد تجنب الاعتماد على أي حزم والتحقق برمجياً بأسرع أداء ممكن:

### مثال كامل: معالج تحقق يدوي نقي

```ts
import { App, json, HttpError } from "@barqel/barq";

const app = new App();

app.post("/pure-check", async (ctx) => {
  const data = await ctx.json<unknown>();

  // التأكد من أن المدخل كائن وليس null أو مصفوفة
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new HttpError(400, { error: "يجب إرسال كائن JSON صالح" });
  }

  const payload = data as Record<string, unknown>;

  // فحص حقل الاسم
  if (typeof payload.name !== "string" || payload.name.trim().length < 2) {
    throw new HttpError(422, { error: "حقل name مطلوب ويجب ألا يقل عن حرفين" });
  }

  // فحص حقل البريد
  if (
    typeof payload.email !== "string" ||
    !payload.email.includes("@") ||
    !payload.email.includes(".")
  ) {
    throw new HttpError(422, { error: "البريد الإلكتروني غير صالح" });
  }

  return json({
    verified: true,
    user: {
      name: payload.name.trim(),
      email: payload.email.trim(),
    },
  });
});

app.listen(3000);
```

---

## ملخص المقارنة

| النمط | الأداة | الاستخدام الأنسب | المزايا |
|---|---|---|---|
| **`validateJson`** | Standard Schema / Zod | واجهات REST APIs القياسية | كتابة كود أقل، استنتاج مباشر للأنواع، رد أخطاء تلقائي |
| **التحقق المباشر بالـ Schema** | `Schema.safeParse` داخل المعالج | النماذج، الملفات، الـ Query | مرونة تامة في التعامل مع الملفات وتخصيص كائنات الخطأ |
| **التحقق اليدوي البحت** | فحص الشروط بـ TypeScript | مسارات فائقة الحساسية للأداء | صفر اعتماديات، أقصى سرعة تنفيذ، صفر كائنات وسيطة |
