import "reflect-metadata";
import { afterAll, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { builtinCommands } from "../src/console/commands";
import { camelCase, kebabCase, pascalCase } from "../src/console/generator";

const PACKAGE_DIR = join(import.meta.dir, "..");
const COMMANDS_DIR = join(PACKAGE_DIR, "src/console/commands");

const ACTION_COMMAND = "make-action.command.ts";
const CONFIG_COMMAND = "make-config.command.ts";
const CONTROLLER_COMMAND = "make-controller.command.ts";
const DTO_COMMAND = "make-dto.command.ts";
const ENV_COMMAND = "make-env.command.ts";
const JOB_COMMAND = "make-job.command.ts";
const MIDDLEWARE_COMMAND = "make-middleware.command.ts";
const LISTENER_COMMAND = "make-listener.command.ts";
const LOCALE_COMMAND = "make-locale.command.ts";
const MAIL_COMMAND = "make-mail.command.ts";
const MODULE_COMMAND = "make-module.command.ts";
const REQUEST_COMMAND = "make-request.command.ts";
const ROUTE_COMMAND = "make-route.command.ts";

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
				"action:make <name> [module]",
				"command:make <name> [module]",
				"config:make <name> [module]",
				"controller:make <name> [module]",
				"dto:make <name> [module]",
				"env:make",
				"job:make <name> [module]",
				"listener:make <event> [module]",
				"locale:make <locale> [module]",
				"mail:make <name> [module]",
				"middleware:make <name> [module]",
				"module:make <name>",
				"repository:make <name> [module]",
				"request:make <name> [module]",
				"route:make <name> [module]",
				"service:make <name> [module]",
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
		expect(output).toContain("Created modules/app/middleware/auth-guard.ts");
		expect(output).toContain('users.post("/", authGuardMiddleware(), handler)');
		expect(output).toContain("app.use(authGuardMiddleware())");

		const file = await readFile(
			join(project, "modules/app/middleware/auth-guard.ts"),
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
		expect(logs.join("\n")).toContain(
			"Updated modules/app/middleware/auth-guard.ts",
		);
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
	it("creates modules/app/listeners/<event>.ts as one self-contained class", async () => {
		const project = await createProject();
		const { exitCode, logs } = runGenerator(
			project,
			LISTENER_COMMAND,
			"MakeListenerCommand",
			{ event: "user.activated" },
		);

		expect(exitCode).toBe(0);

		const output = logs.join("\n");
		expect(output).toContain("Created modules/app/listeners/user-activated.ts");
		expect(output).toContain(
			"Replace Record<string, unknown> with the real payload shape (Listener.of<…> in the class header)",
		);
		expect(output).toContain(
			"Emit it anywhere with: await eventBus().emit(UserActivatedListener.event, payload)",
		);

		const file = await readFile(
			join(project, "modules/app/listeners/user-activated.ts"),
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

describe("module:make", () => {
	it("creates only the routes entry, which the framework auto-loads", async () => {
		const project = await createProject();
		const { exitCode, logs } = runGenerator(
			project,
			MODULE_COMMAND,
			"MakeModuleCommand",
			{ name: "billing" },
		);

		expect(exitCode).toBe(0);

		const output = logs.join("\n");
		expect(output).toContain("Created modules/billing/routes/routes.ts");
		expect(output).toContain("Auto-loaded at boot");

		const routes = await readFile(
			join(project, "modules/billing/routes/routes.ts"),
			"utf8",
		);
		expect(routes).toContain('import type { App } from "@barq";');
		expect(routes).toContain("export function billingRoutes(_app: App): void");

		for (const path of [
			"modules/billing/locales",
			"modules/billing/jobs",
			"modules/billing/listeners",
			"modules/billing/commands",
		]) {
			expect(existsSync(join(project, path))).toBe(false);
		}
	});

	it("camel-cases the route function for dashed names", async () => {
		const project = await createProject();
		runGenerator(project, MODULE_COMMAND, "MakeModuleCommand", {
			name: "audit-log",
		});

		const routes = await readFile(
			join(project, "modules/audit-log/routes/routes.ts"),
			"utf8",
		);

		expect(routes).toContain("export function auditLogRoutes");
	});

	it("refuses to overwrite an existing module without --force", async () => {
		const project = await createProject();
		runGenerator(project, MODULE_COMMAND, "MakeModuleCommand", {
			name: "billing",
		});
		const { exitCode, logs } = runGenerator(
			project,
			MODULE_COMMAND,
			"MakeModuleCommand",
			{ name: "billing" },
		);

		expect(exitCode).toBe(1);
		expect(logs.join("\n")).toContain(
			"modules/billing already exists — use --force",
		);
	});

	it("overwrites the scaffold with --force", async () => {
		const project = await createProject();
		runGenerator(project, MODULE_COMMAND, "MakeModuleCommand", {
			name: "billing",
		});
		const { exitCode, logs } = runGenerator(
			project,
			MODULE_COMMAND,
			"MakeModuleCommand",
			{ name: "billing" },
			true,
		);

		expect(exitCode).toBe(0);
		expect(logs.join("\n")).toContain(
			"Updated modules/billing/routes/routes.ts",
		);
	});

	it("rejects names that are not a single folder", async () => {
		const project = await createProject();
		const { exitCode, logs } = runGenerator(
			project,
			MODULE_COMMAND,
			"MakeModuleCommand",
			{ name: "billing/v1" },
		);

		expect(exitCode).toBe(1);
		expect(logs.join("\n")).toContain('Invalid module name "billing/v1"');
	});
});

describe("action:make", () => {
	it("creates modules/app/actions/<name>.ts with a handle()", async () => {
		const project = await createProject();
		const { exitCode, logs } = runGenerator(
			project,
			ACTION_COMMAND,
			"MakeActionCommand",
			{ name: "generate-otp" },
		);

		expect(exitCode).toBe(0);

		const output = logs.join("\n");
		expect(output).toContain("Created modules/app/actions/generate-otp.ts");
		expect(output).toContain("call `handle()`");
		expect(output).toContain(
			"Return a DTO from modules/app/dtos (`dto:make <name>`)",
		);

		const file = await readFile(
			join(project, "modules/app/actions/generate-otp.ts"),
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
			"Created modules/app/actions/billing/send-invoice.ts",
		);

		const file = await readFile(
			join(project, "modules/app/actions/billing/send-invoice.ts"),
			"utf8",
		);

		expect(file).toContain("export class BillingSendInvoiceAction {");
	});
});

describe("dto:make", () => {
	it("creates modules/app/dtos/<name>.ts exporting the DTO interface", async () => {
		const project = await createProject();
		const { exitCode, logs } = runGenerator(
			project,
			DTO_COMMAND,
			"MakeDtoCommand",
			{ name: "otp" },
		);

		expect(exitCode).toBe(0);

		const output = logs.join("\n");
		expect(output).toContain("Created modules/app/dtos/otp.ts");
		expect(output).toContain("never the raw entity");

		const file = await readFile(
			join(project, "modules/app/dtos/otp.ts"),
			"utf8",
		);

		expect(file).toContain("export interface OtpDto {");
		expect(file).toContain("TODO: list the fields");
		expect(file).toContain("id: string;");
	});
});

describe("mail:make", () => {
	it("creates a class-based mail in modules/app/mail", async () => {
		const project = await createProject();
		const { exitCode, logs } = runGenerator(
			project,
			MAIL_COMMAND,
			"MakeMailCommand",
			{ name: "welcome" },
		);

		expect(exitCode).toBe(0);

		const output = logs.join("\n");
		expect(output).toContain("Created modules/app/mail/welcome.ts");
		expect(output).toContain(
			"Inject WelcomeMail anywhere and call `send(to, data)`",
		);

		const file = await readFile(
			join(project, "modules/app/mail/welcome.ts"),
			"utf8",
		);

		expect(file).toContain("export type WelcomeMailData = {");
		expect(file).toContain("export class WelcomeMail {");
		expect(file).toContain("readonly template: MailTemplate = {");
		expect(file).toContain("async send(");
		expect(file).toContain(
			"return mailer().send({ to, template: this.template, data });",
		);
	});

	it("targets a named module", async () => {
		const project = await createProject();
		runGenerator(project, MAIL_COMMAND, "MakeMailCommand", {
			name: "invoice-created",
			module: "billing",
		});

		expect(
			existsSync(join(project, "modules/billing/mail/invoice-created.ts")),
		).toBe(true);
	});
});

describe("locale:make", () => {
	it("creates a locale dictionary in modules/app/locales", async () => {
		const project = await createProject();
		const { exitCode, logs } = runGenerator(
			project,
			LOCALE_COMMAND,
			"MakeLocaleCommand",
			{ locale: "en" },
		);

		expect(exitCode).toBe(0);

		const output = logs.join("\n");
		expect(output).toContain("Created modules/app/locales/en.ts");
		expect(output).toContain("The file name is the locale key: `en`");

		const file = await readFile(
			join(project, "modules/app/locales/en.ts"),
			"utf8",
		);

		expect(file).toContain("export default {");
		expect(file).toContain("`en` dictionary of the `app` module");
	});

	it("accepts region codes and targets a named module", async () => {
		const project = await createProject();
		const { exitCode } = runGenerator(
			project,
			LOCALE_COMMAND,
			"MakeLocaleCommand",
			{ locale: "pt-br", module: "billing" },
		);

		expect(exitCode).toBe(0);
		expect(existsSync(join(project, "modules/billing/locales/pt-br.ts"))).toBe(
			true,
		);
	});

	it("rejects locales that are not a short language code", async () => {
		const project = await createProject();
		const { exitCode, logs } = runGenerator(
			project,
			LOCALE_COMMAND,
			"MakeLocaleCommand",
			{ locale: "english!" },
		);

		expect(exitCode).toBe(1);
		expect(logs.join("\n")).toContain('Invalid name "english!"');
	});
});

describe("route:make", () => {
	it("creates a route group in modules/app/routes", async () => {
		const project = await createProject();
		const { exitCode, logs } = runGenerator(
			project,
			ROUTE_COMMAND,
			"MakeRouteCommand",
			{ name: "v1" },
		);

		expect(exitCode).toBe(0);

		const output = logs.join("\n");
		expect(output).toContain("Created modules/app/routes/v1.ts");
		expect(output).toContain(
			"Import and call `appV1Routes(app)` in modules/app/routes/routes.ts",
		);

		const file = await readFile(
			join(project, "modules/app/routes/v1.ts"),
			"utf8",
		);

		expect(file).toContain('import type { App } from "@barq";');
		expect(file).toContain("export function appV1Routes(app: App): void {");
		expect(file).toContain('app.group("/v1"');
	});

	it("camel-cases the function for nested names and a module", async () => {
		const project = await createProject();
		runGenerator(project, ROUTE_COMMAND, "MakeRouteCommand", {
			name: "admin/users",
			module: "billing",
		});

		const file = await readFile(
			join(project, "modules/billing/routes/admin/users.ts"),
			"utf8",
		);

		expect(file).toContain(
			"export function billingAdminUsersRoutes(app: App): void {",
		);
		expect(file).toContain('app.group("/admin/users"');
	});

	it("refuses to shadow the auto-loaded routes entry", async () => {
		const project = await createProject();
		const { exitCode, logs } = runGenerator(
			project,
			ROUTE_COMMAND,
			"MakeRouteCommand",
			{ name: "routes" },
		);

		expect(exitCode).toBe(1);
		expect(logs.join("\n")).toContain(
			'"routes" is the module entry point — use `module:make` to scaffold it.',
		);
		expect(existsSync(join(project, "modules/app/routes/routes.ts"))).toBe(
			false,
		);
	});
});

describe("config:make", () => {
	it("creates a typed config object in modules/app/config", async () => {
		const project = await createProject();
		const { exitCode, logs } = runGenerator(
			project,
			CONFIG_COMMAND,
			"MakeConfigCommand",
			{ name: "mail" },
		);

		expect(exitCode).toBe(0);

		const output = logs.join("\n");
		expect(output).toContain("Created modules/app/config/mail.ts");
		expect(output).toContain("Import it with `@modules/app/config/mail`");

		const file = await readFile(
			join(project, "modules/app/config/mail.ts"),
			"utf8",
		);

		expect(file).toContain("export const MailConfig = {");
		expect(file).toContain("`mail` configuration of the `app` module");
	});

	it("targets a named module", async () => {
		const project = await createProject();
		runGenerator(project, CONFIG_COMMAND, "MakeConfigCommand", {
			name: "storage",
			module: "billing",
		});

		expect(existsSync(join(project, "modules/billing/config/storage.ts"))).toBe(
			true,
		);
	});
});

describe("env:make", () => {
	it("creates .env and .env.example at the project root", async () => {
		const project = await createProject();
		const { exitCode, logs } = runGenerator(
			project,
			ENV_COMMAND,
			"MakeEnvCommand",
			{},
		);

		expect(exitCode).toBe(0);

		const output = logs.join("\n");
		expect(output).toContain("Created .env");
		expect(output).toContain("Created .env.example");
		expect(output).toContain("A fresh APP_KEY was generated in .env");

		const env = await readFile(join(project, ".env"), "utf8");
		const example = await readFile(join(project, ".env.example"), "utf8");

		expect(env).toContain("APP_ENV=development");
		expect(env).toMatch(/APP_KEY="base64:[A-Za-z0-9+/=]+"/);
		expect(env).not.toContain("REPLACE_ME");
		expect(example).toContain(
			'APP_KEY="base64:REPLACE_ME_WITH_THE_GENERATED_KEY="',
		);
		expect(example).toContain("APP_PORT=3000");
	});

	it("creates the missing file without touching the existing one", async () => {
		const project = await createProject();
		await Bun.write(join(project, ".env"), 'APP_KEY="keep-me"\n');

		const { exitCode, logs } = runGenerator(
			project,
			ENV_COMMAND,
			"MakeEnvCommand",
			{},
		);

		expect(exitCode).toBe(0);

		const output = logs.join("\n");
		expect(output).toContain(
			"Skipped .env — already exists (use --force to overwrite)",
		);
		expect(output).toContain("Created .env.example");
		expect(output).not.toContain("fresh APP_KEY");
		expect(await readFile(join(project, ".env"), "utf8")).toBe(
			'APP_KEY="keep-me"\n',
		);
	});

	it("refuses to overwrite the existing pair without --force", async () => {
		const project = await createProject();
		await Bun.write(join(project, ".env"), 'APP_KEY="keep-me"\n');
		await Bun.write(join(project, ".env.example"), "APP_KEY=example\n");

		const { exitCode, logs } = runGenerator(
			project,
			ENV_COMMAND,
			"MakeEnvCommand",
			{},
		);

		expect(exitCode).toBe(1);
		expect(logs.join("\n")).toContain(
			"Both .env and .env.example already exist — use --force to overwrite.",
		);
		expect(await readFile(join(project, ".env"), "utf8")).toBe(
			'APP_KEY="keep-me"\n',
		);
	});

	it("overwrites with --force", async () => {
		const project = await createProject();
		await Bun.write(join(project, ".env"), 'APP_KEY="keep-me"\n');
		await Bun.write(join(project, ".env.example"), "APP_KEY=example\n");

		const { exitCode, logs } = runGenerator(
			project,
			ENV_COMMAND,
			"MakeEnvCommand",
			{},
			true,
		);

		expect(exitCode).toBe(0);

		const output = logs.join("\n");
		expect(output).toContain("Updated .env");
		expect(output).toContain("Updated .env.example");
		expect(await readFile(join(project, ".env"), "utf8")).not.toContain(
			"keep-me",
		);
	});
});

describe("module targeting", () => {
	it("creates actions under modules/<name> when a module is given", async () => {
		const project = await createProject();
		const { exitCode, logs } = runGenerator(
			project,
			ACTION_COMMAND,
			"MakeActionCommand",
			{ name: "generate-otp", module: "billing" },
		);

		expect(exitCode).toBe(0);

		const output = logs.join("\n");
		expect(output).toContain("Created modules/billing/actions/generate-otp.ts");
		expect(output).toContain("Return a DTO from modules/billing/dtos");

		const file = await readFile(
			join(project, "modules/billing/actions/generate-otp.ts"),
			"utf8",
		);

		expect(file).toContain("export class GenerateOtpAction {");
	});

	it("defaults to the app module", async () => {
		const project = await createProject();
		const { logs } = runGenerator(
			project,
			ACTION_COMMAND,
			"MakeActionCommand",
			{ name: "generate-otp" },
		);

		expect(logs.join("\n")).toContain(
			"Created modules/app/actions/generate-otp.ts",
		);
		expect(
			existsSync(join(project, "modules/app/actions/generate-otp.ts")),
		).toBe(true);
	});

	it("drops the version folder for module controllers and requests", async () => {
		const project = await createProject();
		runGenerator(project, CONTROLLER_COMMAND, "MakeControllerCommand", {
			name: "user",
			module: "user",
		});
		runGenerator(project, REQUEST_COMMAND, "MakeRequestCommand", {
			name: "user/create",
			module: "user",
		});

		expect(existsSync(join(project, "modules/user/controllers/user.ts"))).toBe(
			true,
		);
		expect(
			existsSync(join(project, "modules/user/requests/create-user.ts")),
		).toBe(true);
		expect(existsSync(join(project, "modules/user/controllers/v1"))).toBe(
			false,
		);
		expect(existsSync(join(project, "modules/user/requests/v1"))).toBe(false);
	});

	it("does not wire module jobs into the flat app config", async () => {
		const project = await createProject();
		const config = `import { defineConfigAsync } from "@barqel/barq-app";

export default await defineConfigAsync({
	name: "Test",
	jobs: [],
});
`;
		await Bun.write(join(project, "barq.config.ts"), config);

		const { exitCode, logs } = runGenerator(
			project,
			JOB_COMMAND,
			"MakeJobCommand",
			{ name: "send-report", module: "billing" },
		);

		expect(exitCode).toBe(0);

		const output = logs.join("\n");
		expect(output).toContain("Created modules/billing/jobs/send-report.ts");
		expect(output).toContain("Auto-discovered from modules/billing");

		expect(await readFile(join(project, "barq.config.ts"), "utf8")).toBe(
			config,
		);
	});

	it("rejects invalid module names", async () => {
		const project = await createProject();
		const { exitCode, logs } = runGenerator(
			project,
			ACTION_COMMAND,
			"MakeActionCommand",
			{ name: "generate-otp", module: "Billing/Admin" },
		);

		expect(exitCode).toBe(1);
		expect(logs.join("\n")).toContain('Invalid module "Billing/Admin"');
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
