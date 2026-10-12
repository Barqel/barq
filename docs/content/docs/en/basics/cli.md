---
title: Console Commands (CLI)
description: Zero-dependency console commands runner and CLI toolkit for Barq applications.
---

# Console Commands (CLI)

The `@barqel/barq-cli` package provides a lightweight, zero-dependency console command toolkit for building artisan-style CLI utilities, background workers, and database migration tasks.

## Installation

```bash
bun add @barqel/barq-cli
```

## Quick Start

```ts
import { createCli } from "@barqel/barq-cli";

const cli = createCli({
  name: "barq-artisan",
  version: "1.0.0",
});

cli.command(
  "db:seed <tableCount>",
  {
    description: "Seed records into database",
    flags: {
      fresh: { type: "boolean", default: false, description: "Wipe before seeding" },
    },
  },
  async (ctx) => {
    ctx.log.info(`Seeding ${ctx.args.tableCount} tables...`);
    ctx.log.success("Database seeded successfully!");
  }
);

cli.run();
```

Run commands directly:
```bash
bun run cli.ts db:seed 10 --fresh
```
