#!/usr/bin/env node
// Console entrypoint of the `barq` CLI (installed as a bin of this package).
//
// Loads the application config (app/config/app.ts, a root barq.config.*, or
// the package entrypoint), then runs every built-in + application command:
//
//   bun run cli job:make send-emails
//   bun run cli env:check
//   bun run cli --help
//
// Runs on both Bun and Node.js. On Node.js the `node-loader.js` helper adds
// the TypeScript + tsconfig-paths support that Bun provides natively.
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Nearest ancestor of `start` that contains a package.json. */
function findProjectRoot(start: string): string | undefined {
	let dir = start;

	while (dir !== dirname(dir)) {
		if (existsSync(join(dir, "package.json"))) {
			return dir;
		}

		dir = dirname(dir);
	}

	return undefined;
}

const currentFile = fileURLToPath(import.meta.url);

// Bun fixes tsconfig resolution (and with it `emitDecoratorMetadata`, which
// the DI container needs) when the process starts — a later chdir() is too
// late. When launched from a subdirectory, hand off to a fresh process
// rooted at the project so `barq` behaves the same from anywhere.
const projectRoot = findProjectRoot(
	resolve(process.env.BARQ_APP_ROOT ?? process.cwd()),
);

if (
	!process.env.BARQ_CLI_REEXEC &&
	projectRoot &&
	projectRoot !== process.cwd()
) {
	const child = spawnSync(
		process.execPath,
		[currentFile, ...process.argv.slice(2)],
		{
			cwd: projectRoot,
			stdio: ["inherit", "inherit", "inherit"],
			env: { ...process.env, BARQ_CLI_REEXEC: "1" },
		},
	);

	process.exit(child.status ?? 1);
}

/** Registers the TypeScript/tsconfig-paths loader when running on Node.js. */
async function installNodeLoader(appRoot: string): Promise<void> {
	const moduleApi = await import("node:module");
	const loaderUrl = new URL("./node-loader.js", import.meta.url);

	if (typeof moduleApi.registerHooks === "function") {
		const loader = await import(loaderUrl.href);
		await loader.initialize({ root: appRoot });
		moduleApi.registerHooks(loader);
		return;
	}

	if (typeof moduleApi.register === "function") {
		moduleApi.register(loaderUrl, import.meta.url, {
			data: { root: appRoot },
		});
	}
}

const appRoot = projectRoot ?? process.cwd();

if (typeof Bun === "undefined") {
	await installNodeLoader(appRoot);
}

const packageRoot = join(dirname(currentFile), "..");

const built = join(packageRoot, "dist", "index.js");
const source = join(packageRoot, "src", "index.ts");

// Prefer the built entry; fall back to TypeScript sources when running
// inside this repository before the first build. Resolve symlinks so Node
// finds the package's own dependencies in pnpm/Bun isolated layouts.
const entry = existsSync(built) ? built : source;
const framework = (await import(
	pathToFileURL(realpathSync(entry)).href
)) as typeof import("../src/index.ts");

const config = await framework.loadAppConfig();

await framework.runCli(config);
