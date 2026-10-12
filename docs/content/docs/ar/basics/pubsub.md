---
title: غرف البث (WebSocket Pub/Sub)
description: إدارة غرف WebSockets والبث الجماعي بأداء فائق وبدون اعتماديات في Barq.
---

# غرف البث (WebSocket Pub/Sub)

توفر إضافة `@barqel/barq-pubsub` نظاماً متكاملاً لإدارة المشتركين في غرف WebSockets وإرسال الرسائل الجماعية. الإضافة مصممة كغلاف خفيف يستفيد كلياً من سرعة دوال `ServerWebSocket.publish()` و `subscribe()` المدمجة في محرك Bun (C++)، مع الاحتفاظ بحالة الغرف في الذاكرة لتوفير ميزات متقدمة مثل إرسال الإشعارات من مسارات HTTP لمعماري الغرف.

## التثبيت

```bash
bun add @barqel/barq-pubsub
```

## البداية السريعة

ركّب الإضافة واستخدم كائن `pubsub` لإدارة الغرف والرسائل:

```ts
import { App, json } from "@barqel/barq";
import { pubsubPlugin, type PubSubRegistry } from "@barqel/barq-pubsub";

const app = new App();

app.plugin(pubsubPlugin());
const pubsub = (app as any).pubsub as PubSubRegistry;

app.ws("/chat", {
  message(ws, msg) {
    const data = JSON.parse(msg.toString());
    
    if (data.action === "join") {
      pubsub.subscribe(ws, data.room);
    } 
    else if (data.action === "send") {
      pubsub.publish(data.room, JSON.stringify({ text: data.text }));
    }
  },
  close(ws) {
    pubsub.unsubscribeAll(ws); // حماية من تسرب الذاكرة
  }
});

// إرسال رسالة إلى غرفة WebSocket عبر مسار HTTP اعتيادي
app.post("/api/alert", async (ctx) => {
  pubsub.publish("general", "إغلاق للصيانة بعد 5 دقائق!");
  return json({ success: true });
});

app.listen(3000);
```

## الواجهة البرمجية (API)

### `subscribe(ws, room)`
يضم الاتصال (Socket) لغرفة معينة. يستدعي تلقائياً دالة `ws.subscribe()` الأصلية في بيئة Bun.

### `unsubscribe(ws, room)`
يزيل الاتصال من الغرفة.

### `unsubscribeAll(ws)`
يزيل الاتصال من كافة الغرف المشترك بها. **يجب دائماً استدعاء هذه الدالة** داخل حدث `close` الخاص بـ WebSocket لتنظيف الذاكرة.

### `publish(room, message, compress?)`
يرسل رسالة (نص، أو Buffer، أو Uint8Array) لجميع المتصلين في الغرفة. تعمل هذه الدالة بكفاءة استثنائية عبر التقاط اتصال نشط داخل الغرفة واستخدام آلية البث المدمجة في Bun للوصول للجميع بلمح البصر.

### `publishToAll(message, compress?)`
يرسل رسالة فورية إلى كافة اتصالات WebSocket النشطة والمسجلة في الإضافة، بغض النظر عن غرفهم.

### `getRoomSize(room)`
يعيد عدد الاتصالات النشطة حالياً داخل الغرفة المحددة.

### `getRooms(ws)`
يعيد مصفوفة بأسماء الغرف التي يشترك بها اتصال معين.
