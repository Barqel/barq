import { describe, expect, it } from "bun:test";
import { ArabicPlural, Pluralizer, Str } from "../src/index";

describe("ArabicPlural — the categories", () => {
	it("follows CLDR's Arabic cardinal rules", () => {
		expect(ArabicPlural.form(0)).toBe("zero");
		expect(ArabicPlural.form(1)).toBe("one");
		expect(ArabicPlural.form(2)).toBe("two");
		expect(ArabicPlural.form(3)).toBe("few");
		expect(ArabicPlural.form(10)).toBe("few");
		expect(ArabicPlural.form(11)).toBe("many");
		expect(ArabicPlural.form(99)).toBe("many");
		expect(ArabicPlural.form(100)).toBe("other");
		expect(ArabicPlural.form(102)).toBe("other");
		expect(ArabicPlural.form(103)).toBe("few");
	});

	it("counts the last two digits only", () => {
		expect(ArabicPlural.form(103)).toBe("few");
		expect(ArabicPlural.form(111)).toBe("many");
		expect(ArabicPlural.form(1_000)).toBe("other");
	});

	it("treats fractions as other", () => {
		expect(ArabicPlural.form(3.5)).toBe("other");
	});
});

describe("ArabicPlural — the forms", () => {
	it("builds the masculine forms", () => {
		const forms = ArabicPlural.forms("مستخدم");

		expect(forms.zero).toBe("مستخدم");
		expect(forms.one).toBe("مستخدم");
		expect(forms.two).toBe("مستخدمان");
		expect(forms.few).toBe("مستخدمين");
		expect(forms.many).toBe("مستخدمًا");
		expect(forms.other).toBe("مستخدم");
	});

	it("builds the feminine forms", () => {
		const forms = ArabicPlural.forms("معلمة");

		expect(forms.two).toBe("معلمتان");
		expect(forms.few).toBe("معلمات");
		expect(forms.many).toBe("معلمةً");
	});

	it("takes the gender from the noun", () => {
		expect(ArabicPlural.gender("معلمة")).toBe("feminine");
		expect(ArabicPlural.gender("مستخدم")).toBe("masculine");
	});

	it("accepts an explicit gender", () => {
		const forms = ArabicPlural.forms("أستاذ", "feminine");

		expect(forms.few).toBe("أستاذات");
	});
});

describe("ArabicPlural — the counted forms", () => {
	it("counts the noun", () => {
		expect(ArabicPlural.counted("مستخدم", 0)).toBe("0 مستخدم");
		expect(ArabicPlural.counted("مستخدم", 1)).toBe("1 مستخدم");
		expect(ArabicPlural.counted("مستخدم", 2)).toBe("2 مستخدمان");
		expect(ArabicPlural.counted("مستخدم", 3)).toBe("3 مستخدمين");
		expect(ArabicPlural.counted("مستخدم", 11)).toBe("11 مستخدمًا");
		expect(ArabicPlural.counted("مستخدم", 100)).toBe("100 مستخدم");
	});

	it("counts a feminine noun", () => {
		expect(ArabicPlural.counted("معلمة", 2)).toBe("2 معلمتان");
		expect(ArabicPlural.counted("معلمة", 3)).toBe("3 معلمات");
		expect(ArabicPlural.counted("معلمة", 11)).toBe("11 معلمةً");
	});

	it("returns the bare form", () => {
		expect(ArabicPlural.bare("مستخدم", 2)).toBe("مستخدمان");
		expect(ArabicPlural.bare("مستخدم", 3)).toBe("مستخدمين");
		expect(ArabicPlural.bare("مستخدم", 100)).toBe("مستخدم");
	});

	it("accepts a custom format", () => {
		const text = ArabicPlural.counted("مستخدم", 3, {
			format: (count, form, forms) => `${form}:${count}:${forms.few}`,
		});

		expect(text).toBe("few:3:مستخدمين");
	});
});

describe("Pluralizer — Arabic", () => {
	it("detects Arabic words", () => {
		expect(Pluralizer.isArabic("مستخدم")).toBe(true);
		expect(Pluralizer.isArabic("user")).toBe(false);
	});

	it("exposes the Arabic helpers", () => {
		expect(Pluralizer.arabicForm(3)).toBe("few");
		expect(Pluralizer.arabicForms("مستخدم").two).toBe("مستخدمان");
		expect(Pluralizer.arabic("مستخدم", 3)).toBe("3 مستخدمين");
		expect(Pluralizer.arabicBare("مستخدم", 3)).toBe("مستخدمين");
	});
});

describe("Str — Arabic plurals", () => {
	it("pluralizes an Arabic word", () => {
		expect(Str.plural("مستخدم", 1)).toBe("مستخدم");
		expect(Str.plural("مستخدم", 2)).toBe("مستخدمان");
		expect(Str.plural("مستخدم", 3)).toBe("مستخدمين");
		expect(Str.plural("مستخدم", 11)).toBe("مستخدمًا");
		expect(Str.plural("مستخدم", 100)).toBe("مستخدم");
	});

	it("prefixes the count", () => {
		expect(Str.plural("مستخدم", 3, true)).toBe("3 مستخدمين");
		expect(Str.counted("مستخدم", 11)).toBe("11 مستخدمًا");
	});

	it("keeps the English behaviour", () => {
		expect(Str.plural("car", 2)).toBe("cars");
		expect(Str.plural("car", 1)).toBe("car");
		expect(Str.counted("order", 1000)).toBe("1,000 orders");
	});
});
