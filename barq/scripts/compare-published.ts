// Compare the local packages with the ones published on npm.
// Usage: bun scripts/compare-published.ts
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const root = "E:/Lab/barq/barq";
const tmp = "C:/Users/Hassan Kerdash/AppData/Local/Temp/opencode/npm-cmp";

function hash(file: string): string {
	return createHash("md5").update(readFileSync(file)).digest("hex");
}

function files(dir: string): string[] {
	if (!existsSync(dir)) return [];
	const out: string[] = [];

	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			out.push(...files(full).map((f) => join(entry, f)));
		} else {
			out.push(entry);
		}
	}

	return out.sort();
}

const packages = [
	...execSync("dir /b packages", { cwd: root, shell: "cmd.exe" })
		.toString()
		.split("\n")
		.map((s) => s.trim())
		.filter(Boolean),
	// The HTTP core lives in the repository root, not in `packages/`.
	"..",
];

for (const dir of packages) {
	const packageDir = dir === ".." ? root : join(root, "packages", dir);
	const manifest = JSON.parse(
		readFileSync(join(packageDir, "package.json"), "utf8").replace(
			/^\uFEFF/,
			"",
		),
	);
	const name: string = manifest.name;
	const version: string = manifest.version;

	let published: string | null = null;
	try {
		published = execSync(`npm view ${name} version`, {
			shell: "cmd.exe",
			stdio: ["ignore", "pipe", "ignore"],
		})
			.toString()
			.trim();
	} catch {
		published = null;
	}

	if (!published) {
		console.log(`${name}@${version} — NOT PUBLISHED`);
		continue;
	}

	if (published !== version) {
		console.log(`${name}@${version} — published ${published} (different version)`);
		continue;
	}

	execSync(`npm pack ${name}@${version}`, {
		cwd: tmp,
		shell: "cmd.exe",
		stdio: "ignore",
	});

	const tarball = readdirSync(tmp)
		.filter((f) => f.endsWith(".tgz") && f.includes(name.replace("@barqel/", "barqel-")))
		.map((f) => join(tmp, f))[0];

	if (!tarball) {
		console.log(`${name}@${version} — could not download`);
		continue;
	}

	const dest = join(tmp, `pkg-${dir}`);
	execSync(
		`rmdir /s /q "${dest}" 2>nul & mkdir "${dest}" && tar -xzf "${tarball}" -C "${dest}"`,
		{ shell: "cmd.exe", stdio: "ignore" },
	);

	const publishedDist = join(dest, "package", "dist");
	const localDist = join(packageDir, "dist");
	const pubFiles = files(publishedDist);
	const locFiles = files(localDist);

	const onlyLocal = locFiles.filter((f) => !pubFiles.includes(f));
	const onlyPublished = pubFiles.filter((f) => !locFiles.includes(f));
	const changed = pubFiles.filter(
		(f) =>
			locFiles.includes(f) &&
			hash(join(publishedDist, f)) !== hash(join(localDist, f)),
	);

	if (
		onlyLocal.length === 0 &&
		onlyPublished.length === 0 &&
		changed.length === 0
	) {
		console.log(`${name}@${version} — identical to npm`);
	} else {
		console.log(`${name}@${version} — DIFFERS from npm`);
		if (onlyLocal.length) console.log(`    only local: ${onlyLocal.join(", ")}`);
		if (onlyPublished.length) console.log(`    only npm:   ${onlyPublished.join(", ")}`);
		if (changed.length) console.log(`    changed:    ${changed.join(", ")}`);
	}
}
