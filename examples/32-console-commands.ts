import { createCli } from "../packages/cli/src";

const cli = createCli({
  name: "barq-artisan",
  version: "1.0.0",
  description: "Barq Application Management Toolkit",
});

cli.command(
  "make:service <name>",
  {
    description: "Create a new microservice boilerplate",
    flags: {
      port: { type: "number", alias: "p", default: 3000, description: "Port number" },
      docker: { type: "boolean", default: true, description: "Generate Dockerfile" },
    },
  },
  (ctx) => {
    ctx.log.info(`Creating service: ${ctx.args.name}...`);
    ctx.log.success(`Service created on port ${ctx.flags.port}`);
    if (ctx.flags.docker) {
      ctx.log.success(`Dockerfile generated`);
    }
  }
);

cli.command(
  "db:seed [count]",
  {
    description: "Seed mock records into the database",
    flags: {
      clean: { type: "boolean", alias: "c", default: false, description: "Wipe data before seeding" },
    },
  },
  async (ctx) => {
    const total = ctx.args.count ? Number(ctx.args.count) : 25;
    ctx.log.warn(`Seeding ${total} records... (clean=${ctx.flags.clean})`);
    await Bun.sleep(150);
    ctx.log.table([
      { id: 1, role: "Admin", status: "Active" },
      { id: 2, role: "Member", status: "Pending" },
    ]);
    ctx.log.success(`Seeding completed successfully!`);
  }
);

// Execute directly with process arguments
cli.run();
