---
title: التحقق عبر Zod
description: وسيط عالي الأداء ومريح للتحقق من البيانات والمخططات باستخدام Zod في Barq.
---

# التحقق عبر Zod

توفر إضافة `@barqel/barq-zod` وسيطاً مخصصاً لمكتبة Zod لفحص وتدقيق أجسام الطلبات (Body)، ومعلمات الاستعلام (Query)، ومعلمات الرابط (Params)، والترويسات مع استنتاج الأنواع داخل `ctx.valid`.

## التثبيت

```bash
bun add @barqel/barq-zod zod
```

## البداية السريعة

### فحص هدف محدد (`zValidator`)

```ts
import { App, json } from "@barqel/barq";
import { zValidator } from "@barqel/barq-zod";
import { z } from "zod";

const app = new App();

const UserSchema = z.object({
  name: z.string().min(3),
  age: z.number().int().min(18),
});

app.post("/users", zValidator("json", UserSchema), (ctx) => {
  const { body } = ctx.valid as { body: z.infer<typeof UserSchema> };
  return json({ user: body }, 201);
});

app.listen(3000);
```

### فحص أهداف متعددة في خطوة واحدة (`validateZod`)

```ts
import { validateZod } from "@barqel/barq-zod";

app.get(
  "/products/:id",
  validateZod({
    params: z.object({ id: z.string().regex(/^\d+$/) }),
    query: z.object({ currency: z.enum(["USD", "EUR"]).default("USD") }),
  }),
  (ctx) => {
    const valid = ctx.valid as { params: { id: string }; query: { currency: string } };
    return json({ id: valid.params.id, currency: valid.query.currency });
  }
);
```
