---
title: توثيق OpenAPI و Swagger
description: توليد مواصفات OpenAPI 3.1 وتقديم واجهات توثيق تفاعلية باستخدام Scalar أو Swagger UI في Barq.
---

# توثيق OpenAPI و Swagger

توفر إضافة `@barqel/barq-openapi` ميزة توليد مواصفات OpenAPI 3.1 التلقائية وعرض صفحات التوثيق التفاعلية لتطبيقات Barq.

تعتمد الإضافة مبدأ "المصدر الموحد للحقيقة" (Single Source of Truth)؛ حيث يتم تعريف مخطط المسار (Schema) مرة واحدة للتحقق من المدخلات، واستنتاج الأنواع، وتوليد التوثيق في آنٍ واحد.

## التثبيت

أضف حزمة الإضافة إلى المشروع:

```bash
bun add @barqel/barq-openapi
```

## البداية السريعة

ركّب الإضافة باستخدام `app.plugin()`:

```ts
import { App, json } from "@barqel/barq";
import { openapi } from "@barqel/barq-openapi";

const app = new App();

app.plugin(
  openapi({
    title: "متجر بارق",
    version: "1.0.0",
    description: "واجهة برمجية عالية الأداء مبنية باستخدام Barq",
    docsPath: "/docs",
    specPath: "/openapi.json",
    ui: "scalar",
  }),
);

app.get(
  "/products/:id",
  {
    schema: {
      tags: ["المنتجات"],
      summary: "جلب تفاصيل المنتج",
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      responses: {
        200: { description: "تم جلب بيانات المنتج بنجاح" },
      },
    },
  },
  (ctx) => {
    const valid = ctx.valid as { params: { id: string } };
    return json({ id: valid.params.id, name: "لوحة مفاتيح" });
  },
);

app.listen(3000);
```

افتح الرابط `http://localhost:3000/docs` لمشاهدة واجهة التوثيق التفاعلية، والرابط `http://localhost:3000/openapi.json` لمشاهدة مواصفة JSON الخام.

## التحقق والتوثيق المعتمد على المخطط

عند تمرير الخاصية `schema` إلى المسار، يقوم Barq بربط وسيط التحقق تلقائياً واستخراج معلمات الرابط. تتوفر البيانات بعد فحصها عبر `ctx.valid`.

```ts
import { z } from "zod";

const CreateProductSchema = z.object({
  name: z.string().min(2),
  price: z.number().positive(),
  category: z.enum(["electronics", "clothing", "books"]),
});

app.post(
  "/products",
  {
    schema: {
      tags: ["المنتجات"],
      summary: "إنشاء منتج جديد",
      body: CreateProductSchema,
      responses: {
        201: {
          description: "تم إنشاء المنتج بنجاح",
          content: z.object({
            id: z.string(),
            name: z.string(),
            price: z.number(),
          }),
        },
        422: {
          description: "فشل التحقق من صحة المدخلات",
        },
      },
    },
  },
  (ctx) => {
    const { body } = ctx.valid as { body: z.infer<typeof CreateProductSchema> };
    return json({ id: "prod_1", ...body }, 201);
  },
);
```

## خطط المصادقة والأمان (Security Schemes)

يمكن إعداد تعريفات الأمان العامة مثل رموز Bearer أو مفاتيح API:

```ts
app.plugin(
  openapi({
    title: "الخدمة المحمية",
    version: "1.0.0",
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
  }),
);

app.get(
  "/profile",
  {
    schema: {
      tags: ["المستخدم"],
      summary: "عرض الملف الشخصي للمستخدم المسجل",
      security: [{ bearerAuth: [] }],
    },
  },
  (ctx) => json({ user: ctx.state.user }),
);
```

## مجموعات المسارات (Route Groups)

المسارات المعرفة داخل `app.group()` ترث البادئة الخاصة بالمجموعة تلقائياً في وثيقة التوثيق:

```ts
app.group("/api/v1", (v1) => {
  v1.get(
    "/health",
    {
      schema: {
        tags: ["النظام"],
        summary: "فحص حالة الخدمة",
      },
    },
    () => json({ status: "healthy" }),
  );
});
```

## خيارات الإعداد

| الخيار | النوع | القيمة الافتراضية | الوصف |
| :--- | :--- | :--- | :--- |
| `title` | `string` | `"API Documentation"` | عنوان الوثيقة وواجهة العرض |
| `version` | `string` | `"1.0.0"` | رقم إصدار الواجهة البرمجية |
| `description` | `string` | `undefined` | وصف توضيحي للخدمة |
| `docsPath` | `string` | `"/docs"` | مسار صفحة التوثيق التفاعلية |
| `specPath` | `string` | `"/openapi.json"` | مسار ملف مواصفة OpenAPI 3.1.0 بصيغة JSON |
| `ui` | `"scalar" \| "swagger"` | `"scalar"` | محرك واجهة المستخدم (`scalar` أو `swagger`) |
| `securitySchemes` | `Record<string, OpenAPISecurityScheme>` | `undefined` | تعريفات آليات التحقق والمصادقة |
| `servers` | `Array<{ url: string; description?: string }>` | `undefined` | عناوين خوادم التشغيل |
