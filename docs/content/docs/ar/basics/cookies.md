---
title: ملفات تعريف الارتباط
description: اقرأ كوكيز HTTP واكتبها ووقّعها واحذفها في تطبيقات Barq على Bun وNode.js.
---

تستخدم الكوكيز عبر `ctx.cookies`، وهو `CookieJar` خاص بالطلب. تقرأ الكوكيز الواردة عند أول استخدام للمخزن، وتضاف التغييرات إلى استجابة الطلب كترويسات `Set-Cookie`.

```ts
app.get("/preferences", (ctx) => {
  const theme = ctx.cookies.get("theme") ?? "system";
  return json({ theme });
});

app.post("/preferences", (ctx) => {
  ctx.cookies.set("theme", "dark", {
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    secure: true,
    sameSite: "Lax",
  });
  return json({ saved: true });
});
```

تعيد `get(name)` نصًا أو `undefined`. ترمز القيم باستخدام URL عند الكتابة وتفك ترميزها عند القراءة.

## خيارات الكوكي

تقبل `set(name, value, options?)` الخيارات `path` و`domain` و`maxAge` و`expires` و`httpOnly` و`secure` و`sameSite`. تكون الكوكي `HttpOnly` افتراضيًا، كما تكون `SameSite` هي `Lax`. استخدم `secure: true` عند الخدمة عبر HTTPS. يتطلب `SameSite=None` استخدام `secure: true`.

يحذف Barq الكوكي بكتابة كوكي منتهية الصلاحية. استخدم النطاق نفسه `path/domain` المستخدم عند إنشائها:

```ts
ctx.cookies.delete("theme", { path: "/", secure: true, sameSite: "Lax" });
```

## الكوكيز الموقّعة

اضبط سرًا عالي العشوائية وغير فارغ خارج الشيفرة:

```ts
const app = new App({ cookieSecret: process.env.COOKIE_SECRET });
```

استخدم `setSigned()` و`getSigned()`:

```ts
ctx.cookies.setSigned("session", "user-42", {
  path: "/",
  secure: true,
  sameSite: "Lax",
});

const userId = ctx.cookies.getSigned("session"); // نص أو null
```

تعيد `getSigned()` قيمة `null` إذا فشل التحقق أو لم يضبط سر التوقيع. يمكن تمرير سر مخصص اختياري إلى دوال الكوكي الموقعة. يكشف التوقيع التلاعب لكنه لا يشفر قيمة الكوكي أو يخفيها؛ لا تخزن إلا قيمًا آمنًا أن يراها العميل.

تفرض بادئات الكوكي شروطها: تتطلب `__Secure-` الخيار `secure`، وتتطلب `__Host-` الخيار `secure` و`path: "/"` وعدم تحديد `domain`.
