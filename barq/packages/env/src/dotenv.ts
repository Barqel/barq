import fs from "node:fs";
import path from "node:path";
import type { DotEnvOptions } from "./types";

function unescapeDoubleQuotes(str: string): string {
	return str
		.replace(/\\n/g, "\n")
		.replace(/\\r/g, "\r")
		.replace(/\\t/g, "\t")
		.replace(/\\"/g, '"')
		.replace(/\\\\/g, "\\");
}

export function parseDotEnv(src: string): Record<string, string> {
	const result: Record<string, string> = {};
	const lines = src.split(/\r?\n/);
	let currentKey: string | null = null;
	let currentValue = "";
	let inQuotes: "'" | '"' | null = null;

	for (let i = 0; i < lines.length; i++) {
		let line = lines[i]!;

		if (inQuotes) {
			const quoteEnd = line.indexOf(inQuotes);
			if (quoteEnd !== -1) {
				currentValue += `\n${line.slice(0, quoteEnd)}`;
				if (inQuotes === '"') {
					currentValue = unescapeDoubleQuotes(currentValue);
				}
				if (currentKey) {
					result[currentKey] = currentValue;
				}
				currentKey = null;
				currentValue = "";
				inQuotes = null;
			} else {
				currentValue += `\n${line}`;
			}
			continue;
		}

		line = line.trim();
		if (!line || line.startsWith("#")) continue;

		if (line.startsWith("export ")) {
			line = line.slice(7).trim();
		}

		const eqIdx = line.indexOf("=");
		if (eqIdx === -1) continue;

		const key = line.slice(0, eqIdx).trim();
		let val = line.slice(eqIdx + 1).trim();

		if (!key) continue;

		if (val.startsWith('"') || val.startsWith("'")) {
			const q = val[0] as '"' | "'";
			const endQuote = val.indexOf(q, 1);
			if (endQuote !== -1) {
				let content = val.slice(1, endQuote);
				if (q === '"') {
					content = unescapeDoubleQuotes(content);
				}
				result[key] = content;
			} else {
				inQuotes = q;
				currentKey = key;
				currentValue = val.slice(1);
			}
		} else {
			const commentIdx = val.search(/\s+#/);
			if (commentIdx !== -1) {
				val = val.slice(0, commentIdx).trim();
			}
			result[key] = val;
		}
	}

	return result;
}

export function expandVariables(
	parsed: Record<string, string>,
	envSource: Record<string, string | undefined>,
): Record<string, string> {
	const result: Record<string, string> = { ...parsed };
	for (const [key, val] of Object.entries(result)) {
		result[key] = val.replace(
			/\${([a-zA-Z0-9_]+)}|\$([a-zA-Z0-9_]+)/g,
			(_, m1, m2) => {
				const v = m1 || m2;
				return envSource[v] ?? result[v] ?? "";
			},
		);
	}
	return result;
}

export function loadDotEnv(
	options: DotEnvOptions = {},
): Record<string, string> {
	const cwd = options.cwd ?? process.cwd();
	const override = options.override ?? false;
	const nodeEnv = process.env.NODE_ENV ?? "development";

	const defaultFiles = [
		`.env.${nodeEnv}.local`,
		`.env.${nodeEnv}`,
		".env.local",
		".env",
	];

	const filesToTry = options.files
		? Array.isArray(options.files)
			? options.files
			: [options.files]
		: defaultFiles;

	const loaded: Record<string, string> = {};
	const ordered = [...filesToTry].reverse();

	for (const file of ordered) {
		const fullPath = path.isAbsolute(file) ? file : path.join(cwd, file);
		if (fs.existsSync(fullPath)) {
			try {
				const content = fs.readFileSync(fullPath, "utf8");
				const parsed = parseDotEnv(content);
				Object.assign(loaded, parsed);
			} catch {}
		}
	}

	const expanded = expandVariables(loaded, process.env);

	for (const [key, value] of Object.entries(expanded)) {
		if (override || process.env[key] === undefined) {
			process.env[key] = value;
			if (typeof Bun !== "undefined" && Bun.env) {
				Bun.env[key] = value;
			}
		}
	}

	return expanded;
}
