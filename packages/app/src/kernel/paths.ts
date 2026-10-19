// Absolute paths of the APPLICATION (not of this framework package), so
// they stay correct across every runtime mode: dev source, bundled
// `dist/index.js`, the `barq` CLI in `node_modules/.bin`, and Docker.
//
// `import.meta.dir` is useless here — inside this package it points at
// `node_modules/@barqel/barq-app`, not at the app. Instead we walk up from
// the working directory (Bun runs apps from their root: `bun run dev`,
// `bun test`, `bunx barq`, Docker `WORKDIR`) to the nearest `package.json`.
//
// Override with `BARQ_APP_ROOT=/abs/path` when launching from elsewhere.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function findProjectRoot(start: string): string {
	let dir = start;

	while (dir !== dirname(dir)) {
		if (existsSync(join(dir, "package.json"))) {
			return dir;
		}

		dir = dirname(dir);
	}

	return start;
}

/** Application root: the directory that contains `package.json`. */
export const PROJECT_ROOT = findProjectRoot(
	resolve(process.env.BARQ_APP_ROOT ?? process.cwd()),
);

/** Static assets directory, served under the `/public` prefix. */
export const PUBLIC_DIR = join(PROJECT_ROOT, "public");
