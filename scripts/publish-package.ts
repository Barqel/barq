// Publishes one package of the workspace to npm.
//
// The sibling packages are linked with `file:` paths, so the monorepo always
// runs the local sources — but npm needs the published ranges. This script
// swaps the links for the real versions (`^<local version>`), publishes,
// and puts the links back.
//
//   bun scripts/publish-package.ts email          # @barqel/barq-email
//   bun scripts/publish-package.ts barq           # the HTTP core (repo root)
//   bun scripts/publish-package.ts app --dry-run
//   bun scripts/publish-package.ts email --tag next
//   bun scripts/publish-package.ts email --no-publish   # swap + restore only
import { execSync } from "node:child_process";
import {
	existsSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

const root = "E:/Lab/barq/barq";

/** The workspace packages — the HTTP core lives in the repository root. */
function workspace(): Map<string, string> {
	const packages = new Map<string, string>();

	packages.set("@barqel/barq", root);

	for (const entry of readdirSync(join(root, "packages"), {
		withFileTypes: true,
	})) {
		if (!entry.isDirectory()) continue;

		const dir = join(root, "packages", entry.name);
		const manifestPath = join(dir, "package.json");

		if (!existsSync(manifestPath)) continue;

		const manifest = JSON.parse(
			readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, ""),
		);

		packages.set(manifest.name, dir);
	}

	return packages;
}

/** The local version of a workspace package. */
function localVersion(name: string, packages: Map<string, string>): string {
	const dir = packages.get(name);

	if (!dir) {
		throw new Error(`Unknown workspace package: ${name}`);
	}

	return JSON.parse(
		readFileSync(join(dir, "package.json"), "utf8").replace(/^\uFEFF/, ""),
	).version;
}

const [name, ...flags] = process.argv.slice(2);

if (!name || name.startsWith("-")) {
	console.error(
		"Usage: bun scripts/publish-package.ts <package> [--dry-run] [--no-publish] [--tag <tag>]",
	);
	console.error(
		"  <package> — a directory in packages/ (email, app, cron, …) or 'barq'",
	);
	process.exit(1);
}

const dryRun = flags.includes("--dry-run");
const noPublish = flags.includes("--no-publish");
const tagIndex = flags.indexOf("--tag");
const tag = tagIndex === -1 ? "latest" : flags[tagIndex + 1];

const packages = workspace();
const dir = name === "barq" ? root : join(root, "packages", name);
const manifestPath = join(dir, "package.json");

if (!existsSync(manifestPath)) {
	console.error(`No package at ${dir}`);
	process.exit(1);
}

const original = readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(original.replace(/^\uFEFF/, ""));

// npm refuses to publish over a version that already exists — a package
// whose sources did not change since the last release needs no publish.
let publishedVersion: string | null = null;

try {
	publishedVersion = execSync(
		`npm view ${manifest.name}@${manifest.version} version`,
		{ shell: "cmd.exe", stdio: ["ignore", "pipe", "ignore"] },
	)
		.toString()
		.trim();
} catch {
	publishedVersion = null;
}

if (publishedVersion) {
	console.log(
		`${manifest.name}@${manifest.version} is already on npm — bump the version to publish it again.`,
	);
	process.exit(0);
}

// A previous run that was killed mid-publish may have left the swapped
// manifest behind — the backup file is the source of truth.
const backupPath = `${manifestPath}.publish-backup`;

if (existsSync(backupPath)) {
	console.log("↩ restoring the manifest of an interrupted publish");
	writeFileSync(manifestPath, readFileSync(backupPath, "utf8"));
}

// Swap every local link for the published range of that package.
const changes: string[] = [];

for (const field of ["dependencies", "peerDependencies", "devDependencies"]) {
	const deps = manifest[field];

	if (!deps) continue;

	for (const dependency of Object.keys(deps)) {
		if (!dependency.startsWith("@barqel/")) continue;
		if (!packages.has(dependency)) continue;

		const version = localVersion(dependency, packages);
		// A dependency pins the range, a peer dependency stays open — the
		// consumer may run a newer core.
		const range =
			field === "peerDependencies" ? `>=${version}` : `^${version}`;

		if (deps[dependency] !== range) {
			changes.push(`${dependency}: ${deps[dependency]} → ${range}`);
			deps[dependency] = range;
		}
	}
}

console.log(`\n${manifest.name}@${manifest.version}`);

for (const change of changes) {
	console.log(`   ${change}`);
}

if (changes.length === 0) {
	console.log("   (no dependency changes)");
}

if (changes.length > 0) {
	writeFileSync(backupPath, original);
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`);
}

if (noPublish) {
	if (changes.length > 0) {
		writeFileSync(manifestPath, original);
		rmSync(backupPath, { force: true });
	}

	console.log("   (nothing published — the manifest is back to its local links)\n");
	process.exit(0);
}

const publishArgs = ["publish", "--access", "public"];

if (dryRun) publishArgs.push("--dry-run");
if (tag !== "latest") publishArgs.push("--tag", tag);

try {
	execSync(`npm ${publishArgs.join(" ")}`, {
		cwd: dir,
		shell: "cmd.exe",
		stdio: "inherit",
	});
} finally {
	// Always put the local links back — the monorepo keeps running the
	// local sources.
	if (changes.length > 0) {
		writeFileSync(manifestPath, original);

		if (existsSync(backupPath)) {
			writeFileSync(manifestPath, readFileSync(backupPath, "utf8"));
			rmSync(backupPath, { force: true });
		}

		console.log("   local links restored");
	}
}
