---
title: مقاييس الأداء (Prometheus)
description: تصدير مقاييس الأداء ومراقبة الخادم لتطبيقات Prometheus و Grafana بأعلى كفاءة وبدون اعتماديات في Barq.
---

# مقاييس الأداء (Prometheus)

توفر إضافة `@barqel/barq-prometheus` نظاماً متكاملاً لتتبع أداء خادم HTTP واستهلاك الموارد (الذاكرة والمعالج) وتصديرها بصيغة Prometheus القياسية لتسهيل بناء لوحات المراقبة في Grafana، وكل ذلك بـ 0 اعتماديات خارجية.

## التثبيت

```bash
bun add @barqel/barq-prometheus
```

## البداية السريعة

فعّل الإضافة لتسجيل عدد الطلبات، وزمن الاستجابة، واستهلاك النظام تلقائياً:

```ts
import { App, json } from "@barqel/barq";
import { prometheusPlugin } from "@barqel/barq-prometheus";

const app = new App();

app.plugin(
  prometheusPlugin({
    metricsPath: "/metrics",
    defaultMetrics: true,
  }),
);

app.get("/health", () => json({ status: "healthy" }));

app.listen(3000);
```

قم بضبط خادم Prometheus لسحب البيانات من `http://localhost:3000/metrics`.

## توحيد المسارات الديناميكية (Cardinality)

تتأثر أنظمة Prometheus سلبياً في حال وجود قيم لا نهائية في تصنيفات البيانات (Labels). لدمج مسارات مثل `/users/123` و `/users/456` في مقياس واحد، استخدم دالة `normalizePath`:

```ts
app.plugin(
  prometheusPlugin({
    normalizePath: (path) => {
      // تحويل /users/123 إلى النمط الثابت /users/:id
      if (path.startsWith("/users/")) return "/users/:id";
      return path;
    },
  }),
);
```

## المقاييس المتوفرة افتراضياً

* `http_requests_total` (عداد): إجمالي الطلبات مفصلة حسب (`method`, `path`, `status`).
* `http_request_duration_seconds` (مدرج تكراري - Histogram): قياس زمن الاستجابة وتصنيفه في شرائح (Buckets).
* `process_resident_memory_bytes` (مقياس): الذاكرة الفعلية المستهلكة (RSS).
* `nodejs_heap_size_total_bytes` (مقياس): حجم الذاكرة العشوائية (Heap).
* `process_cpu_seconds_total` (مقياس): وقت المعالج المستهلك.

## خيارات الإعداد

| الخيار | النوع | القيمة الافتراضية | الوصف |
| :--- | :--- | :--- | :--- |
| `metricsPath` | `string` | `"/metrics"` | مسار صفحة المقاييس النصية |
| `defaultMetrics` | `boolean` | `true` | تضمين مقاييس النظام (الذاكرة والمعالج) |
| `buckets` | `number[]` | `[0.005, 0.01, ..., 10]` | شرائح المدرج التكراري بالثواني لحساب زمن الاستجابة |
| `normalizePath` | `(path, ctx) => string`| `(path) => path` | دالة لتوحيد المسارات الديناميكية ومنع انفجار المقاييس |
| `skip` | `(ctx) => boolean` | `undefined` | دالة شرطية لاستبعاد مسارات معينة من التسجيل |
