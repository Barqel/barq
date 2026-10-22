// Arabic pluralization — the six forms of the counted noun.
//
//   import { ArabicPlural } from "@barq";
//
//   ArabicPlural.form(3);             // → "few"
//   ArabicPlural.counted("مستخدم", 3); // → "3 مستخدمين"
//   ArabicPlural.bare("مستخدم", 2);    // → "مستخدمان"
//
// Arabic counts the noun, not just the number: a counted noun changes shape
// with the count (the "معدود" construction).
//
// | Count   | Form      | Masc.        | Fem.        |
// | ------- | --------- | ------------ | ----------- |
// | 0       | zero      | مستخدم       | معلمة       |
// | 1       | one       | مستخدم       | معلمة       |
// | 2       | two       | مستخدمان     | معلمتان     |
// | 3 – 10  | few       | مستخدمين     | مستخدمات     |
// | 11 – 99 | many      | مستخدمًا     | معلمةً       |
// | 100 +   | other     | مستخدم       | معلمة       |
//
// The category rules are CLDR's (Arabic cardinals): `n % 100` decides between
// "few" (3–10) and "many" (11–99). The gender is inferred from the noun —
// a word ending in "ة" is feminine — and can be set explicitly.

/** The six plural categories of Arabic. */
export type ArabicPluralForm =
	| "zero"
	| "one"
	| "two"
	| "few"
	| "many"
	| "other";

/** The grammatical gender of a noun. */
export type ArabicGender = "masculine" | "feminine";

/** The six grammatical shapes of a noun. */
export interface ArabicForms {
	/** 0 — the nominative singular. */
	zero: string;
	/** 1 — the nominative singular. */
	one: string;
	/** 2 — the dual. */
	two: string;
	/** 3–10 — the broken plural. */
	few: string;
	/** 11–99 — the singular in the accusative. */
	many: string;
	/** 100+ — the nominative singular. */
	other: string;
}

/** Options accepted by the Arabic helpers. */
export interface ArabicPluralOptions {
	/** The gender of the noun — inferred from it when omitted. */
	gender?: ArabicGender;
	/** Builds the counted form — `"{count} {noun}"` by default. */
	format?: (
		count: number,
		form: ArabicPluralForm,
		forms: ArabicForms,
	) => string;
}

/** Arabic letters — the block used to detect an Arabic word. */
const ARABIC_BLOCK = /[\u0600-\u06FF]/u;

/** "ة" — the ta marbuta, the feminine ending. */
const TA_MARBUTA = "\u0629";

/** "ً" — the fathatan (tanween). */
const FATHA_TANWEEN = "\u064B";

/** Arabic pluralization. */
// biome-ignore lint/complexity/noStaticOnlyClass: the API is static by design
export class ArabicPlural {
	/** True when the value contains Arabic letters. */
	static isArabic(value: string): boolean {
		return ARABIC_BLOCK.test(value);
	}

	/** The plural category of a count — CLDR's Arabic cardinal rules. */
	static form(count: number): ArabicPluralForm {
		if (!Number.isInteger(count)) {
			return "other";
		}

		const absolute = Math.abs(count);

		if (absolute === 0) {
			return "zero";
		}

		if (absolute === 1) {
			return "one";
		}

		if (absolute === 2) {
			return "two";
		}

		const mod = absolute % 100;

		if (mod >= 3 && mod <= 10) {
			return "few";
		}

		if (mod >= 11 && mod <= 99) {
			return "many";
		}

		return "other";
	}

	/** The gender of a noun — feminine when it ends with "ة". */
	static gender(noun: string): ArabicGender {
		return noun.endsWith(TA_MARBUTA) ? "feminine" : "masculine";
	}

	/** The six grammatical shapes of a noun. */
	static forms(noun: string, gender?: ArabicGender): ArabicForms {
		const resolved = gender ?? ArabicPlural.gender(noun);
		const feminine = resolved === "feminine";
		const stem =
			feminine && noun.endsWith(TA_MARBUTA) ? noun.slice(0, -1) : noun;

		return {
			zero: noun,
			one: noun,
			// المثنى — "مستخدمان" / "معلمتان"
			two: feminine ? `${stem}تان` : `${noun}ان`,
			// جمع قلة — "مستخدمين" / "مستخدمات"
			few: feminine ? `${stem}ات` : `${noun}ين`,
			// جمع كثرة — the singular in the accusative — "مستخدمًا" / "معلمةً"
			many: feminine
				? `${noun}${FATHA_TANWEEN}`
				: `${noun}${FATHA_TANWEEN}\u0627`,
			other: noun,
		};
	}

	/** The counted form — "3 مستخدمين", "2 مستخدمان", "11 مستخدمًا". */
	static counted(
		noun: string,
		count: number,
		options: ArabicPluralOptions = {},
	): string {
		const form = ArabicPlural.form(count);
		const forms = ArabicPlural.forms(noun, options.gender);

		if (options.format) {
			return options.format(count, form, forms);
		}

		return `${count} ${forms[form]}`;
	}

	/** The bare form — "مستخدمين", "مستخدمان", "مستخدمًا". */
	static bare(noun: string, count: number, gender?: ArabicGender): string {
		const form = ArabicPlural.form(count);
		const forms = ArabicPlural.forms(noun, gender);

		return forms[form];
	}
}
