import { describe, expect, it } from "bun:test";
import { createCli } from "../src/index";

describe("@barqel/barq-cli", () => {
	it("parses positional arguments and flags correctly", async () => {
		const cli = createCli({ name: "test-cli" });
		let captured: any = null;

		cli.command(
			"user:create <name> [role]",
			{
				flags: {
					active: { type: "boolean", default: true },
					teamId: { type: "number", required: true },
				},
			},
			(ctx) => {
				captured = ctx;
			},
		);

		await cli.run([
			"node",
			"cli.js",
			"user:create",
			"Grace",
			"admin",
			"--teamId",
			"42",
			"--active",
		]);

		expect(captured).toBeDefined();
		expect(captured.args.name).toBe("Grace");
		expect(captured.args.role).toBe("admin");
		expect(captured.flags.teamId).toBe(42);
		expect(captured.flags.active).toBe(true);
	});

	it("supports flag aliases", async () => {
		const cli = createCli();
		let debugVal = false;

		cli.command(
			"run",
			{
				flags: {
					debug: { type: "boolean", alias: "d" },
				},
			},
			(ctx) => {
				debugVal = ctx.flags.debug;
			},
		);

		await cli.run(["node", "cli.js", "run", "-d"]);
		expect(debugVal).toBe(true);
	});
});
