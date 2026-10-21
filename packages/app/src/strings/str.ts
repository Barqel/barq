// Strings — the `Str` class: every string helper the framework exposes,
// Laravel's API, without a dependency.
//
//   import { Str } from "@barq";
//
//   Str.after("This is my name", "This is"); // → " my name"
//   Str.camel("foo_bar");                    // → "fooBar"
//   Str.slug("Laravel 5 Framework");         // → "laravel-5-framework"
//
// For a fluent, chainable API use `Str.of(...)` (or the `Stringable` class
// directly) — `Str.of("foo_bar").camel().upper()`.
import { randomBytes, randomUUID } from "node:crypto";
import { type Collection, collect } from "../vendor";
import { ArabicPlural } from "./arabic";
import {
	apa as apaCase,
	camel as camelCase,
	headline as headlineCase,
	kebab as kebabCase,
	lcfirst as lowercaseFirst,
	snake as snakeCase,
	words as splitWords,
	studly as studlyCase,
	title as titleCase,
	ucfirst as uppercaseFirst,
	ucwords as uppercaseWords,
} from "./case";
import {
	escapeHtml,
	inlineMarkdown,
	type MarkdownOptions,
	markdown,
} from "./markdown";
import { toRegExp } from "./pattern";
import { Pluralizer } from "./pluralizer";
import { Stringable } from "./stringable";
import { ascii, transliterate } from "./transliterate";

/** Options accepted by `Str.excerpt`. */
export interface ExcerptOptions {
	/** Characters kept on each side of the phrase — default 100. */
	radius?: number;
	/** The string prepended/appended to a truncated excerpt — default "...". */
	omission?: string;
}

/** The characters `trim` removes when no character list is given. */
const UNICODE_WHITESPACE =
	/[\s\uFEFF\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/u;

const PASSWORD_SYMBOLS = "~!@#$%^&*()_+-={}[]|:;<>,.?/";
const PASSWORD_CHARACTERS =
	"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** Laravel's `Str` helper — every method is static. */
// biome-ignore lint/complexity/noStaticOnlyClass: the API is static by design
export class Str {
	/** A fluent, chainable version of a string. */
	static of(value: string): Stringable {
		return new Stringable(value);
	}

	// --- slicing -------------------------------------------------------------

	/** Everything after the first occurrence of `search`. */
	static after(value: string, search: string): string {
		const index = value.indexOf(search);

		return index === -1 ? value : value.slice(index + search.length);
	}

	/** Everything after the last occurrence of `search`. */
	static afterLast(value: string, search: string): string {
		const index = value.lastIndexOf(search);

		return index === -1 ? value : value.slice(index + search.length);
	}

	/** Everything before the first occurrence of `search`. */
	static before(value: string, search: string): string {
		const index = value.indexOf(search);

		return index === -1 ? value : value.slice(0, index);
	}

	/** Everything before the last occurrence of `search`. */
	static beforeLast(value: string, search: string): string {
		const index = value.lastIndexOf(search);

		return index === -1 ? value : value.slice(0, index);
	}

	/** The portion between two values. */
	static between(value: string, from: string, to: string): string {
		if (from === "" || to === "") {
			return value;
		}

		return Str.beforeLast(Str.after(value, from), to);
	}

	/** The smallest portion between two values. */
	static betweenFirst(value: string, from: string, to: string): string {
		if (from === "" || to === "") {
			return value;
		}

		const start = value.indexOf(from);

		if (start === -1) {
			return value;
		}

		const end = value.indexOf(to, start + from.length);

		if (end === -1) {
			return value;
		}

		return value.slice(start + from.length, end);
	}

	/** The character at `index`, or `null` when out of bounds. */
	static charAt(value: string, index: number): string | null {
		const characters = [...value];

		return characters[index] ?? null;
	}

	/** The first `length` characters. */
	static take(value: string, length: number): string {
		return [...value].slice(0, length).join("");
	}

	/** The portion of the string, like `substr`. */
	static substr(value: string, start: number, length?: number): string {
		const characters = [...value];
		const from = start < 0 ? Math.max(characters.length + start, 0) : start;

		if (length === undefined) {
			return characters.slice(from).join("");
		}

		return characters.slice(from, from + length).join("");
	}

	/** Replaces text inside a portion of the string. */
	static substrReplace(
		value: string,
		replace: string,
		offset: number,
		length?: number,
	): string {
		const characters = [...value];
		const from = offset < 0 ? Math.max(characters.length + offset, 0) : offset;
		const count = length ?? characters.length - from;

		return [
			...characters.slice(0, from),
			...replace,
			...characters.slice(from + count),
		].join("");
	}

	/** The number of times `search` appears in the string. */
	static substrCount(
		value: string,
		search: string,
		ignoreCase = false,
	): number {
		if (search === "") {
			return 0;
		}

		const haystack = ignoreCase ? value.toLowerCase() : value;
		const needle = ignoreCase ? search.toLowerCase() : search;
		let count = 0;
		let index = haystack.indexOf(needle);

		while (index !== -1) {
			count += 1;
			index = haystack.indexOf(needle, index + needle.length);
		}

		return count;
	}

	// --- searching ------------------------------------------------------------

	/** True when the string contains any of the needles. */
	static contains(
		value: string,
		needles: string | string[],
		ignoreCase = false,
	): boolean {
		const haystack = ignoreCase ? value.toLowerCase() : value;
		const list = Array.isArray(needles) ? needles : [needles];

		return list.some((needle) =>
			haystack.includes(ignoreCase ? needle.toLowerCase() : needle),
		);
	}

	/** True when the string contains every needle. */
	static containsAll(
		value: string,
		needles: string | string[],
		ignoreCase = false,
	): boolean {
		const haystack = ignoreCase ? value.toLowerCase() : value;
		const list = Array.isArray(needles) ? needles : [needles];

		return list.every((needle) =>
			haystack.includes(ignoreCase ? needle.toLowerCase() : needle),
		);
	}

	/** True when the string contains none of the needles. */
	static doesntContain(
		value: string,
		needles: string | string[],
		ignoreCase = false,
	): boolean {
		return !Str.contains(value, needles, ignoreCase);
	}

	/** True when the string starts with one of the needles. */
	static startsWith(value: string, needles: string | string[]): boolean {
		const list = Array.isArray(needles) ? needles : [needles];

		return list.some((needle) => value.startsWith(needle));
	}

	/** True when the string starts with none of the needles. */
	static doesntStartWith(value: string, needles: string | string[]): boolean {
		return !Str.startsWith(value, needles);
	}

	/** True when the string ends with one of the needles. */
	static endsWith(value: string, needles: string | string[]): boolean {
		const list = Array.isArray(needles) ? needles : [needles];

		return list.some((needle) => value.endsWith(needle));
	}

	/** True when the string ends with none of the needles. */
	static doesntEndWith(value: string, needles: string | string[]): boolean {
		return !Str.endsWith(value, needles);
	}

	/** True when the string matches a `*` wildcard pattern. */
	static is(pattern: string, value: string, ignoreCase = false): boolean {
		const escaped = pattern
			.replace(/[.+^${}()|[\]\\]/gu, "\\$&")
			.replace(/\*/gu, ".*")
			.replace(/\\\*/gu, "\\*");
		const expression = new RegExp(`^${escaped}$`, ignoreCase ? "iu" : "u");

		return expression.test(value);
	}

	/** True when the string matches a regular expression. */
	static isMatch(pattern: string, value: string): boolean {
		return toRegExp(pattern, "u").test(value);
	}

	/** The portion of the string matching a regular expression. */
	static match(pattern: string, value: string): string | null {
		const match = toRegExp(pattern, "u").exec(value);

		return match?.[0] ?? null;
	}

	/** Every portion of the string matching a regular expression. */
	static matchAll(pattern: string, value: string): Collection<string> {
		const matches = [...value.matchAll(toRegExp(pattern, "gu"))];
		const groups = matches.some((match) => match.length > 1);

		return collect(
			matches.map((match) => (groups ? (match[1] ?? "") : match[0])),
		);
	}

	/** The position of the first occurrence of `needle`, or `null`. */
	static position(value: string, needle: string): number | null {
		const index = value.indexOf(needle);

		return index === -1 ? null : index;
	}

	// --- replacing ------------------------------------------------------------

	/** Replaces a value in the string. */
	static replace(
		value: string,
		search: string | string[],
		replace: string,
		caseSensitive = true,
	): string {
		const list = Array.isArray(search) ? search : [search];

		if (caseSensitive) {
			for (const needle of list) {
				value = value.split(needle).join(replace);
			}

			return value;
		}

		const expression = new RegExp(
			list
				.map((needle) => needle.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
				.join("|"),
			"giu",
		);

		return value.replace(expression, replace);
	}

	/** Replaces the first occurrence of a value. */
	static replaceFirst(search: string, replace: string, value: string): string {
		const index = value.indexOf(search);

		return index === -1
			? value
			: value.slice(0, index) + replace + value.slice(index + search.length);
	}

	/** Replaces the last occurrence of a value. */
	static replaceLast(search: string, replace: string, value: string): string {
		const index = value.lastIndexOf(search);

		return index === -1
			? value
			: value.slice(0, index) + replace + value.slice(index + search.length);
	}

	/** Replaces every occurrence of a value with the next one in the list. */
	static replaceArray(
		search: string,
		replace: string[],
		value: string,
	): string {
		let result = value;

		for (const replacement of replace) {
			result = result.replace(search, replacement);
		}

		return result;
	}

	/** Replaces the first occurrence of a value, only at the start. */
	static replaceStart(search: string, replace: string, value: string): string {
		return value.startsWith(search)
			? replace + value.slice(search.length)
			: value;
	}

	/** Replaces the last occurrence of a value, only at the end. */
	static replaceEnd(search: string, replace: string, value: string): string {
		return value.endsWith(search)
			? value.slice(0, value.length - search.length) + replace
			: value;
	}

	/** Replaces every portion matching a regular expression. */
	static replaceMatches(
		pattern: string,
		replace: string | ((matches: RegExpMatchArray) => string),
		value: string,
	): string {
		if (typeof replace === "function") {
			return value.replace(toRegExp(pattern, "gu"), (...args) =>
				replace(args as unknown as RegExpMatchArray),
			);
		}

		return value.replace(toRegExp(pattern, "gu"), replace);
	}

	/** Removes values from the string. */
	static remove(
		value: string,
		search: string | string[],
		ignoreCase = false,
	): string {
		const list = Array.isArray(search) ? search : [search];

		if (ignoreCase) {
			const expression = new RegExp(
				list
					.map((needle) => needle.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
					.join("|"),
				"giu",
			);

			return value.replace(expression, "");
		}

		let result = value;

		for (const needle of list) {
			result = result.split(needle).join("");
		}

		return result;
	}

	/** Replaces several values at once — the longest key wins. */
	static swap(replacements: Record<string, string>, value: string): string {
		const keys = Object.keys(replacements).sort(
			(first, second) => second.length - first.length,
		);
		let result = value;

		for (const key of keys) {
			result = result.split(key).join(replacements[key] ?? "");
		}

		return result;
	}

	/** Repeats the string. */
	static repeat(value: string, times: number): string {
		return times <= 0 ? "" : value.repeat(times);
	}

	/** Removes a prefix, only when the string starts with it. */
	static chopStart(value: string, chop: string | string[]): string {
		const list = Array.isArray(chop) ? chop : [chop];

		for (const needle of list) {
			if (needle !== "" && value.startsWith(needle)) {
				return value.slice(needle.length);
			}
		}

		return value;
	}

	/** Removes a suffix, only when the string ends with it. */
	static chopEnd(value: string, chop: string | string[]): string {
		const list = Array.isArray(chop) ? chop : [chop];

		for (const needle of list) {
			if (needle !== "" && value.endsWith(needle)) {
				return value.slice(0, value.length - needle.length);
			}
		}

		return value;
	}

	// --- trimming -------------------------------------------------------------

	/** Removes whitespace from both ends. */
	static trim(value: string, characters?: string): string {
		if (characters === undefined) {
			return value.replace(
				new RegExp(
					`^${UNICODE_WHITESPACE.source}+|${UNICODE_WHITESPACE.source}+$`,
					"gu",
				),
				"",
			);
		}

		return trimWith(value, characters, true, true);
	}

	/** Removes whitespace from the start. */
	static ltrim(value: string, characters?: string): string {
		if (characters === undefined) {
			return value.replace(
				new RegExp(`^${UNICODE_WHITESPACE.source}+`, "gu"),
				"",
			);
		}

		return trimWith(value, characters, true, false);
	}

	/** Removes whitespace from the end. */
	static rtrim(value: string, characters?: string): string {
		if (characters === undefined) {
			return value.replace(
				new RegExp(`${UNICODE_WHITESPACE.source}+$`, "gu"),
				"",
			);
		}

		return trimWith(value, characters, false, true);
	}

	/** Removes the given strings from both ends. */
	static unwrap(value: string, before: string, after: string = before): string {
		let result = value;

		if (before !== "" && result.startsWith(before)) {
			result = result.slice(before.length);
		}

		if (after !== "" && result.endsWith(after)) {
			result = result.slice(0, result.length - after.length);
		}

		return result;
	}

	/** Wraps the string with another string. */
	static wrap(value: string, before: string, after: string = before): string {
		return `${before}${value}${after}`;
	}

	/** Adds a prefix, when the string does not already have it. */
	static start(value: string, prefix: string): string {
		return value.startsWith(prefix) ? value : prefix + value;
	}

	/** Adds a suffix, when the string does not already have it. */
	static finish(value: string, suffix: string): string {
		return value.endsWith(suffix) ? value : value + suffix;
	}

	/** Removes the whitespace between words. */
	static squish(value: string): string {
		return value
			.replace(new RegExp(`${UNICODE_WHITESPACE.source}+`, "gu"), " ")
			.trim();
	}

	/** Replaces consecutive characters with a single one. */
	static deduplicate(value: string, character: string = " "): string {
		if (character === "") {
			return value;
		}

		const escaped = character.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

		return value.replace(new RegExp(`${escaped}+`, "gu"), character);
	}

	// --- case -----------------------------------------------------------------

	/** Lowercases the string. */
	static lower(value: string): string {
		return value.toLowerCase();
	}

	/** Uppercases the string. */
	static upper(value: string): string {
		return value.toUpperCase();
	}

	/** Uppercases the first character. */
	static ucfirst(value: string): string {
		return uppercaseFirst(value);
	}

	/** Lowercases the first character. */
	static lcfirst(value: string): string {
		return lowercaseFirst(value);
	}

	/** Uppercases the first character of every word. */
	static ucwords(value: string, delimiters?: string): string {
		return uppercaseWords(value, delimiters);
	}

	/** Splits the string on uppercase characters. */
	static ucsplit(value: string): string[] {
		return value.split(/(?=\p{Lu})/u).filter((part) => part !== "");
	}

	/** `foo_bar` → `FooBar`. */
	static studly(value: string): string {
		return studlyCase(value);
	}

	/** `foo_bar` → `fooBar`. */
	static camel(value: string): string {
		return camelCase(value);
	}

	/** `fooBar` → `foo_bar`. */
	static snake(value: string, delimiter: string = "_"): string {
		return snakeCase(value, delimiter);
	}

	/** `fooBar` → `foo-bar`. */
	static kebab(value: string): string {
		return kebabCase(value);
	}

	/** `steve_jobs` → `Steve Jobs`. */
	static headline(value: string): string {
		return headlineCase(value);
	}

	/** `a nice title` → `A Nice Title`. */
	static title(value: string): string {
		return titleCase(value);
	}

	/** `Creating A Project` → `Creating a Project` (APA title case). */
	static apa(value: string): string {
		return apaCase(value);
	}

	/** The number of characters in the string. */
	static length(value: string): number {
		return [...value].length;
	}

	/** The number of words in the string. */
	static wordCount(value: string): number {
		return value.trim() === "" ? 0 : value.trim().split(/\s+/u).length;
	}

	/** The first `count` words, with an ending appended. */
	static words(value: string, count: number, end: string = "..."): string {
		const words = value
			.trim()
			.split(/\s+/u)
			.filter((word) => word !== "");

		if (words.length <= count) {
			return value;
		}

		return words.slice(0, count).join(" ") + end;
	}

	// --- URLs, identifiers and encodings --------------------------------------

	/** A URL-friendly slug. */
	static slug(value: string, separator: string = "-"): string {
		const escaped = escapeRegExp(separator);

		return transliterate(value)
			.replace(/['’]/gu, "")
			.replace(/[^\p{L}\p{N}]+/gu, separator)
			.replace(new RegExp(`^${escaped}+|${escaped}+$`, "gu"), "")
			.replace(new RegExp(`${escaped}{2,}`, "gu"), separator)
			.toLowerCase();
	}

	/** The base64 representation of the string. */
	static toBase64(value: string): string {
		return Buffer.from(value, "utf8").toString("base64");
	}

	/** Decodes a base64 string. */
	static fromBase64(value: string): string {
		return Buffer.from(value, "base64").toString("utf8");
	}

	/** The closest ASCII representation of the string. */
	static ascii(value: string): string {
		return ascii(value);
	}

	/** The closest ASCII representation of the string. */
	static transliterate(value: string): string {
		return transliterate(value);
	}

	/** The class name, without its namespace. */
	static classBasename(value: string): string {
		const parts = value.split("\\");

		return parts[parts.length - 1] ?? value;
	}

	/** The HTML-escaped string. */
	static escapeHtml(value: string): string {
		return escapeHtml(value);
	}

	/** True when the string is 7-bit ASCII. */
	static isAscii(value: string): boolean {
		// biome-ignore lint/suspicious/noControlCharactersInRegex: the ASCII range is the point
		return /^[\x00-\x7F]*$/u.test(value);
	}

	/** True when the string is valid JSON. */
	static isJson(value: string): boolean {
		try {
			JSON.parse(value);

			return true;
		} catch {
			return false;
		}
	}

	/** True when the string is a valid URL. */
	static isUrl(value: string, protocols: string[] = []): boolean {
		let url: URL;

		try {
			url = new URL(value);
		} catch {
			return false;
		}

		if (protocols.length === 0) {
			return true;
		}

		return protocols.includes(url.protocol.replace(/:$/u, ""));
	}

	/** True when the string is a valid UUID (optionally of a given version). */
	static isUuid(value: string, version?: number): boolean {
		const expression =
			version === undefined
				? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
				: new RegExp(
						`^[0-9a-f]{8}-[0-9a-f]{4}-${version}[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
						"iu",
					);

		return expression.test(value);
	}

	/** True when the string is a valid ULID. */
	static isUlid(value: string): boolean {
		return /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/iu.test(value);
	}

	/** A random UUID (version 4). */
	static uuid(): string {
		return randomUUID();
	}

	/** A time-ordered UUID (version 7). */
	static uuid7(date: Date = new Date()): string {
		const bytes = randomBytes(16);
		const timestamp = BigInt(date.getTime());

		bytes[0] = Number((timestamp >> 40n) & 0xffn);
		bytes[1] = Number((timestamp >> 32n) & 0xffn);
		bytes[2] = Number((timestamp >> 24n) & 0xffn);
		bytes[3] = Number((timestamp >> 16n) & 0xffn);
		bytes[4] = Number((timestamp >> 8n) & 0xffn);
		bytes[5] = Number(timestamp & 0xffn);
		bytes[6] = (bytes[6]! & 0x0f) | 0x70;
		bytes[8] = (bytes[8]! & 0x3f) | 0x80;

		const hex = bytes.toString("hex");

		return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
	}

	/** A UUID whose first bytes carry the timestamp — sorts by creation. */
	static orderedUuid(): string {
		const bytes = randomBytes(16);
		const timestamp = Math.floor(Date.now() / 1000);

		bytes[0] = Math.floor(timestamp / 2 ** 24) & 0xff;
		bytes[1] = Math.floor(timestamp / 2 ** 16) & 0xff;
		bytes[2] = Math.floor(timestamp / 2 ** 8) & 0xff;
		bytes[3] = timestamp & 0xff;
		bytes[4] = (bytes[4]! & 0x0f) | 0x40;
		bytes[8] = (bytes[8]! & 0x3f) | 0x80;

		const hex = bytes.toString("hex");

		return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
	}

	/** A ULID — compact, time-ordered, lexicographically sortable. */
	static ulid(): string {
		const timestamp = Date.now();
		const bytes = randomBytes(10);

		const time = Buffer.alloc(6);
		time.writeUIntBE(timestamp, 0, 6);

		return encodeCrockford(Buffer.concat([time, bytes]));
	}

	/** A random alphanumeric string. */
	static random(length: number = 16): string {
		const alphabet =
			"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
		const bytes = randomBytes(length);
		let result = "";

		for (const byte of bytes) {
			result += alphabet[byte % alphabet.length];
		}

		return result;
	}

	/** A secure random password. */
	static password(length: number = 32): string {
		const alphabet = PASSWORD_CHARACTERS + PASSWORD_SYMBOLS;
		const bytes = randomBytes(length);
		let result = "";

		for (const byte of bytes) {
			result += alphabet[byte % alphabet.length];
		}

		return result;
	}

	// --- padding, masking and truncation --------------------------------------

	/** Pads the string on both sides. */
	static padBoth(value: string, length: number, pad: string = " "): string {
		return padWith(value, length, pad, "both");
	}

	/** Pads the string on the left. */
	static padLeft(value: string, length: number, pad: string = " "): string {
		return padWith(value, length, pad, "left");
	}

	/** Pads the string on the right. */
	static padRight(value: string, length: number, pad: string = " "): string {
		return padWith(value, length, pad, "right");
	}

	/** Masks a portion of the string. */
	static mask(
		value: string,
		character: string,
		index: number,
		length: number = 0,
	): string {
		const characters = [...value];
		const start = index < 0 ? characters.length + index : index;
		// No explicit length: everything from the index on is masked.
		const size = length === 0 ? characters.length - start : length;

		return [
			...characters.slice(0, start),
			...character.repeat(Math.max(size, 0)),
			...characters.slice(start + size),
		].join("");
	}

	/** Truncates the string to the given length. */
	static limit(
		value: string,
		limit: number = 100,
		end: string = "...",
		preserveWords = false,
	): string {
		if ([...value].length <= limit) {
			return value;
		}

		let truncated = [...value].slice(0, limit).join("");

		if (preserveWords) {
			const lastSpace = truncated.lastIndexOf(" ");

			truncated = lastSpace === -1 ? truncated : truncated.slice(0, lastSpace);
		}

		return truncated.trimEnd() + end;
	}

	/** An excerpt around the first occurrence of a phrase. */
	static excerpt(
		value: string,
		phrase: string,
		options: ExcerptOptions = {},
	): string {
		const radius = options.radius ?? 100;
		const omission = options.omission ?? "...";
		const index = value.indexOf(phrase);

		if (index === -1) {
			return value;
		}

		const start = Math.max(index - radius, 0);
		const end = Math.min(start + phrase.length + radius * 2, value.length);
		const prefix = start > 0 ? omission : "";
		const suffix = end < value.length ? omission : "";

		return `${prefix}${value.slice(start, end)}${suffix}`;
	}

	/** Wraps the text at the given width. */
	static wordWrap(
		value: string,
		width: number,
		separator: string = "\n",
	): string {
		const words = value.split(/\s+/u).filter((word) => word !== "");
		const lines: string[] = [];
		let line = "";

		for (const word of words) {
			if (line === "") {
				line = word;
				continue;
			}

			if ([...line].length + 1 + [...word].length <= width) {
				line += ` ${word}`;
				continue;
			}

			lines.push(line);
			line = word;
		}

		if (line !== "") {
			lines.push(line);
		}

		return lines.join(separator);
	}

	// --- pluralization --------------------------------------------------------

	/**
	 * The plural form of a word.
	 *
	 * Arabic words take the Arabic path: the shape of the noun follows the
	 * count (`Str.plural("مستخدم", 3)` → "مستخدمين"), and `prependCount`
	 * prefixes the number ("3 مستخدمين").
	 */
	static plural(
		value: string,
		count: number = 2,
		prependCount = false,
	): string {
		if (Pluralizer.isArabic(value)) {
			return prependCount
				? ArabicPlural.counted(value, count)
				: ArabicPlural.bare(value, count);
		}

		const plural = Pluralizer.plural(value);
		const singular = Pluralizer.singular(value);
		const word = count === 1 ? singular : plural;

		return prependCount ? `${formatCount(count)} ${word}` : word;
	}

	/** The plural form of a word, in `StudlyCase`. */
	static pluralStudly(
		value: string,
		count: number = 2,
		prependCount = false,
	): string {
		const plural = Pluralizer.pluralStudly(value);
		const singular = studlyCase(Pluralizer.singular(value));
		const word = count === 1 ? singular : plural;

		return prependCount ? `${formatCount(count)} ${word}` : word;
	}

	/** The singular form of a word. */
	static singular(value: string): string {
		return Pluralizer.singular(value);
	}

	/** The word, pluralized or not, prefixed with the count. */
	static counted(value: string, count: number): string {
		return Str.plural(value, count, true);
	}

	// --- markdown -------------------------------------------------------------

	/** Renders Markdown as HTML. */
	static markdown(value: string, options: MarkdownOptions = {}): string {
		return markdown(value, options);
	}

	/** Renders Markdown as inline HTML. */
	static inlineMarkdown(value: string, options: MarkdownOptions = {}): string {
		return inlineMarkdown(value, options);
	}
}

// --- internals -----------------------------------------------------------------

/** Trims a string with an explicit character list. */
function trimWith(
	value: string,
	characters: string,
	left: boolean,
	right: boolean,
): string {
	const escaped = characters.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
	const edges: string[] = [];

	if (left) {
		edges.push(`^[${escaped}]+`);
	}

	if (right) {
		edges.push(`[${escaped}]+$`);
	}

	if (edges.length === 0) {
		return value;
	}

	return value.replace(new RegExp(edges.join("|"), "gu"), "");
}

/** Pads a string to the given length. */
function padWith(
	value: string,
	length: number,
	padWith: string,
	side: "left" | "right" | "both",
): string {
	const characters = [...value];

	if (characters.length >= length) {
		return value;
	}

	if (padWith === "") {
		return value;
	}

	const filler = padWith
		.repeat(Math.ceil(length / padWith.length))
		.slice(0, length - characters.length);

	if (side === "left") {
		return filler + value;
	}

	if (side === "right") {
		return value + filler;
	}

	const left = filler.slice(0, Math.floor(filler.length / 2));
	const right = filler.slice(Math.floor(filler.length / 2));

	return left + value + right;
}

/** Formats a number with thousands separators. */
function formatCount(count: number): string {
	return count.toLocaleString("en-US");
}

/** Encodes bytes with Crockford's base32 alphabet (ULID). */
function encodeCrockford(bytes: Buffer): string {
	const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
	let value = 0n;
	let bits = 0n;
	let result = "";

	for (const byte of bytes) {
		value = (value << 8n) | BigInt(byte);
		bits += 8n;

		while (bits >= 5n) {
			bits -= 5n;
			result += alphabet[Number((value >> bits) & 31n)];
		}
	}

	if (bits > 0n) {
		result += alphabet[Number((value << (5n - bits)) & 31n)];
	}

	return result;
}

/** Escapes a string for use inside a regular expression. */
function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export { splitWords };
