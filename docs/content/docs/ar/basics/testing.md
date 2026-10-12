---
title: عميل الاختبارات المباشر (Testing)
description: اختبار مسارات HTTP فائق السرعة في الذاكرة مباشرة بدون فتح منافذ شبكة في Barq.
---

# عميل الاختبارات المباشر (Testing)

توفر حزمة `@barqel/barq-testing` عميل اختبارات متكامل ينفذ الطلبات مباشرة داخل الذاكرة دون الحاجة لفتح منافذ شبكة أو تشغيل وإيقاف السيرفر (`app.listen` / `server.stop`)، مما يسرع تشغيل الاختبارات بمئات المرات.

## التثبيت

```bash
bun add -d @barqel/barq-testing
```

## البداية السريعة

```ts
import { describe, expect, it } from "bun:test";
import { App, json } from "@barqel/barq";
import { testClient } from "@barqel/barq-testing";

const app = new App();
app.get("/users/:id", (ctx) => json({ id: ctx.params.id, name: "عادا" }));

describe("مسارات المستخدمين", () => {
  const client = testClient(app);

  it("جلب بيانات المستخدم", async () => {
    const res = await client.get("/users/42");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "42", name: "عادا" });
  });
});
```

## خيارات الطلب المتقدمة

تمرير معلمات الاستعلام، وأجسام JSON، والترويسات، والكوكيز، وعنوان IP:

```ts
const res = await client.post("/api/checkout", {
  query: { currency: "USD", dryRun: true },
  json: { itemId: "item_123", quantity: 2 },
  headers: { Authorization: "Bearer token" },
  cookies: { session: "sess_abc" },
  ip: "203.0.113.195",
});
```

## مساعدات الاستجابة

تحتوي الاستجابة المعادة على مساعدات تيسر الفحص:

* `res.cookies`: قراءة كوكيز `Set-Cookie` بسهولة (`res.cookies.get("session")?.value`).
* `res.header(name)`: اختصار لـ `res.headers.get(name)`.
* دوال القراءة القياسية (`res.json()`, `res.text()`, `res.blob()`).
