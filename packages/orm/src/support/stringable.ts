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
}
