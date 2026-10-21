// Case conversions — the building blocks behind `Str::studly`, `Str::camel`,
// `Str::snake`, `Str::kebab`, `Str::headline`, `Str::title` and `Str::apa`.
//
// They live in their own module so the pluralizer (which needs `studly`) and
// the string classes share one implementation.
const APOSTROPHE = "'";

/** Uppercases the first character, leaves the rest untouched. */
export function ucfirst(value: string): string {
	if (value === "") {
		return value;
	}

	return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Lowercases the first character, leaves the rest untouched. */
export function lcfirst(value: string): string {
	if (value === "") {
		return value;
	}

	return value.charAt(0).toLowerCase() + value.slice(1);
}

/** Uppercases the first character of every word. */
export function ucwords(
	value: string,
	delimiters: string = " \t\r\n\f\v",
): string {
	return value.replace(
		new RegExp(
			`(^|[${escapeForCharacterClass(delimiters)}])([^${escapeForCharacterClass(delimiters)}])`,
			"g",
		),
		(_match, prefix: string, character: string) =>
			prefix + character.toUpperCase(),
	);
}

/** `foo_bar` / `foo-bar` → `FooBar`. */
export function studly(value: string): string {
	return value
		.split(/[\s\-_]+/u)
		.filter((word) => word !== "")
		.map((word) => ucfirst(word))
		.join("");
}

/** `foo_bar` → `fooBar`. */
export function camel(value: string): string {
	return lcfirst(studly(value));
}

/** `fooBar` / `Foo Bar` → `foo_bar`. */
export function snake(value: string, delimiter: string = "_"): string {
	if (/^[a-z]+$/u.test(value)) {
		return value;
	}

	const words = ucwords(value).replace(/\s+/gu, "");

	return words.replace(/(.)(?=[A-Z])/gu, `$1${delimiter}`).toLowerCase();
}

/** `fooBar` → `foo-bar`. */
export function kebab(value: string): string {
	return snake(value, "-");
}

/**
 * Splits a value into words — on spaces, dashes, underscores and case
 * boundaries (`EmailNotificationSent` → `Email`, `Notification`, `Sent`).
 */
export function words(value: string): string[] {
	return value
		.replace(/([a-z\d])([A-Z])/gu, "$1 $2")
		.replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2")
		.split(/[\s\-_]+/u)
		.filter((word) => word !== "");
}

/** `steve_jobs` → `Steve Jobs`, `EmailNotificationSent` → `Email Notification Sent`. */
export function headline(value: string): string {
	return words(value)
		.map((word) => ucfirst(word))
		.join(" ");
}

/** `a nice title` → `A Nice Title`. */
export function title(value: string): string {
	return value
		.split(/\s+/u)
		.filter((word) => word !== "")
		.map((word) => ucfirst(word.toLowerCase()))
		.join(" ");
}

/** Words APA keeps lowercase (unless they open or close the title). */
const APA_MINOR_WORDS = new Set([
	"a",
	"an",
	"and",
	"as",
	"at",
	"but",
	"by",
	"for",
	"if",
	"in",
	"nor",
	"of",
	"on",
	"or",
	"per",
	"so",
	"the",
	"to",
	"v",
	"v.",
]);

/** `Creating A Project` → `Creating a Project` (APA title case). */
export function apa(value: string): string {
	const parts = value.split(/\s+/u).filter((part) => part !== "");

	if (parts.length === 0) {
		return value;
	}

	return parts
		.map((part, index) => {
			const isEdge = index === 0 || index === parts.length - 1;
			const lower = part.toLowerCase();

			if (!isEdge && APA_MINOR_WORDS.has(lower)) {
				return lower;
			}

			return ucfirst(lower);
		})
		.join(" ");
}

/** Escapes the characters that would break a character class. */
export function escapeForCharacterClass(value: string): string {
	return value.replace(/[\\\]^-]/gu, "\\$&");
}

/** Re-exported for the pluralizer, which needs the apostrophe-safe form. */
export { APOSTROPHE };
