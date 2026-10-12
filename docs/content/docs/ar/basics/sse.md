---
title: أحداث الخادم (Server-Sent Events)
description: بث مباشر عالي الأداء لأحداث الخادم وتدفق مخرجات الذكاء الاصطناعي (LLM Streaming) بدون اعتماديات في Barq.
---

# أحداث الخادم (Server-Sent Events)

توفر إضافة `@barqel/barq-sse` آلية بث مستمر للبيانات (SSE) متوافقة مع معيار WHATWG، مبنية على Web Streams مع إدارة تلقائية للمهل الزمنية، وإرسال نبضات الحفاظ على الاتصال (Keep-Alive)، ودعم المولدات اللاتزامنية (Async Iterables).

## التثبيت

```bash
bun add @barqel/barq-sse
```

## البداية السريعة

```ts
import { App } from "@barqel/barq";
import { sse } from "@barqel/barq-sse";

const app = new App();

app.get("/events", (ctx) => {
  return sse(ctx, async (emitter) => {
    emitter.send({ event: "connected", data: "welcome" });

    for (let i = 1; i <= 3; i++) {
      if (emitter.isClosed) break;
      await Bun.sleep(1000);
      emitter.send({
        id: i,
        event: "counter",
        data: { value: i },
      });
    }

    emitter.close();
  });
});

app.listen(3000);
```

## بث نصوص الذكاء الاصطناعي (LLM Streaming)

يمكن تمرير مولدات الرموز (Tokens) اللاتزامنية مباشرة عبر `sseStream`:

```ts
import { sseStream } from "@barqel/barq-sse";

async function* tokenGenerator() {
  yield "Hello";
  yield " ";
  yield "world!";
}

app.get("/chat", (ctx) => {
  return sseStream(
    ctx,
    tokenGenerator(),
    (token) => ({ event: "delta", data: token }),
  );
});
```

## الترويسات المفعلة ونبضات الاتصال (Heartbeat)

تضبط الإضافة تلقائياً:
* `Content-Type: text/event-stream; charset=utf-8`
* `Cache-Control: no-cache, no-transform`
* `X-Accel-Buffering: no` لمنع Nginx والوكلاء من تخزين الاستجابة مؤقتاً.
* إرسال تعليق دوري `: ping\n\n` كل 15 ثانية لمنع انقطاع الاتصال الخامل.
