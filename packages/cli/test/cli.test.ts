import { describe, expect, it, spyOn } from "bun:test";
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

	it("shows the command usage when a required argument is missing", async () => {
		const cli = createCli({ name: "test-cli" });
		const output: string[] = [];
		const logSpy = spyOn(console, "log").mockImplementation(
			(...args: unknown[]) => {
				output.push(args.map(String).join(" "));
			},
		);
		const errorSpy = spyOn(console, "error").mockImplementation(
			(...args: unknown[]) => {
				output.push(args.map(String).join(" "));
			},
		);

		try {
			cli.command("greet <name>", () => {});
			await cli.run(["node", "cli.js", "greet"]);
		} finally {
			logSpy.mockRestore();
			errorSpy.mockRestore();
			process.exitCode = 0;
		}

		const text = Bun.stripANSI(output.join("\n"));
		expect(text).toContain("Missing required argument <name>");
		expect(text).toContain("Usage: test-cli greet <name> [flags]");
	});
});
