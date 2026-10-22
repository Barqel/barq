// Locale resolution: the framework ships built-in translations for every
// message it can produce (the `errors.*` family), and the application's
// translations are deep-merged over them — app keys always win.
//
//   defineConfig({
//     translations: { ar, en },            // app messages
//     locales: { default: "ar", supported: ["ar", "en"] },  // optional
//   })
import type { TranslationsRecord } from "@barqel/barq-i18n";

export interface LocalesConfig {
	/** Default locale when the request carries no `Accept-Language`. */
	default?: string;
	/** Locales the app serves. Defaults to: framework locales + app locales. */
	supported?: string[];
}

export interface ResolveLocalesInput extends LocalesConfig {
	/** Application messages per locale, merged over the framework defaults. */
	translations?: TranslationsRecord;
}

export interface ResolvedLocales {
	defaultLocale: string;
	locales: string[];
	translations: TranslationsRecord;
}

/** Built-in messages for framework-generated errors. */
export const FRAMEWORK_MESSAGES: TranslationsRecord = {
	ar: {
		errors: {
			notFound: "العنصر غير موجود",
			internal: "حدث خطأ داخلي في الخادم",
			validation: "فشل التحقق من البيانات المدخلة",
			forbidden: "غير مصرح لك بتنفيذ هذا الإجراء",
			rateLimited: "تجاوزت الحد المسموح من الطلبات، يرجى المحاولة لاحقاً",
			idempotencyKeyMissing: "ترويسة Idempotency-Key مطلوبة لهذا الطلب",
		},
	},
	en: {
		errors: {
			notFound: "Item not found",
			internal: "An internal server error occurred",
			validation: "Validation failed",
			forbidden: "You are not authorized to perform this action",
			rateLimited: "Too many requests, please try again later",
			idempotencyKeyMissing:
				"Idempotency-Key header is required for this request",
		},
	},
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.getPrototypeOf(value) === Object.prototype
	);
}

function deepMerge(
	base: Record<string, unknown>,
	override: Record<string, unknown>,
): Record<string, unknown> {
	const merged: Record<string, unknown> = { ...base };

	for (const [key, value] of Object.entries(override)) {
		const previous = merged[key];
		merged[key] =
			isPlainObject(previous) && isPlainObject(value)
				? deepMerge(previous, value)
				: value;
	}

	return merged;
}

export function resolveLocales(
	input: ResolveLocalesInput = {},
): ResolvedLocales {
	const appTranslations = input.translations ?? {};

	const locales =
		input.supported ??
		Array.from(
			new Set([
				...Object.keys(FRAMEWORK_MESSAGES),
				...Object.keys(appTranslations),
			]),
		);

	const effective = locales.length > 0 ? locales : ["en"];

	const translations: TranslationsRecord = {};

	for (const locale of effective) {
		translations[locale] = deepMerge(
			FRAMEWORK_MESSAGES[locale] ?? {},
			appTranslations[locale] ?? {},
		) as TranslationsRecord[string];
	}

	const defaultLocale =
		input.default ?? (effective.includes("en") ? "en" : effective[0]!);

	return { defaultLocale, locales: effective, translations };
}
