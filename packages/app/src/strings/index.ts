// Strings — the `Str` helper, the fluent `Stringable` and their helpers.
//
//   import { Str, str } from "@barq";
//
//   Str.slug("Laravel 5 Framework"); // → "laravel-5-framework"
//   str("foo_bar").camel().upper();  // → "FOOBAR"

export type {
	ArabicForms,
	ArabicGender,
	ArabicPluralForm,
	ArabicPluralOptions,
} from "./arabic";
export { ArabicPlural } from "./arabic";
export { HtmlString } from "./html";
export {
	escapeHtml,
	inlineMarkdown,
	type MarkdownOptions,
	markdown,
} from "./markdown";
export { Pluralizer } from "./pluralizer";
export { type ExcerptOptions, Str } from "./str";
export { Stringable } from "./stringable";
export { ascii, transliterate } from "./transliterate";
export { Uri } from "./uri";

import { Stringable } from "./stringable";

/** A fluent, chainable string. */
export function str(value: string = ""): Stringable {
	return new Stringable(value);
}
