// Resolves the module specifier that generated code uses to import this
// framework.
//
// Applications import the framework as `@barq` — the short alias that maps
// to the published package in the app `tsconfig.json`:
//
//   "paths": { "@barq": ["./node_modules/@barqel/barq-app"] }
//
// Bun honours tsconfig paths at runtime, so the alias resolves in the
// editor, in `bun run` and in the `barq` CLI alike. The generators make
// sure the mapping exists before they write a file, so scaffolded code
// always imports the same specifier as the hand-written code around it.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_ROOT } from "../kernel/paths";

/** Specifier every generated file imports the framework from. */
export const FRAMEWORK_IMPORT = "@barq";

/** Published package behind the alias. */
export const FRAMEWORK_PACKAGE = "@barqel/barq-app";

/** Where the alias points inside the application. */
const ALIAS_TARGET = "./node_modules/@barqel/barq-app";

/** Specifier for generated imports. */
export function frameworkImportSpecifier(): string {
	return FRAMEWORK_IMPORT;
}

/** Outcome of an attempt to map `@barq` in the app `tsconfig.json`. */
export interface FrameworkAliasResult {
	/** The mapping is in place. */
	ok: boolean;
	/** The tsconfig was created or edited. */
	changed: boolean;
	/** Why the mapping could not be ensured — `null` when `ok` is true. */
	reason: string | null;
}

/**
 * Makes sure the app `tsconfig.json` maps `@barq` to the framework package,
 * so generated imports resolve at runtime (Bun reads tsconfig paths) and in
 * the editor. Idempotent: an existing mapping is left untouched.
 */
export function ensureFrameworkAlias(): FrameworkAliasResult {
	const path = join(PROJECT_ROOT, "tsconfig.json");

	if (!existsSync(path)) {
		return createTsconfig(path);
	}

	let source: string;

	try {
		source = readFileSync(path, "utf8");
	} catch (error) {
		return { ok: false, changed: false, reason: describe(error) };
	}

	if (hasAlias(source)) {
		return { ok: true, changed: false, reason: null };
	}

	const updated = addAlias(source);

	if (updated === null) {
		return {
			ok: false,
			changed: false,
			reason:
				"the tsconfig extends another config — add the mapping there: " +
				`"paths": { "${FRAMEWORK_IMPORT}": ["${ALIAS_TARGET}"] }`,
		};
	}

	// Never write a file the framework cannot read back.
	if (readPaths(updated) === null) {
		return {
			ok: false,
			changed: false,
			reason: "the tsconfig could not be updated safely",
		};
	}

	try {
		writeFileSync(path, updated, "utf8");
	} catch (error) {
		return { ok: false, changed: false, reason: describe(error) };
	}

	return { ok: true, changed: true, reason: null };
}

/** Writes a minimal tsconfig that maps the alias. */
function createTsconfig(path: string): FrameworkAliasResult {
	const source = `{
	"compilerOptions": {
		"paths": {
			"${FRAMEWORK_IMPORT}": ["${ALIAS_TARGET}"]
		}
	}
}
`;

	try {
		writeFileSync(path, source, "utf8");
	} catch (error) {
		return { ok: false, changed: false, reason: describe(error) };
	}

	return { ok: true, changed: true, reason: null };
}

/** True when the tsconfig already maps the alias. */
function hasAlias(source: string): boolean {
	const paths = readPaths(source);

	return paths !== null && Object.hasOwn(paths, FRAMEWORK_IMPORT);
}

/**
 * Inserts the mapping into the tsconfig source, keeping the file's comments
 * and layout intact. `null` when the edit is not safe (an `extends` base
 * without a local `paths` would lose the inherited mappings).
 */
function addAlias(source: string): string | null {
	const rootStart = rootObjectStart(source);

	if (rootStart === -1) {
		return null;
	}

	const root = readObjectProperties(source, rootStart);
	const compilerOptions = root.get("compilerOptions");
	const optionsStart =
		compilerOptions === undefined ? -1 : compilerOptions.objectStart;
	const options =
		optionsStart === -1
			? new Map<string, RootProperty>()
			: readObjectProperties(source, optionsStart);
	const paths = options.get("paths");

	if (paths !== undefined && paths.objectStart !== -1) {
		return insertIntoObject(source, paths.objectStart, aliasMember);
	}

	if (root.has("extends")) {
		return null;
	}

	if (optionsStart !== -1) {
		return insertIntoObject(source, optionsStart, pathsMember);
	}

	return insertIntoObject(source, rootStart, compilerOptionsMember);
}

/** The `"@barq": [...]` member. */
function aliasMember(indent: string): string {
	return `${indent}"${FRAMEWORK_IMPORT}": ["${ALIAS_TARGET}"]`;
}

/** The `paths` member holding the alias. */
function pathsMember(indent: string): string {
	return `${indent}"paths": {
${indent}\t${aliasMember("")}
${indent}}`;
}

/** The whole `compilerOptions` member, for a tsconfig without one. */
function compilerOptionsMember(indent: string): string {
	return `${indent}"compilerOptions": {
${indent}\t"paths": {
${indent}\t\t${aliasMember("")}
${indent}\t}
${indent}}`;
}

/**
 * Inserts a member as the first entry of the object opened at `objectStart`.
 * The member keeps the indentation of the entries already in the object, and
 * a comma is added only when the object holds something else.
 */
function insertIntoObject(
	source: string,
	objectStart: number,
	member: (indent: string) => string,
): string {
	const end = matchBrace(source, objectStart);
	const content = source.slice(objectStart + 1, end === -1 ? undefined : end);
	const indent = contentIndent(source, objectStart, end);
	const separator = hasMembers(content) ? "," : "";

	return `${source.slice(0, objectStart + 1)}\n${member(indent)}${separator}${source.slice(objectStart + 1)}`;
}

/** Indentation of the first entry of an object. */
function contentIndent(
	source: string,
	objectStart: number,
	end: number,
): string {
	const content = source.slice(objectStart + 1, end === -1 ? undefined : end);
	const match = /\n([ \t]*)\S/.exec(content);

	if (match !== null) {
		return match[1]!;
	}

	return `${indentOf(source, objectStart)}\t`;
}

/** Indentation of the line the object starts on. */
function indentOf(source: string, objectStart: number): string {
	const lineStart = source.lastIndexOf("\n", objectStart - 1) + 1;
	const match = /^[ \t]*/.exec(source.slice(lineStart, objectStart));

	return match === null ? "" : match[0];
}

/** True when the object body holds at least one entry (comments aside). */
function hasMembers(content: string): boolean {
	return stripJsonComments(content).trim().length > 0;
}

/** Index of the `{` that opens the root object. */
function rootObjectStart(source: string): number {
	const start = source.indexOf("{");

	return start === -1 ? -1 : start;
}

/** A root-level property of the tsconfig. */
interface RootProperty {
	/** Index of the `{` opening the value object, or -1. */
	objectStart: number;
}

/**
 * Properties directly inside the object opened at `objectStart`, with the
 * position of the object each one holds. A tiny scanner — the file may carry
 * comments, trailing commas and arbitrary formatting, so it is edited as
 * text, never rewritten from a parsed object.
 */
function readObjectProperties(
	source: string,
	objectStart: number,
): Map<string, RootProperty> {
	const properties = new Map<string, RootProperty>();
	let depth = 0;
	let index = objectStart;

	while (index < source.length) {
		const char = source[index]!;

		if (char === '"') {
			const literal = readString(source, index);

			if (literal === null) {
				break;
			}

			const after = skipTrivia(source, literal.end);

			if (depth === 1 && source[after] === ":") {
				const valueStart = skipTrivia(source, after + 1);
				const valueObjectStart = source[valueStart] === "{" ? valueStart : -1;

				properties.set(literal.value, { objectStart: valueObjectStart });

				if (valueObjectStart === -1) {
					index = valueStart;
					continue;
				}

				const end = matchBrace(source, valueObjectStart);

				if (end === -1) {
					break;
				}

				index = end + 1;
				continue;
			}

			index = literal.end;
			continue;
		}

		if (char === "/" && source[index + 1] === "/") {
			index = skipLineComment(source, index);
			continue;
		}

		if (char === "/" && source[index + 1] === "*") {
			index = skipBlockComment(source, index);
			continue;
		}

		if (char === "{") {
			depth += 1;
		} else if (char === "}") {
			depth -= 1;

			if (depth === 0) {
				break;
			}
		}

		index += 1;
	}

	return properties;
}

/** A JSON string literal and the index right after it. */
interface StringLiteral {
	value: string;
	end: number;
}

/** Reads a JSON string literal starting at `start`. */
function readString(source: string, start: number): StringLiteral | null {
	let index = start + 1;
	let value = "";

	while (index < source.length) {
		const char = source[index]!;

		if (char === "\\") {
			value += source[index + 1] ?? "";
			index += 2;
			continue;
		}

		if (char === '"') {
			return { value, end: index + 1 };
		}

		value += char;
		index += 1;
	}

	return null;
}

/** Index of the `}` closing the object opened at `open`. */
function matchBrace(source: string, open: number): number {
	let depth = 0;
	let index = open;

	while (index < source.length) {
		const char = source[index]!;

		if (char === '"') {
			const literal = readString(source, index);

			if (literal === null) {
				return -1;
			}

			index = literal.end;
			continue;
		}

		if (char === "/" && source[index + 1] === "/") {
			index = skipLineComment(source, index);
			continue;
		}

		if (char === "/" && source[index + 1] === "*") {
			index = skipBlockComment(source, index);
			continue;
		}

		if (char === "{") {
			depth += 1;
		} else if (char === "}") {
			depth -= 1;

			if (depth === 0) {
				return index;
			}
		}

		index += 1;
	}

	return -1;
}

/** Skips whitespace and comments, returning the next meaningful index. */
function skipTrivia(source: string, start: number): number {
	let index = start;

	while (index < source.length) {
		const char = source[index]!;

		if (char === " " || char === "\t" || char === "\n" || char === "\r") {
			index += 1;
			continue;
		}

		if (char === "/" && source[index + 1] === "/") {
			index = skipLineComment(source, index);
			continue;
		}

		if (char === "/" && source[index + 1] === "*") {
			index = skipBlockComment(source, index);
			continue;
		}

		break;
	}

	return index;
}

/** Index right after a `//` comment. */
function skipLineComment(source: string, start: number): number {
	const end = source.indexOf("\n", start);

	return end === -1 ? source.length : end + 1;
}

/** Index right after a block comment. */
function skipBlockComment(source: string, start: number): number {
	const end = source.indexOf("*/", start + 2);

	return end === -1 ? source.length : end + 2;
}

/** `compilerOptions.paths` of a tsconfig source; `null` when unreadable. */
function readPaths(source: string): Record<string, unknown> | null {
	let parsed: {
		compilerOptions?: { paths?: Record<string, unknown> };
	};

	try {
		parsed = JSON.parse(stripJsonComments(source)) as typeof parsed;
	} catch {
		return null;
	}

	return parsed.compilerOptions?.paths ?? {};
}

/** tsconfig files may carry line comments, block comments and trailing commas. */
function stripJsonComments(source: string): string {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:"'])\/\/[^\n]*/gm, "$1")
		.replace(/,(\s*[}\]])/g, "$1");
}

/** Human-readable failure reason for an exception. */
function describe(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
}
