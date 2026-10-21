import "reflect-metadata";
import { afterAll, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { builtinCommands } from "../src/console/commands";
import { camelCase, kebabCase, pascalCase } from "../src/console/generator";

const PACKAGE_DIR = join(import.meta.dir, "..");
const COMMANDS_DIR = join(PACKAGE_DIR, "src/console/commands");

const ACTION_COMMAND = "make-action.command.ts";
const DTO_COMMAND = "make-dto.command.ts";
const MIDDLEWARE_COMMAND = "make-middleware.command.ts";
const LISTENER_COMMAND = "make-listener.command.ts";

/** Absolute file URL of a command module inside this package. */
function commandUrl(file: string): string {
	return pathToFileURL(join(COMMANDS_DIR, file)).href;
}

const createdDirs: string[] = [];

async function createProject(tsconfig?: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "barq-generator-"));
	createdDirs.push(dir);
	await Bun.write(join(dir, "package.json"), "{}\n");

	if (tsconfig !== undefined) {
		await Bun.write(join(dir, "tsconfig.json"), tsconfig);
	}

	return dir;
}

afterAll(async () => {
	for (const dir of createdDirs) {
		await rm(dir, { recursive: true, force: true });
	}
});

interface GeneratorRun {
	exitCode: number;
	logs: string[];
}

/** Runs a generator in a child process whose project root is the temp dir. */
function runGenerator(
	project: string,
	commandFile: string,
	commandExport: string,
	args: Record<string, string>,
	force = false,
): GeneratorRun {
	const script = `
		(async () => {
			await import("reflect-metadata");
			const { ${commandExport} } = await import(${JSON.stringify(commandUrl(commandFile))});
			const logs = [];
			const push = (level) => (message) => logs.push(level + ": " + message);

			await new ${commandExport}().handle({
				args: ${JSON.stringify(args)},
				flags: { force: ${JSON.stringify(force)} },
				log: {
					success: push("success"),
					info: push("info"),
					warn: push("warn"),
					error: push("error"),
				},
			});

			process.stdout.write("__LOGS__" + JSON.stringify(logs));
		})();
	`;

	const result = Bun.spawnSync([process.execPath, "-e", script], {
		cwd: PACKAGE_DIR,
		env: { ...process.env, BARQ_APP_ROOT: project },
	});
	const stdout = result.stdout.toString();
	const marker = stdout.indexOf("__LOGS__");
	const logs =
		marker === -1
			? [`<no logs — exit ${result.exitCode}>`, result.stderr.toString()]
			: (JSON.parse(stdout.slice(marker + "__LOGS__".length)) as string[]);

	return { exitCode: result.exitCode, logs };
}

describe("generators", () => {
	it("names every generator `<noun>:make`", () => {
		const signatures = builtinCommands.map(
			(CommandClass) => new CommandClass().signature,
		);

		expect(signatures).toEqual(
			expect.arrayContaining([
				"action:make <name>",
				"command:make <name>",
				"controller:make <name>",
				"dto:make <name>",
				"job:make <name>",
				"listener:make <event>",
				"middleware:make <name>",
				"repository:make <name>",
				"request:make <name>",
				"service:make <name>",
			]),
		);
		expect(signatures.some((signature) => signature.startsWith("make:"))).toBe(
			false,
		);
	});

	it("derives names and file paths from the input", () => {
		expect(camelCase("auth-guard")).toBe("authGuard");
		expect(camelCase("user.created")).toBe("userCreated");
		expect(kebabCase("ApiKey")).toBe("api-key");
		expect(pascalCase("auth-guard")).toBe("AuthGuard");
	});
});

describe("middleware:make", () => {
	it("creates the middleware and prints attach hints", async () => {
		const project = await createProject();
		const { exitCode, logs } = runGenerator(
			project,
			MIDDLEWARE_COMMAND,
			"MakeMiddlewareCommand",
			{ name: "auth-guard" },
		);

		expect(exitCode).toBe(0);

		const output = logs.join("\n");
		expect(output).toContain("Created app/middleware/auth-guard.ts");
		expect(output).toContain('users.post("/", authGuardMiddleware(), handler)');
		expect(output).toContain("app.use(authGuardMiddleware())");

		const file = await readFile(
			join(project, "app/middleware/auth-guard.ts"),
			"utf8",
		);

		expect(file).toContain('from "@barq"');
		expect(file).toContain(
			"export function authGuardMiddleware(): Middleware {",
		);
		expect(file).toContain("before(ctx: Context)");
		expect(file).toContain("`auth-guard` middleware");
	});

	it("refuses to overwrite without --force", async () => {
		const project = await createProject();
		runGenerator(project, MIDDLEWARE_COMMAND, "MakeMiddlewareCommand", {
			name: "auth-guard",
		});
		const { exitCode, logs } = runGenerator(
			project,
			MIDDLEWARE_COMMAND,
			"MakeMiddlewareCommand",
			{ name: "auth-guard" },
		);

		expect(exitCode).toBe(1);
		expect(logs.join("\n")).toContain("already exists — use --force");
	});

	it("overwrites with --force", async () => {
		const project = await createProject();
		runGenerator(project, MIDDLEWARE_COMMAND, "MakeMiddlewareCommand", {
			name: "auth-guard",
		});
		const { exitCode, logs } = runGenerator(
			project,
			MIDDLEWARE_COMMAND,
			"MakeMiddlewareCommand",
			{ name: "auth-guard" },
			true,
		);

		expect(exitCode).toBe(0);
		expect(logs.join("\n")).toContain("Updated app/middleware/auth-guard.ts");
	});

	it("rejects invalid names", async () => {
		const project = await createProject();
		const { exitCode, logs } = runGenerator(
			project,
			MIDDLEWARE_COMMAND,
			"MakeMiddlewareCommand",
			{ name: "Bad Name!" },
		);

		expect(exitCode).toBe(1);
		expect(logs.join("\n")).toContain('Invalid name "Bad Name!"');
	});
});

describe("listener:make", () => {
	it("creates app/listeners/<event>.ts as one self-contained class", async () => {
		const project = await createProject();
		const { exitCode, logs } = runGenerator(
			project,
			LISTENER_COMMAND,
			"MakeListenerCommand",
			{ event: "user.activated" },
		);

		expect(exitCode).toBe(0);

		const output = logs.join("\n");
		expect(output).toContain("Created app/listeners/user-activated.ts");
		expect(output).toContain(
			"Replace Record<string, unknown> with the real payload shape (Listener.of<…> in the class header)",
		);
		expect(output).toContain(
			"Emit it anywhere with: await eventBus().emit(UserActivatedListener.event, payload)",
		);

		const file = await readFile(
			join(project, "app/listeners/user-activated.ts"),
			"utf8",
		);

		expect(file).toContain(
			'import { injectable, Listener, type PayloadOf } from "@barq";',
		);
		expect(file).toContain(
			"class UserActivatedListener extends Listener.of<Record<string, unknown>>(",
		);
		expect(file).toContain('"user.activated",');
		expect(file).toContain("async handle(payload: PayloadOf<this>)");
		expect(file).not.toContain("declare module");
		expect(file).not.toContain("export const");
	});
});

describe("action:make", () => {
	it("creates app/actions/<name>.ts with a handle()", async () => {
		const project = await createProject();
		const { exitCode, logs } = runGenerator(
			project,
			ACTION_COMMAND,
			"MakeActionCommand",
			{ name: "generate-otp" },
		);

		expect(exitCode).toBe(0);

		const output = logs.join("\n");
		expect(output).toContain("Created app/actions/generate-otp.ts");
		expect(output).toContain("call `handle()`");
		expect(output).toContain("Return a DTO from app/dtos (`dto:make`)");

		const file = await readFile(
			join(project, "app/actions/generate-otp.ts"),
			"utf8",
		);

		expect(file).toContain('import { injectable } from "@barq";');
		expect(file).toContain("export class GenerateOtpAction {");
		expect(file).toContain("async handle(): Promise<void>");
	});

	it("supports nested names", async () => {
		const project = await createProject();
		const { exitCode, logs } = runGenerator(
			project,
			ACTION_COMMAND,
			"MakeActionCommand",
			{ name: "billing/send-invoice" },
		);

		expect(exitCode).toBe(0);
		expect(logs.join("\n")).toContain(
			"Created app/actions/billing/send-invoice.ts",
		);

		const file = await readFile(
			join(project, "app/actions/billing/send-invoice.ts"),
			"utf8",
		);

		expect(file).toContain("export class BillingSendInvoiceAction {");
	});
});

describe("dto:make", () => {
	it("creates app/dtos/<name>.ts exporting the DTO interface", async () => {
		const project = await createProject();
		const { exitCode, logs } = runGenerator(
			project,
			DTO_COMMAND,
			"MakeDtoCommand",
			{ name: "otp" },
		);

		expect(exitCode).toBe(0);

		const output = logs.join("\n");
		expect(output).toContain("Created app/dtos/otp.ts");
		expect(output).toContain("never the raw entity");

		const file = await readFile(join(project, "app/dtos/otp.ts"), "utf8");

		expect(file).toContain("export interface OtpDto {");
		expect(file).toContain("TODO: list the fields");
		expect(file).toContain("id: string;");
	});
});

describe("framework alias", () => {
	it("maps @barq in the tsconfig when the project has none", async () => {
		const project = await createProject();
		const { exitCode, logs } = runGenerator(
			project,
			ACTION_COMMAND,
			"MakeActionCommand",
			{ name: "generate-otp" },
		);

		expect(exitCode).toBe(0);
		expect(logs.join("\n")).toContain('Mapped "@barq"');

		const tsconfig = await readFile(join(project, "tsconfig.json"), "utf8");

		expect(tsconfig).toContain('"@barq"');
		expect(tsconfig).toContain("./node_modules/@barqel/barq-app");
	});

	it("keeps the existing paths and adds the alias", async () => {
		const project = await createProject(
			`{
	"compilerOptions": {
		// app internals
		"paths": {
			"@/*": ["./app/*"]
		}
	}
}
`,
		);

		runGenerator(project, ACTION_COMMAND, "MakeActionCommand", {
			name: "generate-otp",
		});

		const tsconfig = await readFile(join(project, "tsconfig.json"), "utf8");

		expect(tsconfig).toContain('"@/*"');
		expect(tsconfig).toContain('"@barq"');
		// Comments survive the edit.
		expect(tsconfig).toContain("// app internals");
	});

	it("never rewrites an existing alias", async () => {
		const project = await createProject(
			`{
	"compilerOptions": {
		"paths": {
			"@barq": ["./node_modules/@barqel/barq-app"]
		}
	}
}
`,
		);

		const { logs } = runGenerator(
			project,
			ACTION_COMMAND,
			"MakeActionCommand",
			{ name: "generate-otp" },
		);

		expect(logs.join("\n")).not.toContain('Mapped "@barq"');

		const tsconfig = await readFile(join(project, "tsconfig.json"), "utf8");

		expect(tsconfig.split('"@barq"').length - 1).toBe(1);
		expect(tsconfig.split("./node_modules/@barqel/barq-app").length - 1).toBe(
			1,
		);
	});

	it("adds the paths mapping when the tsconfig has none", async () => {
		const project = await createProject(
			`{
	"compilerOptions": {
		"strict": true
	}
}
`,
		);

		runGenerator(project, ACTION_COMMAND, "MakeActionCommand", {
			name: "generate-otp",
		});

		const tsconfig = await readFile(join(project, "tsconfig.json"), "utf8");

		expect(tsconfig).toContain('"strict": true');
		expect(tsconfig).toContain('"paths"');
		expect(tsconfig).toContain('"@barq"');
	});

	it("warns instead of breaking a tsconfig that extends another", async () => {
		const project = await createProject(
			`{
	"extends": "./tsconfig.base.json"
}
`,
		);

		const { logs } = runGenerator(
			project,
			ACTION_COMMAND,
			"MakeActionCommand",
			{ name: "generate-otp" },
		);

		const output = logs.join("\n");

		expect(output).toContain('Could not map "@barq"');
		expect(output).not.toContain('Mapped "@barq"');

		const tsconfig = await readFile(join(project, "tsconfig.json"), "utf8");

		expect(tsconfig).not.toContain('"@barq"');
	});
});
