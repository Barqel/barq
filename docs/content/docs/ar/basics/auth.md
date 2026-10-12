---
title: المصادقة و JWT
description: مصادقة عالية الأداء، توقيع والتحقق من رموز JWT، وتشفير كلمات المرور بدون اعتماديات خارجية في Barq.
---

# المصادقة و JWT

توفر إضافة `@barqel/barq-auth` منظومة مصادقة متكاملة بدون أي اعتماديات خارجية، تشمل توقيع والتحقق من رموز JWT، وتشفير كلمات المرور عبر PBKDF2، ووسائط التحكم في الصلاحيات (RBAC).

## التثبيت

```bash
bun add @barqel/barq-auth
```

## البداية السريعة

```ts
import { App, json } from "@barqel/barq";
import { bearerAuth, hashPassword, requireRoles, signJwt, verifyPassword } from "@barqel/barq-auth";

const app = new App();
const JWT_SECRET = process.env.JWT_SECRET || "secure-random-secret-key-32-chars";

app.post("/login", async (ctx) => {
  const { email, password } = (await ctx.json()) as any;

  const valid = verifyPassword(password, storedHash);
  if (!valid) return json({ error: "Invalid credentials" }, 401);

  const token = signJwt({ sub: "user-1", email, role: "admin" }, JWT_SECRET, {
    expiresIn: "2h",
  });

  return json({ token });
});

app.get("/profile", bearerAuth({ secret: JWT_SECRET }), (ctx) => {
  return json({ user: ctx.state.user });
});

app.get(
  "/admin",
  bearerAuth({ secret: JWT_SECRET }),
  requireRoles("admin"),
  () => json({ secret: "administrative-data" }),
);

app.listen(3000);
```

## دوال JWT

### `signJwt(payload, secret, options?)`

إنشاء وتوقيع رمز JWT بصيغة مشفرة وآمنة.

```ts
const token = signJwt(
  { id: "usr_100", role: "member" },
  JWT_SECRET,
  { expiresIn: "1d", algorithm: "HS256" }
);
```

### `verifyJwt(token, secret, options?)`

التحقق من صحة التوقيع وصلاحية الرمز والمطالبات الزمنية. تعيد بيانات الرمز أو ترمي استثناء `AuthError`.

```ts
const payload = verifyJwt(token, JWT_SECRET);
```

## تشفير كلمات المرور

تشفير آمن يعتمد على خوارزمية PBKDF2 ومولد أرقام عشوائية آمن دون مكتبات إضافية.

```ts
const hash = hashPassword("plain-password");
const isMatch = verifyPassword("plain-password", hash);
```

## الوسائط البرمجية (Middleware)

### `bearerAuth(options)`

قراءة رمز التحقق من ترويسة `Authorization: Bearer <token>` أو ملفات تعريف الارتباط، والتحقق منه، وتمرير المستخدم إلى `ctx.state.user`.

```ts
app.get("/dashboard", bearerAuth({ secret: JWT_SECRET }), (ctx) => {
  return json({ id: ctx.state.user.sub });
});
```

### `requireRoles(...roles)`

حماية المسارات بناءً على أدوار المستخدم في `ctx.state.user.role`. تعيد رمز `403 Forbidden` في حال عدم تطابق الصلاحيات.

```ts
app.delete("/users/:id", bearerAuth({ secret: JWT_SECRET }), requireRoles("admin"), deleteUser);
```
