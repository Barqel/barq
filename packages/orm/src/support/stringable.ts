// A tiny, dependency-free Stringable used by the `stringable` cast and
// accessors. Laravel's Stringable has a much larger surface; this module
// covers the operations an ORM attribute realistically needs.

/** Fluent immutable string wrapper. */
export class Stringable {
	readonly #value: string;

	constructor(value: unknown) {
		this.#value = String(value);
	}

	/** The underlying string. */
	toString(): string {
		return this.#value;
	}

	/** Explicit alias for `toString()`. */
	value(): string {
		return this.#value;
	}

	/** JSON serialization. */
	toJSON(): string {
		return this.#value;
	}

	/** Uppercase copy. */
	upper(): Stringable {
		return new Stringable(this.#value.toUpperCase());
	}

	/** Lowercase copy. */
	lower(): Stringable {
		return new Stringable(this.#value.toLowerCase());
	}

	/** Trimmed copy. */
	trim(): Stringable {
		return new Stringable(this.#value.trim());
	}

	/** Whether the string contains `needle`. */
	contains(needle: string): boolean {
		return this.#value.includes(needle);
	}

	/** Whether the string starts with `needle`. */
	startsWith(needle: string): boolean {
		return this.#value.startsWith(needle);
	}

	/** Whether the string ends with `needle`. */
	endsWith(needle: string): boolean {
		return this.#value.endsWith(needle);
	}

	/** Replaces every occurrence of `search`. */
	replace(search: string, replacement: string): Stringable {
		return new Stringable(this.#value.replaceAll(search, replacement));
	}

	/** Length of the string. */
	length(): number {
		return this.#value.length;
	}

	/** Whether the string is empty. */
	isEmpty(): boolean {
		return this.#value.length === 0;
	}

	/** Whether the string is not empty. */
	isNotEmpty(): boolean {
		return this.#value.length > 0;
	}

	/** Converts to `snake_case`. */
	snake(): Stringable {
		return new Stringable(
			this.#value
				.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
				.replace(/[\s-]+/g, "_")
				.toLowerCase(),
		);
	}

	/** Converts to `camelCase`. */
	camel(): Stringable {
		const snake = this.snake().value();
		return new Stringable(
			snake.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase()),
		);
	}

	/** Converts to `StudlyCase`. */
	studly(): Stringable {
		const camel = this.camel().value();
		return new Stringable(camel.charAt(0).toUpperCase() + camel.slice(1));
	}

	/** Converts to a URL-friendly slug. */
	slug(separator = "-"): Stringable {
		const slug = this.#value
			.normalize("NFKD")
			.replace(/[\u0300-\u036f]/g, "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, separator)
			.replace(new RegExp(`^${separator}+|${separator}+$`, "g"), "");
		return new Stringable(slug);
	}

	/** Converts to `kebab-case` (Eloquent's `kebab()`). */
	kebab(): Stringable {
		return this.snake().replace("_", "-");
	}

	/** Uppercases the first character. */
	ucfirst(): Stringable {
		return new Stringable(
			this.#value.charAt(0).toUpperCase() + this.#value.slice(1),
		);
	}

	/** Lowercases the first character. */
	lcfirst(): Stringable {
		return new Stringable(
			this.#value.charAt(0).toLowerCase() + this.#value.slice(1),
		);
	}

	/** Substring copy (`slice(start, start + length)`). */
	substr(start: number, length?: number): Stringable {
		return new Stringable(
			length === undefined
				? this.#value.slice(start)
				: this.#value.slice(start, start + length),
		);
	}

	/** Reversed copy. */
	reverse(): Stringable {
		return new Stringable([...this.#value].reverse().join(""));
	}

	/** Truncates to `width` characters, appending `end` when cut. */
	limit(width: number, end = "…"): Stringable {
		return this.#value.length <= width
			? new Stringable(this.#value)
			: new Stringable(`${this.#value.slice(0, width)}${end}`);
	}

	/** Truncates to `words` whitespace-separated words. */
	words(words: number, end = "…"): Stringable {
		const parts = this.#value.trim().split(/\s+/);
		if (parts.length <= words) return new Stringable(this.#value);
		return new Stringable(`${parts.slice(0, words).join(" ")}${end}`);
	}

	/** Repeats the string `times` times. */
	repeat(times: number): Stringable {
		return new Stringable(this.#value.repeat(Math.max(0, Math.trunc(times))));
	}

	/** Pads the start to `length` characters. */
	padLeft(length: number, character = " "): Stringable {
		return new Stringable(this.#value.padStart(length, character));
	}

	/** Pads the end to `length` characters. */
	padRight(length: number, character = " "): Stringable {
		return new Stringable(this.#value.padEnd(length, character));
	}

	/** Appends values (Eloquent's `append()`). */
	append(...values: readonly unknown[]): Stringable {
		return new Stringable(this.#value + values.map(String).join(""));
	}

	/** Prepends values (Eloquent's `prepend()`). */
	prepend(...values: readonly unknown[]): Stringable {
		return new Stringable(values.map(String).join("") + this.#value);
	}

	/** Replaces the first occurrence of `search`. */
	replaceFirst(search: string, replacement: string): Stringable {
		const index = this.#value.indexOf(search);
		if (index === -1) return new Stringable(this.#value);
		return new Stringable(
			this.#value.slice(0, index) +
				replacement +
				this.#value.slice(index + search.length),
		);
	}

	/** Replaces the last occurrence of `search`. */
	replaceLast(search: string, replacement: string): Stringable {
		const index = this.#value.lastIndexOf(search);
		if (index === -1) return new Stringable(this.#value);
		return new Stringable(
			this.#value.slice(0, index) +
				replacement +
				this.#value.slice(index + search.length),
		);
	}

	/** String after the first `needle` (`null` when absent). */
	after(needle: string): Stringable {
		const index = this.#value.indexOf(needle);
		return new Stringable(
			index === -1 ? this.#value : this.#value.slice(index + needle.length),
		);
	}

	/** String before the first `needle` (`null`-safe: keeps the value). */
	before(needle: string): Stringable {
		const index = this.#value.indexOf(needle);
		return new Stringable(
			index === -1 ? this.#value : this.#value.slice(0, index),
		);
	}

	/** Substring between `from` and `to`. */
	between(from: string, to: string): Stringable {
		const start = this.#value.indexOf(from);
		if (start === -1) return new Stringable("");
		const rest = this.#value.slice(start + from.length);
		const end = rest.indexOf(to);
		return new Stringable(end === -1 ? rest : rest.slice(0, end));
	}

	/** Whether the string matches a simple `*` glob pattern. */
	is(pattern: string): boolean {
		const escaped = pattern
			.replace(/[.+^${}()|[\]\\]/g, "\\$&")
			.replace(/\*/g, ".*");
		return new RegExp(`^${escaped}$`).test(this.#value);
	}

	/** Whether the string matches a JavaScript regular expression. */
	test(pattern: RegExp): boolean {
		return pattern.test(this.#value);
	}

	/** Number of words. */
	wordCount(): number {
		const trimmed = this.#value.trim();
		return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
	}
}
