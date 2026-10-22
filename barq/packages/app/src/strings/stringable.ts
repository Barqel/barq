// Fluent strings — the chainable counterpart of `Str`.
//
//   import { Str } from "@barq";
//
//   Str.of("foo_bar").camel().upper();  // → "FOOBAR"
//   Str.of("  laravel  ").trim().squish(); // → "laravel"
//
// Every method returns a new instance — the string is never mutated.
import { createHash } from "node:crypto";
import { Crypt } from "../security/crypt";
import { type Collection, collect } from "../vendor";
import { HtmlString } from "./html";
import type { MarkdownOptions } from "./markdown";
import { toRegExp } from "./pattern";
import { type ExcerptOptions, Str } from "./str";
import { Uri } from "./uri";

/** A chainable string. */
export class Stringable {
	private value: string;

	constructor(value: string) {
		this.value = value;
	}

	/** The wrapped string. */
	toString(): string {
		return this.value;
	}

	/** The wrapped string. */
	valueOf(): string {
		return this.value;
	}

	/** The wrapped string. */
	toJSON(): string {
		return this.value;
	}

	// --- chaining -------------------------------------------------------------

	/** Appends values to the string. */
	append(...values: string[]): Stringable {
		return new Stringable(this.value + values.join(""));
	}

	/** Prepends values to the string. */
	prepend(...values: string[]): Stringable {
		return new Stringable(values.join("") + this.value);
	}

	/** Appends an end-of-line character. */
	newLine(): Stringable {
		return this.append("\n");
	}

	/** Passes the string to a callback, then returns the string unchanged. */
	tap(callback: (value: Stringable) => void): Stringable {
		callback(this);

		return this;
	}

	/** Transforms the string through a callback (or a method name). */
	pipe(
		callback: string | ((value: Stringable) => unknown),
	): Stringable | unknown {
		if (typeof callback === "string") {
			const method = (this as unknown as Record<string, unknown>)[callback];

			if (typeof method !== "function") {
				throw new TypeError(`Stringable has no method "${callback}".`);
			}

			return (method as (value: Stringable) => unknown).call(this, this);
		}

		return callback(this);
	}

	/** Invokes a callback when the condition holds. */
	when(
		condition: boolean,
		callback: (value: Stringable) => Stringable | void,
		defaultCallback?: (value: Stringable) => Stringable | void,
	): Stringable {
		if (condition) {
			const result = callback(this);

			return result ?? this;
		}

		if (defaultCallback) {
			const result = defaultCallback(this);

			return result ?? this;
		}

		return this;
	}

	// --- slicing --------------------------------------------------------------

	/** Everything after the first occurrence of `search`. */
	after(search: string): Stringable {
		return new Stringable(Str.after(this.value, search));
	}

	/** Everything after the last occurrence of `search`. */
	afterLast(search: string): Stringable {
		return new Stringable(Str.afterLast(this.value, search));
	}

	/** Everything before the first occurrence of `search`. */
	before(search: string): Stringable {
		return new Stringable(Str.before(this.value, search));
	}

	/** Everything before the last occurrence of `search`. */
	beforeLast(search: string): Stringable {
		return new Stringable(Str.beforeLast(this.value, search));
	}

	/** The portion between two values. */
	between(from: string, to: string): Stringable {
		return new Stringable(Str.between(this.value, from, to));
	}

	/** The smallest portion between two values. */
	betweenFirst(from: string, to: string): Stringable {
		return new Stringable(Str.betweenFirst(this.value, from, to));
	}

	/** The character at `index`. */
	charAt(index: number): Stringable {
		return new Stringable(Str.charAt(this.value, index) ?? "");
	}

	/** The first `length` characters. */
	take(length: number): Stringable {
		return new Stringable(Str.take(this.value, length));
	}

	/** The portion of the string, like `substr`. */
	substr(start: number, length?: number): Stringable {
		return new Stringable(Str.substr(this.value, start, length));
	}

	/** Replaces text inside a portion of the string. */
	substrReplace(replace: string, offset: number, length?: number): Stringable {
		return new Stringable(
			Str.substrReplace(this.value, replace, offset, length),
		);
	}

	/** The trailing name component of a path. */
	basename(suffix?: string): Stringable {
		const parts = this.value.split(/[/\\]/u);
		let name = parts[parts.length - 1] ?? "";

		if (suffix !== undefined && name.endsWith(suffix)) {
			name = name.slice(0, name.length - suffix.length);
		}

		return new Stringable(name);
	}

	/** The parent directory of a path. */
	dirname(levels: number = 1): Stringable {
		const parts = this.value.split(/[/\\]/u);

		if (parts.length <= 1) {
			return new Stringable(".");
		}

		return new Stringable(parts.slice(0, parts.length - levels).join("/"));
	}

	// --- searching ------------------------------------------------------------

	/** True when the string contains any of the needles. */
	contains(needles: string | string[], ignoreCase = false): boolean {
		return Str.contains(this.value, needles, ignoreCase);
	}

	/** True when the string contains every needle. */
	containsAll(needles: string | string[], ignoreCase = false): boolean {
		return Str.containsAll(this.value, needles, ignoreCase);
	}

	/** True when the string contains none of the needles. */
	doesntContain(needles: string | string[], ignoreCase = false): boolean {
		return Str.doesntContain(this.value, needles, ignoreCase);
	}

	/** True when the string starts with one of the needles. */
	startsWith(needles: string | string[]): boolean {
		return Str.startsWith(this.value, needles);
	}

	/** True when the string starts with none of the needles. */
	doesntStartWith(needles: string | string[]): boolean {
		return Str.doesntStartWith(this.value, needles);
	}

	/** True when the string ends with one of the needles. */
	endsWith(needles: string | string[]): boolean {
		return Str.endsWith(this.value, needles);
	}

	/** True when the string ends with none of the needles. */
	doesntEndWith(needles: string | string[]): boolean {
		return Str.doesntEndWith(this.value, needles);
	}

	/** True when the string matches a `*` wildcard pattern. */
	is(pattern: string, ignoreCase = false): boolean {
		return Str.is(pattern, this.value, ignoreCase);
	}

	/** True when the string matches a regular expression. */
	isMatch(pattern: string): boolean {
		return Str.isMatch(pattern, this.value);
	}

	/** True when the string matches a regular expression. */
	test(pattern: string): boolean {
		return Str.isMatch(pattern, this.value);
	}

	/** The portion of the string matching a regular expression. */
	match(pattern: string): Stringable {
		return new Stringable(Str.match(pattern, this.value) ?? "");
	}

	/** Every portion of the string matching a regular expression. */
	matchAll(pattern: string): Collection<string> {
		return Str.matchAll(pattern, this.value);
	}

	/** The position of the first occurrence of `needle`. */
	position(needle: string): number | null {
		return Str.position(this.value, needle);
	}

	/** True when the string is exactly another string. */
	exactly(value: string): boolean {
		return this.value === value;
	}

	/** True when the string is empty. */
	isEmpty(): boolean {
		return this.value === "";
	}

	/** True when the string is not empty. */
	isNotEmpty(): boolean {
		return this.value !== "";
	}

	// --- replacing ------------------------------------------------------------

	/** Replaces a value in the string. */
	replace(
		search: string | string[],
		replace: string,
		caseSensitive = true,
	): Stringable {
		return new Stringable(
			Str.replace(this.value, search, replace, caseSensitive),
		);
	}

	/** Replaces the first occurrence of a value. */
	replaceFirst(search: string, replace: string): Stringable {
		return new Stringable(Str.replaceFirst(search, replace, this.value));
	}

	/** Replaces the last occurrence of a value. */
	replaceLast(search: string, replace: string): Stringable {
		return new Stringable(Str.replaceLast(search, replace, this.value));
	}

	/** Replaces every occurrence of a value with the next one in the list. */
	replaceArray(search: string, replace: string[]): Stringable {
		return new Stringable(Str.replaceArray(search, replace, this.value));
	}

	/** Replaces the first occurrence of a value, only at the start. */
	replaceStart(search: string, replace: string): Stringable {
		return new Stringable(Str.replaceStart(search, replace, this.value));
	}

	/** Replaces the last occurrence of a value, only at the end. */
	replaceEnd(search: string, replace: string): Stringable {
		return new Stringable(Str.replaceEnd(search, replace, this.value));
	}

	/** Replaces every portion matching a regular expression. */
	replaceMatches(
		pattern: string,
		replace: string | ((matches: RegExpMatchArray) => string),
	): Stringable {
		return new Stringable(Str.replaceMatches(pattern, replace, this.value));
	}

	/** Removes values from the string. */
	remove(search: string | string[], ignoreCase = false): Stringable {
		return new Stringable(Str.remove(this.value, search, ignoreCase));
	}

	/** Replaces several values at once. */
	swap(replacements: Record<string, string>): Stringable {
		return new Stringable(Str.swap(replacements, this.value));
	}

	/** Repeats the string. */
	repeat(times: number): Stringable {
		return new Stringable(Str.repeat(this.value, times));
	}

	/** Removes a prefix, only when the string starts with it. */
	chopStart(chop: string | string[]): Stringable {
		return new Stringable(Str.chopStart(this.value, chop));
	}

	/** Removes a suffix, only when the string ends with it. */
	chopEnd(chop: string | string[]): Stringable {
		return new Stringable(Str.chopEnd(this.value, chop));
	}

	/** Splits the string by a delimiter. */
	explode(delimiter: string): Collection<string> {
		return collect(this.value.split(delimiter));
	}

	/** Splits the string with a regular expression. */
	split(pattern: string): Collection<string> {
		return collect(this.value.split(toRegExp(pattern, "gu")).filter(Boolean));
	}

	/** Parses the string according to an `sscanf`-like format. */
	scan(format: string): Collection<string> {
		return collect(scanFormat(format, this.value));
	}

	// --- trimming -------------------------------------------------------------

	/** Removes whitespace from both ends. */
	trim(characters?: string): Stringable {
		return new Stringable(Str.trim(this.value, characters));
	}

	/** Removes whitespace from the start. */
	ltrim(characters?: string): Stringable {
		return new Stringable(Str.ltrim(this.value, characters));
	}

	/** Removes whitespace from the end. */
	rtrim(characters?: string): Stringable {
		return new Stringable(Str.rtrim(this.value, characters));
	}

	/** Removes the given strings from both ends. */
	unwrap(before: string, after: string = before): Stringable {
		return new Stringable(Str.unwrap(this.value, before, after));
	}

	/** Wraps the string with another string. */
	wrap(before: string, after: string = before): Stringable {
		return new Stringable(Str.wrap(this.value, before, after));
	}

	/** Adds a prefix, when the string does not already have it. */
	start(prefix: string): Stringable {
		return new Stringable(Str.start(this.value, prefix));
	}

	/** Adds a suffix, when the string does not already have it. */
	finish(suffix: string): Stringable {
		return new Stringable(Str.finish(this.value, suffix));
	}

	/** Removes the whitespace between words. */
	squish(): Stringable {
		return new Stringable(Str.squish(this.value));
	}

	/** Replaces consecutive characters with a single one. */
	deduplicate(character: string = " "): Stringable {
		return new Stringable(Str.deduplicate(this.value, character));
	}

	/** Removes the HTML and PHP tags from the string. */
	stripTags(allowedTags: string[] = []): Stringable {
		const allowed = allowedTags.join("|");
		const pattern =
			allowed === ""
				? /<\/?[^>]+>/gu
				: new RegExp(`<(?!\\/?(?:${allowed})\\b)[^>]*>`, "giu");

		return new Stringable(this.value.replace(pattern, ""));
	}

	// --- case -----------------------------------------------------------------

	/** Lowercases the string. */
	lower(): Stringable {
		return new Stringable(Str.lower(this.value));
	}

	/** Uppercases the string. */
	upper(): Stringable {
		return new Stringable(Str.upper(this.value));
	}

	/** Uppercases the first character. */
	ucfirst(): Stringable {
		return new Stringable(Str.ucfirst(this.value));
	}

	/** Lowercases the first character. */
	lcfirst(): Stringable {
		return new Stringable(Str.lcfirst(this.value));
	}

	/** Uppercases the first character of every word. */
	ucwords(delimiters?: string): Stringable {
		return new Stringable(Str.ucwords(this.value, delimiters));
	}

	/** Splits the string on uppercase characters. */
	ucsplit(): Collection<string> {
		return collect(Str.ucsplit(this.value));
	}

	/** `foo_bar` → `FooBar`. */
	studly(): Stringable {
		return new Stringable(Str.studly(this.value));
	}

	/** `foo_bar` → `fooBar`. */
	camel(): Stringable {
		return new Stringable(Str.camel(this.value));
	}

	/** `fooBar` → `foo_bar`. */
	snake(delimiter: string = "_"): Stringable {
		return new Stringable(Str.snake(this.value, delimiter));
	}

	/** `fooBar` → `foo-bar`. */
	kebab(): Stringable {
		return new Stringable(Str.kebab(this.value));
	}

	/** `steve_jobs` → `Steve Jobs`. */
	headline(): Stringable {
		return new Stringable(Str.headline(this.value));
	}

	/** `a nice title` → `A Nice Title`. */
	title(): Stringable {
		return new Stringable(Str.title(this.value));
	}

	/** APA title case. */
	apa(): Stringable {
		return new Stringable(Str.apa(this.value));
	}

	/** The class name, without its namespace. */
	classBasename(): Stringable {
		return new Stringable(Str.classBasename(this.value));
	}

	// --- measures -------------------------------------------------------------

	/** The number of characters. */
	length(): number {
		return Str.length(this.value);
	}

	/** The number of words. */
	wordCount(): number {
		return Str.wordCount(this.value);
	}

	/** The first `count` words. */
	words(count: number, end: string = "..."): Stringable {
		return new Stringable(Str.words(this.value, count, end));
	}

	/** Truncates the string to the given length. */
	limit(
		limit: number = 100,
		end: string = "...",
		preserveWords = false,
	): Stringable {
		return new Stringable(Str.limit(this.value, limit, end, preserveWords));
	}

	/** An excerpt around the first occurrence of a phrase. */
	excerpt(phrase: string, options: ExcerptOptions = {}): Stringable {
		return new Stringable(Str.excerpt(this.value, phrase, options));
	}

	/** Masks a portion of the string. */
	mask(character: string, index: number, length: number = 0): Stringable {
		return new Stringable(Str.mask(this.value, character, index, length));
	}

	/** Pads the string on both sides. */
	padBoth(length: number, pad: string = " "): Stringable {
		return new Stringable(Str.padBoth(this.value, length, pad));
	}

	/** Pads the string on the left. */
	padLeft(length: number, pad: string = " "): Stringable {
		return new Stringable(Str.padLeft(this.value, length, pad));
	}

	/** Pads the string on the right. */
	padRight(length: number, pad: string = " "): Stringable {
		return new Stringable(Str.padRight(this.value, length, pad));
	}

	/** Wraps the text at the given width. */
	wordWrap(width: number, separator: string = "\n"): Stringable {
		return new Stringable(Str.wordWrap(this.value, width, separator));
	}

	// --- pluralization --------------------------------------------------------

	/** The plural form of the word. */
	plural(count: number = 2, prependCount = false): Stringable {
		return new Stringable(Str.plural(this.value, count, prependCount));
	}

	/** The singular form of the word. */
	singular(): Stringable {
		return new Stringable(Str.singular(this.value));
	}

	/** The word, pluralized or not, prefixed with the count. */
	counted(count: number): Stringable {
		return new Stringable(Str.counted(this.value, count));
	}

	// --- checks ---------------------------------------------------------------

	/** True when the string is 7-bit ASCII. */
	isAscii(): boolean {
		return Str.isAscii(this.value);
	}

	/** True when the string is valid JSON. */
	isJson(): boolean {
		return Str.isJson(this.value);
	}

	/** True when the string is a valid URL. */
	isUrl(protocols: string[] = []): boolean {
		return Str.isUrl(this.value, protocols);
	}

	/** True when the string is a valid UUID. */
	isUuid(version?: number): boolean {
		return Str.isUuid(this.value, version);
	}

	/** True when the string is a valid ULID. */
	isUlid(): boolean {
		return Str.isUlid(this.value);
	}

	// --- encodings ------------------------------------------------------------

	/** The base64 representation of the string. */
	toBase64(): Stringable {
		return new Stringable(Str.toBase64(this.value));
	}

	/** Decodes a base64 string. */
	fromBase64(): Stringable {
		return new Stringable(Str.fromBase64(this.value));
	}

	/** The closest ASCII representation of the string. */
	ascii(): Stringable {
		return new Stringable(Str.ascii(this.value));
	}

	/** The closest ASCII representation of the string. */
	transliterate(): Stringable {
		return new Stringable(Str.transliterate(this.value));
	}

	/** The HTML-escaped string. */
	escapeHtml(): Stringable {
		return new Stringable(Str.escapeHtml(this.value));
	}

	/** The hash of the string, with the given algorithm. */
	hash(algorithm: string = "sha256"): string {
		return createHash(algorithm).update(this.value, "utf8").digest("hex");
	}

	/** The encrypted string. */
	encrypt(): Stringable {
		return new Stringable(Crypt.encryptString(this.value));
	}

	/** The decrypted string. */
	decrypt(): Stringable {
		return new Stringable(Crypt.decryptString(this.value));
	}

	/** The string as an HTML value — never escaped when rendered. */
	toHtmlString(): HtmlString {
		return new HtmlString(this.value);
	}

	/** The string as a parsed URI. */
	toUri(): Uri {
		return new Uri(this.value);
	}

	// --- markdown -------------------------------------------------------------

	/** Renders Markdown as HTML. */
	markdown(options: MarkdownOptions = {}): Stringable {
		return new Stringable(Str.markdown(this.value, options));
	}

	/** Renders Markdown as inline HTML. */
	inlineMarkdown(options: MarkdownOptions = {}): Stringable {
		return new Stringable(Str.inlineMarkdown(this.value, options));
	}

	// --- conditional helpers --------------------------------------------------

	/** Invokes the callback when the string contains the value. */
	whenContains(
		needles: string | string[],
		callback: (value: Stringable) => Stringable | void,
		defaultCallback?: (value: Stringable) => Stringable | void,
	): Stringable {
		return this.when(
			Str.contains(this.value, needles),
			callback,
			defaultCallback,
		);
	}

	/** Invokes the callback when the string contains every value. */
	whenContainsAll(
		needles: string | string[],
		callback: (value: Stringable) => Stringable | void,
		defaultCallback?: (value: Stringable) => Stringable | void,
	): Stringable {
		return this.when(
			Str.containsAll(this.value, needles),
			callback,
			defaultCallback,
		);
	}

	/** Invokes the callback when the string does not end with the value. */
	whenDoesntEndWith(
		needles: string | string[],
		callback: (value: Stringable) => Stringable | void,
		defaultCallback?: (value: Stringable) => Stringable | void,
	): Stringable {
		return this.when(
			Str.doesntEndWith(this.value, needles),
			callback,
			defaultCallback,
		);
	}

	/** Invokes the callback when the string does not start with the value. */
	whenDoesntStartWith(
		needles: string | string[],
		callback: (value: Stringable) => Stringable | void,
		defaultCallback?: (value: Stringable) => Stringable | void,
	): Stringable {
		return this.when(
			Str.doesntStartWith(this.value, needles),
			callback,
			defaultCallback,
		);
	}

	/** Invokes the callback when the string is empty. */
	whenEmpty(
		callback: (value: Stringable) => Stringable | void,
		defaultCallback?: (value: Stringable) => Stringable | void,
	): Stringable {
		return this.when(this.value === "", callback, defaultCallback);
	}

	/** Invokes the callback when the string is not empty. */
	whenNotEmpty(
		callback: (value: Stringable) => Stringable | void,
		defaultCallback?: (value: Stringable) => Stringable | void,
	): Stringable {
		return this.when(this.value !== "", callback, defaultCallback);
	}

	/** Invokes the callback when the string starts with the value. */
	whenStartsWith(
		needles: string | string[],
		callback: (value: Stringable) => Stringable | void,
		defaultCallback?: (value: Stringable) => Stringable | void,
	): Stringable {
		return this.when(
			Str.startsWith(this.value, needles),
			callback,
			defaultCallback,
		);
	}

	/** Invokes the callback when the string ends with the value. */
	whenEndsWith(
		needles: string | string[],
		callback: (value: Stringable) => Stringable | void,
		defaultCallback?: (value: Stringable) => Stringable | void,
	): Stringable {
		return this.when(
			Str.endsWith(this.value, needles),
			callback,
			defaultCallback,
		);
	}

	/** Invokes the callback when the string exactly matches the value. */
	whenExactly(
		value: string,
		callback: (value: Stringable) => Stringable | void,
		defaultCallback?: (value: Stringable) => Stringable | void,
	): Stringable {
		return this.when(this.value === value, callback, defaultCallback);
	}

	/** Invokes the callback when the string does not exactly match the value. */
	whenNotExactly(
		value: string,
		callback: (value: Stringable) => Stringable | void,
		defaultCallback?: (value: Stringable) => Stringable | void,
	): Stringable {
		return this.when(this.value !== value, callback, defaultCallback);
	}

	/** Invokes the callback when the string matches a wildcard pattern. */
	whenIs(
		pattern: string,
		callback: (value: Stringable) => Stringable | void,
		defaultCallback?: (value: Stringable) => Stringable | void,
	): Stringable {
		return this.when(Str.is(pattern, this.value), callback, defaultCallback);
	}

	/** Invokes the callback when the string is ASCII. */
	whenIsAscii(
		callback: (value: Stringable) => Stringable | void,
		defaultCallback?: (value: Stringable) => Stringable | void,
	): Stringable {
		return this.when(Str.isAscii(this.value), callback, defaultCallback);
	}

	/** Invokes the callback when the string is a ULID. */
	whenIsUlid(
		callback: (value: Stringable) => Stringable | void,
		defaultCallback?: (value: Stringable) => Stringable | void,
	): Stringable {
		return this.when(Str.isUlid(this.value), callback, defaultCallback);
	}

	/** Invokes the callback when the string is a UUID. */
	whenIsUuid(
		callback: (value: Stringable) => Stringable | void,
		defaultCallback?: (value: Stringable) => Stringable | void,
	): Stringable {
		return this.when(Str.isUuid(this.value), callback, defaultCallback);
	}

	/** Invokes the callback when the string matches a regular expression. */
	whenTest(
		pattern: string,
		callback: (value: Stringable) => Stringable | void,
		defaultCallback?: (value: Stringable) => Stringable | void,
	): Stringable {
		return this.when(
			Str.isMatch(pattern, this.value),
			callback,
			defaultCallback,
		);
	}
}

/**
 * Parses a string with an `sscanf`-like format.
 *
 * Supports `%s`, `%d`, `%x` and `%[^x]` — enough for the usual cases.
 */
function scanFormat(format: string, value: string): string[] {
	const pattern = format
		.replace(/%\[([^\]])\]/gu, "([^$1]*)")
		.replace(/%s/gu, "(\\S+)")
		.replace(/%d/gu, "(-?\\d+)")
		.replace(/%x/gu, "([0-9a-fA-F]+)")
		.replace(/%/gu, "%");
	const match = new RegExp(`^${pattern}$`, "u").exec(value);

	if (match === null) {
		return [];
	}

	return match.slice(1).map((group) => group ?? "");
}
