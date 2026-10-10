---
title: مرجع الواجهة البرمجية (API Reference)
description: المرجع الشامل لجميع الدوال والكلاسات والأنواع المصدرة من Barq.
---

# مرجع الواجهة البرمجية

يوفر Barq واجهة موحدة وصغيرة تعتمد على الصادرات العامة من حزمة `barq`. تم تصميم جميع الصادرات لتكون متوافقة مع TypeScript ومع بيئة تشغيل Bun.

## 1. الكلاسات الأساسية (Core Classes)

### `App<TState>`
نقطة الدخول الرئيسية لإنشاء التطبيق.

```ts
import { App } from "@barqel/barq";
const app = new App(options?: AppOptions);
```

#### دوال تسجيل المسارات:
* `app.get(path, ...middlewares, handler)`
* `app.post(path, ...middlewares, handler)`
* `app.put(path, ...middlewares, handler)`
* `app.delete(path, ...middlewares, handler)`
* `app.patch(path, ...middlewares, handler)`
* `app.head(path, ...middlewares, handler)`
* `app.options(path, ...middlewares, handler)`
* `app.all(path, ...middlewares, handler)`

#### دوال دورة حياة التطبيق والخادم:
* `app.use(...middlewares)`: تسجيل وسائط برمجية على مستوى التطبيق.
* `app.group(prefix, ...middlewares, callback)`: إنشاء مجموعة مسارات ذات بادئة مشتركة.
* `app.plugin(pluginFn, options?)`: تسجيل إضافة لتركيب المسارات والمكونات.
* `app.ws(path, handlers, beforeUpgrade?)`: تسجيل نقطة اتصال WebSocket.
* `app.notFound(handler)`: تخصيص استجابة 404 للمسارات غير الموجودة.
* `app.onError(handler)`: معالج مركزي عام للأخطاء غير المتوقعة.
* `app.listen(port?)`: بدء تشغيل خادم Bun والاستماع للطلبات.
* `app.cluster(port?)`: تشغيل خوادم متعددة (عمال) على أنوية Linux عبر `reusePort`.
* `app.stop(hardTimeoutMs?)`: إيقاف الخادم وسحب الاتصالات بسلاسة (Graceful Shutdown).

---

### `Context<TParams, TState>`
كائن سياق الطلب (`ctx`) الذي يتم تمريره للمعالجات والوسائط:

| الخاصية / الدالة | النوع | الوصف |
| :--- | :--- | :--- |
| `ctx.req` | `Request` | كائن الطلب القياسي من Fetch API. |
| `ctx.params` | `TParams` | معاملات المسار المستخرجة من الرابط. |
| `ctx.pathname` | `string` | مسار الطلب بعد معالجة الأجزاء النسبية. |
| `ctx.query` | `URLSearchParams` | كائن معاملات الاستعلام القياسي. |
| `ctx.queryParam(name)` | `string \| null` | قراءة قيمة استعلام واحدة بكفاءة كسولة. |
| `ctx.queryParamAll(name)` | `string[]` | قراءة جميع القيم المتكررة لمعامل استعلام. |
| `ctx.cookies` | `CookieJar` | كائن إدارة الكوكيز (قراءة، كتابة، توقيع). |
| `ctx.state` | `TState` | مساحة حفظ البيانات الخاصة بالطلب الحالي. |
| `ctx.ip` | `string` | عنوان IP للعميل مع تطبيق سياسة الثقة بالوكيل. |
| `ctx.json<T>()` | `Promise<T>` | قراءة جسم الطلب وتحليله كـ JSON. |
| `ctx.text()` | `Promise<string>` | قراءة جسم الطلب كنص عادي. |
| `ctx.redirect(url, status?)` | `Response` | إعادة توجيه العميل مع فحص النطاقات المسموحة. |
| `ctx.timeout(seconds)` | `this` | ضبط مهلة هذا الطلب بالثواني. |
| `ctx.disableTimeout()` | `this` | تعطيل مهلة الطلب (للعمليات الطويلة والتدفق). |

---

## 2. دوال الاستجابة (Response Helpers)

```ts
import { json, text, empty, redirect } from "@barqel/barq";
```

* `json(data, init?)`: إرجاع استجابة JSON مع ترويسة `application/json; charset=utf-8` مجهزة مسبقاً.
* `text(body, init?)`: إرجاع استجابة نصية عادية مع ترويسة `text/plain; charset=utf-8`.
* `empty(status?, headers?)`: إرجاع استجابة بدون جسم (الافتراضي: `204 No Content`).
* `redirect(url, status?, allowlist?)`: بناء استجابة إعادة توجيه (301, 302, 303, 307, 308).

---

## 3. الأخطاء والتحقق (Errors & Validation)

### `HttpError`
كلاس لرمي أخطاء HTTP مقصودة ومعالجتها تلقائياً:
```ts
throw new HttpError(status, body?, headers?);
```

### `validateJson(validator, handler)`
مساعد للتحقق من جسم الطلب متوافق مع معيار **Standard Schema v1** (مثل Zod و Valibot):
```ts
app.post("/users", validateJson(UserSchema, (ctx, body) => {
  return json({ user: body }, 201);
}));
```

---

## 4. البرمجيات الوسيطة والكوكيز (Middleware & Security)

### `cors(options?: CorsOptions)`
وسيط برمجي مدمج بدون اعتماديات لمعالجة طلبات الـ CORS والـ Preflight تلقائياً.

### `CookieJar`
واجهة إدارة ملفات تعريف الارتباط المتاحة عبر `ctx.cookies`:
* `cookies.get(name)`: قراءة كوكي عادي.
* `cookies.set(name, value, options?)`: تعيين كوكي مع خيارات الحماية.
* `cookies.getSigned(name, secret?)`: قراءة والتحقق من كوكي موقّع عبر HMAC-SHA256.
* `cookies.setSigned(name, value, options?, secret?)`: تعيين كوكي موقع كشفاً للتلاعب.
* `cookies.delete(name, options?)`: حذف الكوكي بإنهاء صلاحيته.
