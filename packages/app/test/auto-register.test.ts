import "reflect-metadata";
import { afterAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	defineConfigAsync,
	discover,
	mergeManualAndAuto,
	resolveDirectory,
} from "../src/auto-register";
import { Command } from "../src/console/command";
import { Job } from "../src/jobs/job";
import { createApp } from "../src/kernel/app";
import { createTestApp } from "../src/testing";

const createdDirs: string[] = [];

async function createTempProject(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "barq-auto-reg-"));
	createdDirs.push(dir);
	await writeFile(
		join(dir, "package.json"),
		JSON.stringify({ name: "test-app", type: "module" }),
	);
	return dir;
}

afterAll(async () => {
	for (const dir of createdDirs) {
		await rm(dir, { recursive: true, force: true });
	}
});

describe("Auto-Register: Success cases (§7.1)", () => {
	it("1. discovers jobs in app/jobs with 'class X extends Job'", async () => {
		const root = await createTempProject();
		await mkdir(join(root, "app/jobs"), { recursive: true });
		await writeFile(
			join(root, "app/jobs/send-emails.ts"),
			`
			import { Job } from "${join(import.meta.dir, "../src/jobs/job.ts").replace(/\\/g, "/")}";
			export default class SendEmailsJob extends Job {
				readonly name = "send-emails";
				readonly schedule = "* * * * *";
				handle() {}
			}
			`,
		);

		const result = await discover(root, { jobs: true });
		expect(result.jobs.length).toBe(1);
		expect(result.warnings.length).toBe(0);
		const JobCls = result.jobs[0]!;
		expect(JobCls.prototype instanceof Job).toBe(true);
	});

	it("2. discovers listeners and commands correctly", async () => {
		const root = await createTempProject();
		await mkdir(join(root, "app/listeners"), { recursive: true });
		await mkdir(join(root, "app/commands"), { recursive: true });

		await writeFile(
			join(root, "app/listeners/user-registered.ts"),
			`
			import { Listener } from "${join(import.meta.dir, "../src/events/listener.ts").replace(/\\/g, "/")}";
			export default class UserRegisteredListener extends Listener.of("user.registered") {
				handle() {}
			}
			`,
		);

		await writeFile(
			join(root, "app/commands/greet.ts"),
			`
			import { Command } from "${join(import.meta.dir, "../src/console/command.ts").replace(/\\/g, "/")}";
			export default class GreetCommand extends Command {
				readonly signature = "greet <name>";
				handle() {}
			}
			`,
		);

		const result = await discover(root, { listeners: true, commands: true });
		expect(result.listeners.length).toBe(1);
		expect(result.commands.length).toBe(1);
		expect(result.warnings.length).toBe(0);
	});

	it("3. discovers translations from app/locales and derives keys from filenames", async () => {
		const root = await createTempProject();
		await mkdir(join(root, "app/locales"), { recursive: true });

		await writeFile(
			join(root, "app/locales/ar.ts"),
			`export default { welcome: "أهلاً", errors: { custom: "خطأ مخصص" } };`,
		);
		await writeFile(
			join(root, "app/locales/en.ts"),
			`export default { welcome: "Welcome", errors: { custom: "Custom error" } };`,
		);

		const result = await discover(root, { translations: true });
		expect(result.translations.ar).toBeDefined();
		expect(result.translations.en).toBeDefined();
		expect(result.translations.ar?.welcome).toBe("أهلاً");
		expect(result.translations.en?.welcome).toBe("Welcome");
	});

	it("4. scans recursively into subdirectories", async () => {
		const root = await createTempProject();
		await mkdir(join(root, "app/jobs/nested/sub"), { recursive: true });
		await writeFile(
			join(root, "app/jobs/nested/sub/deep.ts"),
			`
			import { Job } from "${join(import.meta.dir, "../src/jobs/job.ts").replace(/\\/g, "/")}";
			export default class DeepJob extends Job {
				readonly name = "deep-job";
				readonly schedule = "0 0 * * *";
				handle() {}
			}
			`,
		);

		const result = await discover(root, { jobs: true });
		expect(result.jobs.length).toBe(1);
	});

	it("5. sorts discovered files deterministically in alphabetical order", async () => {
		const root = await createTempProject();
		await mkdir(join(root, "app/jobs"), { recursive: true });
		await writeFile(
			join(root, "app/jobs/z-job.ts"),
			`
			import { Job } from "${join(import.meta.dir, "../src/jobs/job.ts").replace(/\\/g, "/")}";
			export default class ZJob extends Job {
				readonly name = "z-job";
				readonly schedule = "* * * * *";
				handle() {}
			}
			`,
		);
		await writeFile(
			join(root, "app/jobs/a-job.ts"),
			`
			import { Job } from "${join(import.meta.dir, "../src/jobs/job.ts").replace(/\\/g, "/")}";
			export default class AJob extends Job {
				readonly name = "a-job";
				readonly schedule = "* * * * *";
				handle() {}
			}
			`,
		);

		const result = await discover(root, { jobs: true });
		expect(result.jobs.length).toBe(2);
		const inst0 = new (result.jobs[0] as any)();
		const inst1 = new (result.jobs[1] as any)();
		expect(inst0.name).toBe("a-job");
		expect(inst1.name).toBe("z-job");
	});
});

describe("Auto-Register: Conflict Resolution & Priorities (§7.2)", () => {
	it("6. manual registration wins and deduplicates by identity (===)", async () => {
		class ManualJob extends Job {
			readonly name = "manual-job";
			readonly schedule = "* * * * *";
			handle() {}
		}

		const merged = mergeManualAndAuto(
			{ jobs: [ManualJob] },
			{
				jobs: [ManualJob],
				listeners: [],
				commands: [],
				translations: {},
				warnings: [],
			},
		);

		expect(merged.jobs.length).toBe(1);
		expect(merged.jobs[0]).toBe(ManualJob);
	});

	it("7. manual translations win over auto translations on key collision", async () => {
		const manualTranslations = {
			ar: {
				welcome: "يدوي",
				shared: "يدوي-مشترك",
			},
		};

		const autoTranslations = {
			ar: {
				welcome: "تلقائي",
				shared: "تلقائي-مشترك",
				onlyAuto: "فقط-تلقائي",
			},
		};

		const merged = mergeManualAndAuto(
			{ translations: manualTranslations },
			{
				jobs: [],
				listeners: [],
				commands: [],
				translations: autoTranslations,
				warnings: [],
			},
		);

		expect(merged.translations.ar?.welcome).toBe("يدوي");
		expect(merged.translations.ar?.shared).toBe("يدوي-مشترك");
		expect((merged.translations.ar as any)?.onlyAuto).toBe("فقط-تلقائي");
	});

	it("8. warns on duplicate auto-registered language files and picks the first", async () => {
		const root = await createTempProject();
		await mkdir(join(root, "app/locales/sub"), { recursive: true });

		await writeFile(
			join(root, "app/locales/en.ts"),
			`export default { lang: "first" };`,
		);
		await writeFile(
			join(root, "app/locales/sub/en.ts"),
			`export default { lang: "second" };`,
		);

		const result = await discover(root, { translations: true });
		expect(result.translations.en?.lang).toBe("first");
		expect(result.warnings.some((w) => w.code === "DUPLICATE_LANGUAGE")).toBe(
			true,
		);
	});

	it("9. warns on command signature name collisions and drops duplicate", async () => {
		class ExistingCommand extends Command {
			readonly signature = "hello <target>";
			handle() {}
		}

		class DuplicateCommand extends Command {
			readonly signature = "hello [optional]";
			handle() {}
		}

		const merged = mergeManualAndAuto(
			{ commands: [ExistingCommand] },
			{
				jobs: [],
				listeners: [],
				commands: [DuplicateCommand],
				translations: {},
				warnings: [],
			},
		);

		expect(merged.commands.length).toBe(1);
		expect(merged.commands[0]).toBe(ExistingCommand);
		expect(
			merged.warnings.some((w) => w.code === "DUPLICATE_COMMAND_NAME"),
		).toBe(true);
	});
});

describe("Auto-Register: Error Isolation (§7.3)", () => {
	it("10. syntax error in one file does not crash discovery", async () => {
		const root = await createTempProject();
		await mkdir(join(root, "app/jobs"), { recursive: true });
		await writeFile(
			join(root, "app/jobs/broken.ts"),
			`export default syntax error !!! {`,
		);
		await writeFile(
			join(root, "app/jobs/good.ts"),
			`
			import { Job } from "${join(import.meta.dir, "../src/jobs/job.ts").replace(/\\/g, "/")}";
			export default class GoodJob extends Job {
				readonly name = "good-job";
				readonly schedule = "* * * * *";
				handle() {}
			}
			`,
		);

		const result = await discover(root, { jobs: true });
		expect(result.jobs.length).toBe(1);
		expect(result.warnings.some((w) => w.code === "IMPORT_FAILED")).toBe(true);
	});

	it("11. file exporting invalid subtype triggers warning and is skipped", async () => {
		const root = await createTempProject();
		await mkdir(join(root, "app/jobs"), { recursive: true });
		await writeFile(
			join(root, "app/jobs/not-a-job.ts"),
			`export default class NotAJob {}`,
		);

		const result = await discover(root, { jobs: true });
		expect(result.jobs.length).toBe(0);
		expect(result.warnings.some((w) => w.code === "INVALID_EXPORT")).toBe(true);
	});

	it("12. file with multiple candidate exports triggers warning and is skipped", async () => {
		const root = await createTempProject();
		await mkdir(join(root, "app/jobs"), { recursive: true });
		await writeFile(
			join(root, "app/jobs/multi.ts"),
			`
			import { Job } from "${join(import.meta.dir, "../src/jobs/job.ts").replace(/\\/g, "/")}";
			export class JobOne extends Job {
				readonly name = "job-1";
				readonly schedule = "* * * * *";
				handle() {}
			}
			export class JobTwo extends Job {
				readonly name = "job-2";
				readonly schedule = "* * * * *";
				handle() {}
			}
			`,
		);

		const result = await discover(root, { jobs: true });
		expect(result.jobs.length).toBe(0);
		expect(result.warnings.some((w) => w.code === "MULTIPLE_EXPORTS")).toBe(
			true,
		);
	});

	it("13. strict mode throws on file errors", async () => {
		const root = await createTempProject();
		await mkdir(join(root, "app/jobs"), { recursive: true });
		await writeFile(
			join(root, "app/jobs/broken.ts"),
			`export default syntax error !!! {`,
		);

		expect(discover(root, { jobs: true, strict: true })).rejects.toThrow();
	});
});

describe("Auto-Register: Security & Path Protection (§7.4)", () => {
	it("14. rejects path traversal relative paths (../outside)", async () => {
		const root = await createTempProject();
		const res = await resolveDirectory(root, "../outside", "jobs");
		expect(res.ok).toBe(false);
		expect(res.warning?.code).toBe("OUTSIDE_ROOT");
	});

	it("15. rejects absolute paths outside project root (C:\\Windows or /etc)", async () => {
		const root = await createTempProject();
		const res = await resolveDirectory(root, "C:\\Windows", "jobs");
		expect(res.ok).toBe(false);
		expect(res.warning?.code).toBe("OUTSIDE_ROOT");
	});

	it("16. rejects symlink directory pointing outside project root", async () => {
		const root = await createTempProject();
		const outside = await createTempProject();
		const linkPath = join(root, "app/jobs-link");
		await mkdir(join(root, "app"), { recursive: true });

		let symlinkSupported = true;
		try {
			await symlink(outside, linkPath, "dir");
		} catch {
			symlinkSupported = false;
		}

		if (symlinkSupported) {
			const res = await resolveDirectory(root, "app/jobs-link", "jobs");
			expect(res.ok).toBe(false);
			expect(res.warning?.code).toBe("OUTSIDE_ROOT");
		}
	});

	it("17. rejects prototype pollution keys (__proto__, constructor, prototype) in translations", async () => {
		const root = await createTempProject();
		await mkdir(join(root, "app/locales"), { recursive: true });
		await writeFile(
			join(root, "app/locales/en.ts"),
			`export default JSON.parse('{"valid": "ok", "__proto__": {"polluted": true}}');`,
		);

		const result = await discover(root, { translations: true });
		expect((result.translations.en as any)?.polluted).toBeUndefined();
		expect((Object.prototype as any).polluted).toBeUndefined();
	});
});

describe("Auto-Register: Compatibility & Determinism (§7.5)", () => {
	it("18. config without autoRegister undergoes zero discovery", async () => {
		const rawConfig = { name: "Manual App" };
		const finalConfig = await defineConfigAsync(rawConfig);
		expect(finalConfig).toBe(rawConfig);
	});

	it("19. createApp works synchronously without defineConfigAsync", () => {
		const app = createApp({ name: "Sync App" });
		expect(app).toBeDefined();
	});

	it("20. createTestApp works seamlessly with discovered config", async () => {
		const config = await defineConfigAsync({
			name: "Test App",
			autoRegister: { jobs: false },
		});
		const testApp = createTestApp(config);
		expect(testApp).toBeDefined();
	});

	it("21. determinism: discovery runs yield identical ordering and items", async () => {
		const root = await createTempProject();
		await mkdir(join(root, "app/jobs"), { recursive: true });
		await writeFile(
			join(root, "app/jobs/b.ts"),
			`
			import { Job } from "${join(import.meta.dir, "../src/jobs/job.ts").replace(/\\/g, "/")}";
			export default class BJob extends Job {
				readonly name = "b";
				readonly schedule = "* * * * *";
				handle() {}
			}
			`,
		);
		await writeFile(
			join(root, "app/jobs/a.ts"),
			`
			import { Job } from "${join(import.meta.dir, "../src/jobs/job.ts").replace(/\\/g, "/")}";
			export default class AJob extends Job {
				readonly name = "a";
				readonly schedule = "* * * * *";
				handle() {}
			}
			`,
		);

		const res1 = await discover(root, { jobs: true });
		const res2 = await discover(root, { jobs: true });

		expect(res1.jobs.length).toBe(2);
		expect(res2.jobs.length).toBe(2);
		expect(new (res1.jobs[0] as any)().name).toBe("a");
		expect(new (res2.jobs[0] as any)().name).toBe("a");
		expect(new (res1.jobs[1] as any)().name).toBe("b");
		expect(new (res2.jobs[1] as any)().name).toBe("b");
	});
});
