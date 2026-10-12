---
title: المهام المجدولة (Cron Jobs)
description: جدولة المهام والعمليات الدورية بأداء فائق وبدون اعتماديات خارجية في Barq.
---

# المهام المجدولة (Cron Jobs)

توفر إضافة `@barqel/barq-cron` نظام جدولة مهام مدمج لتطبيقات Barq يدعم صيغ Cron القياسية والتعبيرات الدورية وحماية تداخل المهام (Overlap Prevention).

## التثبيت

```bash
bun add @barqel/barq-cron
```

## البداية السريعة

```ts
import { App, json } from "@barqel/barq";
import { cron } from "@barqel/barq-cron";

const app = new App();
app.plugin(cron());

const scheduler = (app as any).cron;

(app as any).schedule("*/30 * * * * *", async (job) => {
  console.log(`تم تنفيذ المهمة: ${job.name}`);
});

app.get("/tasks", () => {
  return json({ tasks: scheduler.list() });
});

app.listen(3000);
```

## التعبيرات المدعومة

* 5 حقول قياسية: `* * * * *` (الدقائق، الساعات، يوم الشهر، الشهر، يوم الأسبوع)
* 6 حقول بدقة الثواني: `*/10 * * * * *` (الثواني، الدقائق، الساعات، يوم الشهر، الشهر، يوم الأسبوع)
* تعبيرات مسبقة: `@yearly`, `@monthly`, `@weekly`, `@daily`, `@hourly`
* الفترات الزمنية المباشرة: `@every 10s`, `@every 5m`, `@every 1h`

## منع تداخل المهام والمهلة الزمنية

```ts
(app as any).schedule(
  "0 * * * *",
  async () => {
    await performLongRunningTask();
  },
  {
    name: "long_task",
    preventOverlap: true,
    timeoutMs: 30000,
    onError: (err, job) => {
      console.error(`فشلت المهمة ${job.name}:`, err);
    },
  }
);
```
