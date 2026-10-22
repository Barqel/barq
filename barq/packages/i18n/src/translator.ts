import type { TranslationDictionary, TranslationsRecord } from "./types";

function resolveNestedKey(
	obj: TranslationDictionary,
	path: string,
): string | null {
	const parts = path.split(".");
	let current: any = obj;

	for (const part of parts) {
		if (current === null || typeof current !== "object") return null;
		current = current[part];
	}

	return typeof current === "string" ? current : null;
}

function interpolate(
	template: string,
	params?: Record<string, string | number>,
): string {
	if (!params) return template;
	return template.replace(/\{(\w+)\}/g, (_, key) => {
		return key in params ? String(params[key]) : `{${key}}`;
	});
}

export function createTranslator(
	translations: TranslationsRecord,
	currentLocale: string,
	defaultLocale: string,
) {
	const currentDict =
		translations[currentLocale] ??
		translations[currentLocale.toLowerCase()] ??
		{};
	const defaultDict =
		translations[defaultLocale] ??
		translations[defaultLocale.toLowerCase()] ??
		{};

	return (key: string, params?: Record<string, string | number>): string => {
		const raw =
			resolveNestedKey(currentDict, key) ?? resolveNestedKey(defaultDict, key);
		if (raw === null) {
			return key;
		}
		return interpolate(raw, params);
	};
}
