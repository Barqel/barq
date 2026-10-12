import type { Context } from "@barqel/barq";

export type TranslationDictionary = {
	[key: string]: string | TranslationDictionary;
};

export type TranslationsRecord = Record<string, TranslationDictionary>;

export interface I18nOptions {
	defaultLocale: string;
	locales: string[];
	translations: TranslationsRecord;
	queryParam?: string;
	headerName?: string;
	cookieName?: string;
	extractor?: (ctx: Context) => string | null | Promise<string | null>;
}

export type TranslateFunction = (key: string, params?: Record<string, string | number>) => string;
