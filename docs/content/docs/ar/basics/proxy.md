---
title: البوابة والوكيل العكسي (Proxy)
description: تحويل Barq إلى وكيل عكسي (Reverse Proxy) وبوابة خدمات (API Gateway) بأعلى أداء وبدون اعتماديات.
---

# البوابة والوكيل العكسي (Proxy)

تُحول إضافة `@barqel/barq-proxy` إطار Barq إلى بوابة (API Gateway) ووكيل عكسي فائق السرعة، لتوجيه الطلبات بأمان للخدمات الداخلية (Microservices)، مع إزالة الترويسات غير الضرورية (Hop-by-hop) ودعم نقل البيانات بالتدفق (Streaming).

## التثبيت

```bash
bun add @barqel/barq-proxy
```

## البداية السريعة

توجيه جميع الطلبات التي تبدأ ببادئة معينة إلى خدمة خلفية:

```ts
import { App } from "@barqel/barq";
import { proxy } from "@barqel/barq-proxy";

const app = new App();

app.all(
  "/api/billing/*path",
  proxy({
    target: "http://billing-service:8080",
    changeOrigin: true,
    pathRewrite: (path) => path.replace("/api/billing", ""),
  }),
);

app.listen(3000);
```

## اعتراض الطلبات والاستجابات

يمكنك حقن ترويسات ديناميكية أو فحص الاستجابة قبل إعادتها للعميل باستخدام `onProxyReq` و `onProxyRes`:

```ts
app.all(
  "/api/secure/*path",
  proxy({
    target: "http://internal-secure-api:4000",
    headers: {
      "X-Gateway-Secret": process.env.GATEWAY_SECRET,
    },
    onProxyReq: async (reqInit, ctx) => {
      // إضافة ترويسات ديناميكياً للطلب الموجه
      (reqInit.headers as Headers).set("X-Request-Id", ctx.state.requestId);
    },
    onProxyRes: async (proxyRes, ctx) => {
      // تعديل ترويسات الاستجابة القادمة
      const headers = new Headers(proxyRes.headers);
      headers.delete("Server"); 
      headers.set("X-Proxy-Cache", "MISS");
      
      return new Response(proxyRes.body, {
        status: proxyRes.status,
        headers,
      });
    },
  }),
);
```

## خيارات الإعداد

| الخيار | النوع | القيمة الافتراضية | الوصف |
| :--- | :--- | :--- | :--- |
| `target` | `string` | **مطلوب** | الرابط المستهدف (مثل `http://localhost:8080`) |
| `changeOrigin` | `boolean` | `false` | تغيير ترويسة `Host` لتطابق الرابط المستهدف |
| `pathRewrite` | `(path, ctx) => string \| Promise<string>` | `undefined` | دالة لإعادة كتابة المسار قبل توجيه الطلب |
| `headers` | `Record<string, string> \| Function` | `undefined` | ترويسات إضافية تُحقن في الطلب المُوجّه |
| `onProxyReq` | `(reqInit, ctx) => void` | `undefined` | دالة تُستدعى قبل إرسال الطلب للخدمة الخلفية |
| `onProxyRes` | `(proxyRes, ctx) => Response` | `undefined` | دالة تُستدعى لتعديل الاستجابة قبل إرسالها للعميل |
