---
title: Prometheus Metrics
description: Zero-dependency, high-performance Prometheus metrics exporter and tracing plugin for Barq.
---

# Prometheus Metrics

The `@barqel/barq-prometheus` plugin provides out-of-the-box system and HTTP performance metrics formatted for Prometheus and Grafana, entirely without external dependencies.

## Installation

```bash
bun add @barqel/barq-prometheus
```

## Quick Start

Enable the plugin to automatically track HTTP request counts, durations, and system memory/CPU usage:

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

Point your Prometheus scraper to `http://localhost:3000/metrics`.

## Handling Dynamic Routes (Cardinality)

Prometheus metrics suffer from performance issues if label values have too many unique variations (Cardinality Explosion). For dynamic routes like `/users/123` and `/users/456`, you should normalize the path back to its pattern:

```ts
app.plugin(
  prometheusPlugin({
    normalizePath: (path) => {
      // Convert /users/123 -> /users/:id
      if (path.startsWith("/users/")) return "/users/:id";
      return path;
    },
  }),
);
```

## Built-in Metrics

The plugin automatically exposes:

* `http_requests_total` (Counter): Broken down by `method`, `path`, and `status`.
* `http_request_duration_seconds` (Histogram): Request latency buckets.
* `process_resident_memory_bytes` (Gauge): Current RSS memory.
* `nodejs_heap_size_total_bytes` (Gauge): Heap allocation.
* `process_cpu_seconds_total` (Gauge): Uptime/CPU seconds consumed.

## Configuration Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `metricsPath` | `string` | `"/metrics"` | Endpoint exposing the Prometheus text format |
| `defaultMetrics` | `boolean` | `true` | Includes Node.js/Bun system metrics (Memory, CPU) |
| `buckets` | `number[]` | `[0.005, 0.01, ..., 10]` | Custom histogram bucket boundaries in seconds |
| `normalizePath` | `(path, ctx) => string`| `(path) => path` | Function to normalize dynamic paths for label limits |
| `skip` | `(ctx) => boolean` | `undefined` | Predicate to skip metric tracking for specific requests |
