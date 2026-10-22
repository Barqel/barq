import "reflect-metadata";
import { afterAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverModules } from "../src/auto-register";

const createdDirs: string[] = [];

async function createTempProject(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "barq-modules-"));
	createdDirs.push(dir);
	await writeFile(
		join(dir, "package.json"),
		JSON.stringify({ name: "test-app", type: "module" }),
	);
	return dir;
}

const listenerPath = join(import.meta.dir, "../src/events/listener.ts").replace(
	/\\/g,
	"/",
);
const jobPath = join(import.meta.dir, "../src/jobs/job.ts").replace(/\\/g, "/");
const commandPath = join(import.meta.dir, "../src/console/command.ts").replace(
	/\\/g,
	"/",
);

afterAll(async () => {
	for (const dir of createdDirs) {
		await rm(dir, { recursive: true, force: true });
	}
});

describe("Module discovery", () => {
	it("loads routes, jobs, listeners and commands from each module", async () => {
		const root = await createTempProject();

		await mkdir(join(root, "modules/user/routes"), { recursive: true });
		await mkdir(join(root, "modules/user/jobs"), { recursive: true });
		await mkdir(join(root, "modules/user/listeners"), { recursive: true });
		await mkdir(join(root, "modules/user/commands"), { recursive: true });

		await writeFile(
			join(root, "modules/user/routes/routes.ts"),
			`export function userRoutes(app) { app.group("/users", () => {}); }`,
		);
		await writeFile(
			join(root, "modules/user/jobs/report.ts"),
			`
			import { Job } from "${jobPath}";
			export default class ReportJob extends Job {
				readonly name = "report";
				readonly schedule = "* * * * *";
				handle() {}
			}
			`,
		);
		await writeFile(
			join(root, "modules/user/listeners/created.ts"),
			`
			import { Listener } from "${listenerPath}";
			export default class CreatedListener extends Listener.of("user.created") {
				handle() {}
			}
			`,
		);
		await writeFile(
			join(root, "modules/user/commands/hello.ts"),
			`
			import { Command } from "${commandPath}";
			export default class HelloCommand extends Command {
				readonly signature = "hello";
				handle() {}
			}
			`,
		);

		const result = await discoverModules(root);

		expect(result.routes?.length).toBe(1);
		expect(result.jobs.length).toBe(1);
		expect(result.listeners.length).toBe(1);
		expect(result.commands.length).toBe(1);
		expect(result.warnings).toEqual([]);
	});

	it("supports modules/<name>/routes.ts as the route entry", async () => {
		const root = await createTempProject();

		await mkdir(join(root, "modules/billing"), { recursive: true });
		await writeFile(
			join(root, "modules/billing/routes.ts"),
			`export default function billingRoutes(app) { app.group("/billing", () => {}); }`,
		);

		const result = await discoverModules(root);

		expect(result.routes?.length).toBe(1);
	});

	it("deep-merges locales across modules instead of dropping duplicates", async () => {
		const root = await createTempProject();

		await mkdir(join(root, "modules/shared/locales"), { recursive: true });
		await mkdir(join(root, "modules/user/locales"), { recursive: true });

		await writeFile(
			join(root, "modules/shared/locales/en.ts"),
			`export default { common: "shared", middleware: { apiKey: "Missing" } };`,
		);
		await writeFile(
			join(root, "modules/user/locales/en.ts"),
			`export default { common: "user", users: { label: "User" } };`,
		);

		const result = await discoverModules(root);

		expect(result.translations.en).toEqual({
			common: "user",
			middleware: { apiKey: "Missing" },
			users: { label: "User" },
		});
		expect(result.warnings).toEqual([]);
	});

	it("warns and skips a route file that exports multiple functions", async () => {
		const root = await createTempProject();

		await mkdir(join(root, "modules/bad"), { recursive: true });
		await writeFile(
			join(root, "modules/bad/routes.ts"),
			`
			export function first() {}
			export function second() {}
			`,
		);

		const result = await discoverModules(root);

		expect(result.routes?.length).toBe(0);
		expect(result.warnings.some((w) => w.code === "MULTIPLE_EXPORTS")).toBe(
			true,
		);
	});
});
