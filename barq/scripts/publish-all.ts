// Publishes the whole workspace to npm, in dependency order.
//
//   bun scripts/publish-all.ts --dry-run
//   bun scripts/publish-all.ts --tag next
//
// The order matters: the HTTP core first, then the plugins, then the
// application framework — every package depends on the ones before it.
import { execSync } from "node:child_process";

const root = "E:/Lab/barq/barq";

// The HTTP core, then the plugins, then the application framework.
const ORDER = [
	"barq",
	"cli",
	"compress",
	"cron",
	"email",
	"env",
	"events",
	"helmet",
	"i18n",
	"idempotency",
	"logger",
	"openapi",
	"rate-limit",
	"static",
	"app",
];

const flags = process.argv.slice(2);
const dryRun = flags.includes("--dry-run");
const tagIndex = flags.indexOf("--tag");
const tag = tagIndex === -1 ? "" : ` --tag ${flags[tagIndex + 1]}`;

for (const name of ORDER) {
	const args = ["scripts/publish-package.ts", name];

	if (dryRun) args.push("--dry-run");
	if (tag) args.push("--tag", flags[tagIndex + 1]);

	console.log(`\n${"─".repeat(60)}\n▶ ${name}\n${"─".repeat(60)}`);

	try {
		execSync(`bun ${args.join(" ")}`, {
			cwd: root,
			shell: "cmd.exe",
			stdio: "inherit",
		});
	} catch (error) {
		console.error(`\n✖ ${name} failed — the packages after it were not published.`);
		process.exit(1);
	}
}

console.log("\n✔ every package published");
