---
title: Cron Jobs & Task Scheduler
description: Zero-dependency, lightweight, in-memory cron jobs and scheduled tasks for Barq.
---

# Cron Jobs & Task Scheduler

The `@barqel/barq-cron` plugin provides task scheduling for Barq applications with standard 5-part and 6-part cron patterns, presets, and overlap prevention.

## Installation

```bash
bun add @barqel/barq-cron
```

## Quick Start

```ts
import { App, json } from "@barqel/barq";
import { cron } from "@barqel/barq-cron";

const app = new App();
app.plugin(cron());

const scheduler = (app as any).cron;

(app as any).schedule("*/30 * * * * *", async (job) => {
  console.log(`Job executed: ${job.name}`);
});

app.get("/tasks", () => {
  return json({ tasks: scheduler.list() });
});

app.listen(3000);
```

## Supported Syntax

* Standard 5-field: `* * * * *` (Minute, Hour, Day of Month, Month, Day of Week)
* 6-field with seconds: `*/10 * * * * *` (Seconds, Minute, Hour, Day, Month, Day of Week)
* Presets: `@yearly`, `@annually`, `@monthly`, `@weekly`, `@daily`, `@midnight`, `@hourly`
* Interval shorthand: `@every 15s`, `@every 5m`, `@every 2h`

## Overlap Prevention & Timeouts

```ts
(app as any).schedule(
  "0 * * * *",
  async () => {
    await performHeavyDatabaseAggregation();
  },
  {
    name: "db_aggregation",
    preventOverlap: true,
    timeoutMs: 30000,
    onError: (err, job) => {
      console.error(`Task ${job.name} failed:`, err);
    },
  }
);
```

## Job Controls

```ts
const job = scheduler.get("db_aggregation");

job.pause();
job.resume();
await job.trigger();
job.stop();
```
