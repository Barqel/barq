// Pluralization — English rules, in the spirit of Laravel's pluralizer,
// plus full Arabic support (the six counted forms).
//
//   import { Pluralizer } from "@barq";
//
//   Pluralizer.plural("car");    // → "cars"
//   Pluralizer.singular("cars"); // → "car"
//   Pluralizer.plural("child");  // → "children"
//
//   Pluralizer.arabic("مستخدم", 3);       // → "3 مستخدمين"
//   Pluralizer.arabicForms("مستخدم").two; // → "مستخدمان"
//
// The rules are applied in order: irregular words first, then the
// uncountable list, then the pattern rules (first match wins). The same
// engine powers `Str::plural`, `Str::singular` and `Str::counted`.
// Arabic words take the Arabic path instead — see `ArabicPlural`.

import type {
	ArabicForms,
	ArabicGender,
	ArabicPluralForm,
	ArabicPluralOptions,
} from "./arabic";
import { ArabicPlural } from "./arabic";

export type {
	ArabicForms,
	ArabicGender,
	ArabicPluralForm,
	ArabicPluralOptions,
} from "./arabic";

/** Words whose singular and plural forms are identical. */
const UNCOUNTABLE = new Set([
	"advice",
	"aircraft",
	"bison",
	"cash",
	"chassis",
	"clothing",
	"cod",
	"deer",
	"equipment",
	"evidence",
	"fish",
	"flour",
	"furniture",
	"information",
	"jeans",
	"knowledge",
	"luggage",
	"media",
	"moose",
	"music",
	"news",
	"offspring",
	"pants",
	"police",
	"rice",
	"series",
	"sheep",
	"software",
	"species",
	"staff",
	"swine",
	"traffic",
	"weather",
]);

/** Words whose plural form does not follow the pattern rules. */
const IRREGULAR: Record<string, string> = {
	analyses: "analysis",
	antennae: "antenna",
	appendices: "appendix",
	axes: "axis",
	bacteria: "bacterium",
	cacti: "cactus",
	children: "child",
	criteria: "criterion",
	crises: "crisis",
	curricula: "curriculum",
	data: "datum",
	dice: "die",
	ephemerides: "ephemeris",
	errata: "erratum",
	feet: "foot",
	formulae: "formula",
	fungi: "fungus",
	geese: "goose",
	indices: "index",
	larvae: "larva",
	media: "medium",
	mice: "mouse",
	nebulae: "nebula",
	nuclei: "nucleus",
	octopi: "octopus",
	people: "person",
	phenomena: "phenomenon",
	radii: "radius",
	stimuli: "stimulus",
	syllabi: "syllabus",
	teeth: "tooth",
	theses: "thesis",
	vertebrae: "vertebra",
	vertices: "vertex",
	viri: "virus",
	women: "woman",
};

/** Pattern rules for the plural form — the first match wins. */
const PLURAL_RULES: Array<[RegExp, string]> = [
	[/^(ox)$/i, "$1en"],
	[/^(m|l)ouse$/i, "$1ice"],
	[/(matr|vert|ind)(?:ix|ex)$/i, "$1ices"],
	[/(x|ch|ss|sh)$/i, "$1es"],
	[/([^aeiouy]|qu)y$/i, "$1ies"],
	[/(hive)$/i, "$1s"],
	[/(?:([^f])fe|([lr])f)$/i, "$1$2ves"],
	[/sis$/i, "ses"],
	[/([ti])um$/i, "$1a"],
	[/(buffal|tomat|potat|her|ech|vet)o$/i, "$1oes"],
	[/(bu)s$/i, "$1ses"],
	[/(alias|status)$/i, "$1es"],
	[/(octop|vir)us$/i, "$1i"],
	[/(ax|test)is$/i, "$1es"],
	[/s$/i, "s"],
];

/** Pattern rules for the singular form — the first match wins. */
const SINGULAR_RULES: Array<[RegExp, string]> = [
	[/(n)ews$/i, "$1ews"],
	[/([ti])a$/i, "$1um"],
	[/((a)naly|(b)a|(d)iagno|(p)arenthe|(p)rogno|(s)ynop|(t)he)ses$/i, "$1$2sis"],
	[/([^f])ves$/i, "$1fe"],
	[/(hive)s$/i, "$1"],
	[/(tive)s$/i, "$1"],
	[/([lr])ves$/i, "$1f"],
	[/([^aeiouy]|qu)ies$/i, "$1y"],
	[/(s)eries$/i, "$1eries"],
	[/(m)ovies$/i, "$1ovie"],
	[/(x|ch|ss|sh)es$/i, "$1"],
	[/(bus)es$/i, "$1"],
	[/(o)es$/i, "$1"],
	[/(shoe)s$/i, "$1"],
	[/(cris|ax|test)es$/i, "$1is"],
	[/(octop|vir)i$/i, "$1us"],
	[/^(ox)en/i, "$1"],
	[/(vert|ind)ices$/i, "$1ex"],
	[/(matr)ices$/i, "$1ix"],
	[/(quiz)zes$/i, "$1"],
	[/s$/i, ""],
];

/** English pluralization. */
// biome-ignore lint/complexity/noStaticOnlyClass: the API is static by design
export class Pluralizer {
	/** The plural form of a word. */
	static plural(value: string): string {
		if (value === "" || Pluralizer.isUncountable(value)) {
			return value;
		}

		// Irregular words are listed as `plural → singular`, so the lookup
		// runs the other way around: the singular form gives the plural.
		for (const [plural, singular] of Object.entries(IRREGULAR)) {
			if (singular === value.toLowerCase()) {
				return matchCase(value, plural);
			}
		}

		for (const [pattern, replacement] of PLURAL_RULES) {
			if (pattern.test(value)) {
				return value.replace(pattern, replacement);
			}
		}

		// A word no rule matched simply takes an "s".
		return `${value}s`;
	}

	/** The singular form of a word. */
	static singular(value: string): string {
		if (value === "" || Pluralizer.isUncountable(value)) {
			return value;
		}

		for (const [plural, singular] of Object.entries(IRREGULAR)) {
			if (value.toLowerCase() === plural) {
				return matchCase(value, singular);
			}
		}

		for (const [pattern, replacement] of SINGULAR_RULES) {
			if (pattern.test(value)) {
				return value.replace(pattern, replacement);
			}
		}

		return value;
	}

	/** The plural form of a word, in `StudlyCase`. */
	static pluralStudly(value: string): string {
		// The last word of the studly form carries the plural: `VerifiedHuman`
		// → `Verified` + `Human` → `VerifiedHumans`.
		const parts = value.split(/(.)(?=[A-Z])/u);
		const lastWord = parts.pop() ?? "";

		return `${parts.join("")}${Pluralizer.plural(lastWord)}`;
	}

	/** True when the word has no distinct plural form. */
	static isUncountable(value: string): boolean {
		const word = value.toLowerCase().split(" ").pop() ?? "";

		return UNCOUNTABLE.has(word);
	}

	// --- Arabic ---------------------------------------------------------------

	/** True when the word is an Arabic word. */
	static isArabic(value: string): boolean {
		return ArabicPlural.isArabic(value);
	}

	/** The plural category of an Arabic count — "few", "many", … */
	static arabicForm(count: number): ArabicPluralForm {
		return ArabicPlural.form(count);
	}

	/** The grammatical gender of an Arabic noun. */
	static arabicGender(noun: string): ArabicGender {
		return ArabicPlural.gender(noun);
	}

	/** The six grammatical shapes of an Arabic noun. */
	static arabicForms(noun: string, gender?: ArabicGender): ArabicForms {
		return ArabicPlural.forms(noun, gender);
	}

	/** The counted Arabic form — "3 مستخدمين", "2 مستخدمان". */
	static arabic(
		noun: string,
		count: number,
		options?: ArabicPluralOptions,
	): string {
		return ArabicPlural.counted(noun, count, options);
	}

	/** The bare Arabic form — "مستخدمين", "مستخدمان". */
	static arabicBare(
		noun: string,
		count: number,
		gender?: ArabicGender,
	): string {
		return ArabicPlural.bare(noun, count, gender);
	}
}

/** Keeps the capitalisation of the original word in the replacement. */
function matchCase(value: string, replacement: string): string {
	if (value === value.toUpperCase() && /[A-Z]/.test(value)) {
		return replacement.toUpperCase();
	}

	if (/^[A-Z]/.test(value)) {
		return replacement.charAt(0).toUpperCase() + replacement.slice(1);
	}

	return replacement;
}
