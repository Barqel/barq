// Regular-expression patterns, in the Laravel style: `/source/modifiers`.
//
// The delimiters are optional — a bare pattern is used as it is — and the
// PCRE-only possessive quantifiers (`++`, `*+`, `?+`) are downgraded to
// their greedy counterparts, because JavaScript does not support them.

/** A pattern split into its source and its modifiers. */
export interface ParsedPattern {
	/** The regular-expression source. */
	source: string;
	/** The modifiers — `i`, `m`, `s`, `u`, `y`. */
	modifiers: string;
}

/** A delimited pattern — `/source/modifiers`. */
const DELIMITED = /^\/(.+)\/([a-z]*)$/isu;

/** The modifiers JavaScript understands. */
const SUPPORTED_FLAGS = "dgimsuvy";

/** Splits a pattern into its source and its modifiers. */
export function parsePattern(pattern: string): ParsedPattern {
	const match = DELIMITED.exec(pattern);

	if (match === null) {
		return { source: pattern, modifiers: "" };
	}

	return { source: match[1] ?? "", modifiers: match[2] ?? "" };
}

/** Compiles a Laravel-style pattern into a regular expression. */
export function toRegExp(pattern: string, flags = ""): RegExp {
	const { source, modifiers } = parsePattern(pattern);
	const used = new Set(
		[...flags, ...modifiers].filter((flag) => SUPPORTED_FLAGS.includes(flag)),
	);

	return new RegExp(downgrade(source), [...used].join(""));
}

/** Replaces the possessive quantifiers JavaScript does not support. */
function downgrade(source: string): string {
	return source.replace(/([*+?])\+/gu, "$1");
}
