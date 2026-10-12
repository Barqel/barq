---
title: أوامر الطرفية (Console CLI)
description: نظام أوامر طرفية كامل مثل Artisan لإدارة المهام وتحديثات قواعد البيانات بدون اعتماديات في Barq.
---

# أوامر الطرفية (Console CLI)

توفر حزمة `@barqel/barq-cli` نظاماً لبناء وتشغيل أوامر الطرفية (CLI) بدون أي اعتماديات خارجية لإدارة المهام، والـ Migrations، وعمال الخلفية بأسلوب شبيه بـ Laravel Artisan.

## التثبيت

```bash
bun add @barqel/barq-cli
```

## البداية السريعة

```ts
import { createCli } from "@barqel/barq-cli";

const cli = createCli({
  name: "barq-artisan",
  version: "1.0.0",
});

cli.command(
  "db:seed <tableCount>",
  {
    description: "توليد بيانات وهمية لقواعد البيانات",
    flags: {
      fresh: { type: "boolean", default: false, description: "مسح البيانات القديمة أولاً" },
    },
  },
  async (ctx) => {
    ctx.log.info(`جاري تهيئة ${ctx.args.tableCount} جدول...`);
    ctx.log.success("تم الانتهاء بنجاح!");
  }
);

cli.run();
```

تشغيل الأوامر مباشرة:
```bash
bun run cli.ts db:seed 10 --fresh
```
