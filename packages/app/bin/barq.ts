#!/usr/bin/env bun
// Console entrypoint of the `barq` CLI (installed as a bin of this package).
//
// Loads `barq.config.ts` from the application root, then runs every
// built-in + application command:
//
//   bun run cli job:make send-emails
//   bun run cli env:check
//   bun run cli --help
import { existsSync } from "node:fs";
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
	const child = Bun.spawnSync(
		[process.execPath, import.meta.path, ...process.argv.slice(2)],
		{
			cwd: projectRoot,
			stdio: ["inherit", "inherit", "inherit"],
			env: { ...process.env, BARQ_CLI_REEXEC: "1" },
		},
	);

	process.exit(child.exitCode ?? 1);
}

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const built = join(packageRoot, "dist", "index.js");
const source = join(packageRoot, "src", "index.ts");

// Prefer the built entry; fall back to TypeScript sources when running
// inside this repository before the first build.
const framework = (await import(
	pathToFileURL(existsSync(built) ? built : source).href
)) as typeof import("../src/index.ts");

const config = await framework.loadAppConfig();

await framework.runCli(config);
