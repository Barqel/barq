---
title: ضغط الاستجابات (Compression)
description: تقليل استهلاك الباندويث وتسريع الشبكة عبر ضغط gzip و brotli و deflate في Barq.
---

# ضغط الاستجابات (Compression)

توفر إضافة `@barqel/barq-compress` ضغطاً تلقائياً عالي الكفاءة للاستجابات يدعم خوارزميات `brotli` و `gzip` و `deflate` بالاعتماد على تدفقات الويب المدمجة (`CompressionStream`) بدون أي مكتبات خارجية.

## التثبيت

```bash
bun add @barqel/barq-compress
```

## البداية السريعة

تفعيل الضغط لجميع المسارات:

```ts
import { App, json } from "@barqel/barq";
import { compressPlugin } from "@barqel/barq-compress";

const app = new App();

app.plugin(
  compressPlugin({
    threshold: 1024,
    encodings: ["br", "gzip", "deflate"],
  }),
);

app.get("/items", () => {
  return json({
    data: Array.from({ length: 500 }, (_, i) => ({ id: i, name: `عنصر ${i}` })),
  });
});

app.listen(3000);
```

## المفاوضة على التشفير (Encoding Negotiation)

تحلل الإضافة ترويسة `Accept-Encoding` وقيم الأوزان (`q`) الممررة من المتصفح وتختار أفضل خوارزمية مدعومة بالترتيب:
1. `br` (Brotli)
2. `gzip`
3. `deflate`

## الحدود الدنيا والترشيح التلقائي

* يتم تجاوز الاستجابات التي يقل حجمها عن `threshold` (افتراضياً 1024 بايت) لتجنب هدر المعالج في الاستجابات الصغيرة جداً.
* يتم ضغط أنواع المحتوى القابلة للضغط فقط (`text/*`, `application/json`, `application/javascript`, `image/svg+xml`, إلخ).
* ترفق الترويسة القياسية `Vary: Accept-Encoding` تلقائياً لضمان سلامة الكاش لدى الوكلاء ومقدمي CDN.
