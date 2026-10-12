---
title: إصدارات الـ API (Versioning)
description: إدارة إصدارات واجهات البرمجة بسهولة عبر الترويسات أو المعلمات أو أنواع الوسائط في Barq.
---

# إصدارات الـ API (Versioning)

تتيح إضافة `@barqel/barq-versioning` إدارة إصدارات الـ API المتعددة بسلاسة دون الحاجة لتكرار تعريف المسارات، مع دعم استخراج الإصدار عبر ترويسات HTTP أو معلمات الاستعلام أو أنواع الوسائط (Media Types).

## التثبيت

```bash
bun add @barqel/barq-versioning
```

## البداية السريعة

توجيه نفس المسار إلى دوال معالجة مختلفة بناءً على رقم الإصدار المطلوب:

```ts
import { App, json } from "@barqel/barq";
import { version } from "@barqel/barq-versioning";

const app = new App();

app.get(
  "/users/:id",
  version(
    {
      "1": (ctx) => json({ id: ctx.params.id, name: "مستخدم تقليدي" }),
      "2": (ctx) => json({ id: ctx.params.id, firstName: "مستخدم", lastName: "حديث" }),
    },
    { defaultVersion: "1" }
  )
);

app.listen(3000);
```

يمكن للعميل تحديد الإصدار بعدة طرق:
* **ترويسة**: `Accept-Version: 2` (أو `Accept-Version: v2`)
* **معامل استعلام**: `GET /users/42?v=2`

## استراتيجيات تحديد الإصدار

يمكن تخصيص استراتيجية الاستخراج على مستوى المسار أو عبر الإضافة العامة `versioningPlugin()`:

### 1. عبر ترويسة مخصصة (HTTP Header)
```ts
version(handlers, {
  type: "header",
  header: "X-API-Version",
});
```

### 2. عبر رابط الاستعلام (Query Parameter)
```ts
version(handlers, {
  type: "query",
  query: "api-version",
});
```

### 3. عبر نوع الوسائط (Content Negotiation)
```ts
version(handlers, {
  type: "media-type",
  mediaTypePrefix: "application/vnd.myapi",
});
// يطابق: Accept: application/vnd.myapi.v2+json
```

## التكامل الشامل عبر الإضافة (Plugin)

استخراج الإصدار تلقائياً وحقنه في سياق الطلب `ctx.state.version`:

```ts
import { versioningPlugin } from "@barqel/barq-versioning";

app.plugin(
  versioningPlugin({
    header: "Accept-Version",
    defaultVersion: "1",
  })
);
```

## خيارات الإعداد

| الخيار | النوع | القيمة الافتراضية | الوصف |
| :--- | :--- | :--- | :--- |
| `type` | `"header" \| "query" \| "media-type" \| array` | `["header", "query"]` | استراتيجيات استخراج الإصدار |
| `header` | `string` | `"accept-version"` | اسم الترويسة المحددة للإصدار |
| `query` | `string` | `"v"` | اسم معامل الاستعلام في الرابط |
| `mediaTypePrefix` | `string` | `"application/vnd.api"` | بادئة نوع الوسائط لمفاوضة المحتوى |
| `defaultVersion` | `string` | `undefined` | الإصدار الافتراضي في حال عدم تحديده |
| `normalize` | `(ver: string) => string` | إزالة `v` والمسافات | دالة لتوحيد صيغ الإصدارات |
| `onInvalidVersion` | `(ctx, ver, supported) => Response` | `400 Bad Request` | معالج مخصص للإصدارات غير المدعومة |
