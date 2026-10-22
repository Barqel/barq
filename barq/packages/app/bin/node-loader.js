// Node.js ESM loader for Barq applications.
//
// Bun loads TypeScript, tsconfig `paths` aliases and legacy decorators
// natively; Node does not. This loader gives Node the same behaviour for the
// CLI:
//
//   - resolve tsconfig `paths` aliases and extensionless relative imports
//   - transpile .ts/.tsx/.mts/.cts sources, including `experimentalDecorators`
//     and `emitDecoratorMetadata` (tsyringe reads the emitted metadata)
//
// `bin/barq.js` registers it only when running on Node.js. Bun never loads it.
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import {
	dirname,
	extname,
	isAbsolute,
	join,
	resolve as resolvePath,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const RESOLVE_EXTENSIONS = [
	".ts",
	".tsx",
	".mts",
	".cts",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".json",
];

let root = process.cwd();
let tsLoaded = false;
let ts = null;
let compilerOptions = {};
let basePath = root;
let pathMappings = [];

/** Loads the app's TypeScript compiler lazily (only Node needs it). */
function loadTypescript() {
	if (tsLoaded) {
		return ts;
	}

	tsLoaded = true;

	try {
		const require = createRequire(join(root, "package.json"));
		ts = require("typescript");
	} catch {
		try {
			ts = createRequire(import.meta.url)("typescript");
		} catch {
			ts = null;
		}
	}

	return ts;
}

/** URL for an existing path, following symlinks/junctions (pnpm, Bun). */
function toUrl(path) {
	try {
		return pathToFileURL(realpathSync(path)).href;
	} catch {
		return pathToFileURL(path).href;
	}
}

function isFile(path) {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

function isDirectory(path) {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

/** Minimal JSONC cleanup for tsconfig files when TypeScript is unavailable. */
function stripJsonComments(text) {
	return text
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:])\/\/.*$/gm, "$1")
		.replace(/,\s*([}\]])/g, "$1");
}

function patternScore(pattern) {
	const star = pattern.indexOf("*");
	return star === -1 ? Number.MAX_SAFE_INTEGER : star;
}

function matchPattern(pattern, specifier) {
	const star = pattern.indexOf("*");

	if (star === -1) {
		return pattern === specifier ? "" : null;
	}

	const prefix = pattern.slice(0, star);
	const suffix = pattern.slice(star + 1);

	if (
		!specifier.startsWith(prefix) ||
		!specifier.endsWith(suffix) ||
		specifier.length < prefix.length + suffix.length
	) {
		return null;
	}

	return specifier.slice(prefix.length, specifier.length - suffix.length);
}

function usePaths(paths, base) {
	basePath = base;

	if (!paths || typeof paths !== "object") {
		return;
	}

	pathMappings = Object.entries(paths)
		.filter((entry) => Array.isArray(entry[1]))
		.map(([pattern, targets]) => ({ pattern, targets }))
		.sort((a, b) => patternScore(b.pattern) - patternScore(a.pattern));
}

/** Reads `tsconfig.json`/`jsconfig.json` from the app root. */
function loadConfig() {
	for (const name of ["tsconfig.json", "jsconfig.json"]) {
		const configPath = join(root, name);

		if (!existsSync(configPath)) {
			continue;
		}

		const typescript = loadTypescript();

		if (typescript) {
			const read = typescript.readConfigFile(
				configPath,
				typescript.sys.readFile,
			);

			if (!read.error) {
				const parsed = typescript.parseJsonConfigFileContent(
					read.config,
					typescript.sys,
					dirname(configPath),
				);

				compilerOptions = parsed.options ?? {};

				const base =
					compilerOptions.baseUrl ??
					compilerOptions.pathsBasePath ??
					dirname(configPath);

				usePaths(
					compilerOptions.paths,
					isAbsolute(base)
						? base
						: resolvePath(dirname(configPath), base),
				);
				return;
			}
		}

		// TypeScript is optional for plain JavaScript apps; parse just enough
		// to honour `paths` when it is missing.
		try {
			const config = JSON.parse(
				stripJsonComments(readFileSync(configPath, "utf8")),
			);
			const options = config.compilerOptions ?? {};

			usePaths(
				options.paths,
				options.baseUrl
					? resolvePath(dirname(configPath), options.baseUrl)
					: dirname(configPath),
			);
		} catch {
			// Leave the loader as a pass-through.
		}

		return;
	}
}

function pickExport(value) {
	if (typeof value === "string") {
		return value;
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			const picked = pickExport(item);

			if (picked) {
				return picked;
			}
		}

		return null;
	}

	if (!value || typeof value !== "object") {
		return null;
	}

	for (const condition of ["import", "node", "module", "default", "require"]) {
		if (condition in value) {
			const picked = pickExport(value[condition]);

			if (picked) {
				return picked;
			}
		}
	}

	return null;
}

/** Picks the ESM entry from a package.json `exports`/`module`/`main`. */
function packageEntry(directory) {
	const manifest = join(directory, "package.json");

	if (!isFile(manifest)) {
		return null;
	}

	try {
		const pkg = JSON.parse(readFileSync(manifest, "utf8"));
		const exports = pkg.exports;

		if (typeof exports === "string") {
			return exports;
		}

		if (exports && typeof exports === "object") {
			const picked = pickExport("." in exports ? exports["."] : exports);

			if (picked) {
				return picked;
			}
		}

		if (typeof pkg.module === "string") {
			return pkg.module;
		}

		if (typeof pkg.main === "string") {
			return pkg.main;
		}
	} catch {
		return null;
	}

	return null;
}

/** Resolves a path as a file, a directory entry, or an index file. */
function resolveFileOrDirectory(candidate) {
	if (isFile(candidate)) {
		return candidate;
	}

	for (const extension of RESOLVE_EXTENSIONS) {
		if (isFile(candidate + extension)) {
			return candidate + extension;
		}
	}

	if (!isDirectory(candidate)) {
		return null;
	}

	const entry = packageEntry(candidate);

	if (entry) {
		const resolved = resolveFileOrDirectory(join(candidate, entry));

		if (resolved) {
			return resolved;
		}
	}

	// Repository development: a package whose `dist` has not been built yet
	// can still be imported through its TypeScript sources.
	const sourceEntry = resolveFileOrDirectory(join(candidate, "src", "index"));

	if (sourceEntry) {
		return sourceEntry;
	}

	for (const extension of RESOLVE_EXTENSIONS) {
		const index = join(candidate, `index${extension}`);

		if (isFile(index)) {
			return index;
		}
	}

	return null;
}

/** `module`/`commonjs` for a TypeScript file, based on its package.json. */
function moduleFormat(file, extension) {
	if (extension === ".cts") {
		return "commonjs";
	}

	if (extension === ".mts") {
		return "module";
	}

	let directory = dirname(file);

	while (directory !== dirname(directory)) {
		const manifest = join(directory, "package.json");

		if (isFile(manifest)) {
			try {
				const pkg = JSON.parse(readFileSync(manifest, "utf8"));
				return pkg.type === "commonjs" ? "commonjs" : "module";
			} catch {
				return "module";
			}
		}

		directory = dirname(directory);
	}

	return "module";
}

function transpile(file, source, format) {
	const typescript = loadTypescript();

	if (!typescript) {
		throw new Error(
			`barq: cannot load "${file}" on Node.js because the "typescript" package is not installed. ` +
				'Install it with "npm install -D typescript" or "bun add -d typescript" (or run the CLI with Bun).',
		);
	}

	const extension = extname(file).toLowerCase();
	const options = {
		...compilerOptions,
		module:
			format === "commonjs"
				? typescript.ModuleKind.CommonJS
				: typescript.ModuleKind.ESNext,
		target: typescript.ScriptTarget.ESNext,
		sourceMap: false,
		inlineSourceMap: true,
		inlineSources: true,
		declaration: false,
		declarationMap: false,
		emitDeclarationOnly: false,
		noEmit: false,
		composite: false,
		incremental: false,
		tsBuildInfoFile: undefined,
		outDir: undefined,
		rootDir: undefined,
		outFile: undefined,
		paths: undefined,
		baseUrl: undefined,
		isolatedModules: true,
		verbatimModuleSyntax:
			format === "module" ? compilerOptions.verbatimModuleSyntax : false,
	};

	const output = typescript.transpileModule(source, {
		compilerOptions: options,
		fileName: file,
	});

	return {
		format,
		source: output.outputText,
		shortCircuit: true,
	};
}

/** Called by `module.register()` and by the CLI before `registerHooks()`. */
export async function initialize(data) {
	if (data && typeof data.root === "string") {
		root = data.root;
	}

	loadConfig();
}

export function resolve(specifier, context, nextResolve) {
	if (
		specifier.startsWith("node:") ||
		specifier.startsWith("data:") ||
		specifier.startsWith("http:") ||
		specifier.startsWith("https:")
	) {
		return nextResolve(specifier, context);
	}

	for (const mapping of pathMappings) {
		const matched = matchPattern(mapping.pattern, specifier);

		if (matched === null) {
			continue;
		}

		for (const target of mapping.targets) {
			const candidate = resolvePath(
				basePath,
				target.replaceAll("*", matched),
			);
			const resolved = resolveFileOrDirectory(candidate);

			if (resolved) {
				return {
					url: toUrl(resolved),
					shortCircuit: true,
				};
			}
		}
	}

	const parent =
		context.parentURL && context.parentURL.startsWith("file:")
			? dirname(fileURLToPath(context.parentURL))
			: root;
	const isPath =
		specifier.startsWith(".") ||
		isAbsolute(specifier) ||
		specifier.startsWith("file:");

	if (isPath) {
		const candidate = specifier.startsWith("file:")
			? fileURLToPath(specifier)
			: resolvePath(parent, specifier);

		if (!isFile(candidate)) {
			const resolved = resolveFileOrDirectory(candidate);

			if (resolved) {
				return {
					url: toUrl(resolved),
					shortCircuit: true,
				};
			}

			if (/\.(js|mjs|cjs)$/.test(candidate)) {
				const base = candidate.replace(/\.(js|mjs|cjs)$/, "");

				for (const extension of [".ts", ".tsx", ".mts", ".cts"]) {
					if (isFile(base + extension)) {
						return {
							url: toUrl(base + extension),
							shortCircuit: true,
						};
					}
				}
			}
		}
	}

	return nextResolve(specifier, context);
}

export function load(url, context, nextLoad) {
	if (!url.startsWith("file:")) {
		return nextLoad(url, context);
	}

	const file = fileURLToPath(url);
	const extension = extname(file).toLowerCase();

	if (!TS_EXTENSIONS.has(extension)) {
		return nextLoad(url, context);
	}

	return transpile(
		file,
		readFileSync(file, "utf8"),
		moduleFormat(file, extension),
	);
}
