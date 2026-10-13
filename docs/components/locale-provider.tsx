"use client";

import { type ReactNode, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
	I18nProvider,
	type I18nProviderProps,
} from "fumadocs-ui/contexts/i18n";

const storageKey = "barq-locale";

type HideLocale = NonNullable<I18nProviderProps["hideLocale"]>;

/**
 * Mirrors the path swap of `fumadocs-ui`'s default `onChange`, so switching
 * languages keeps the visitor on the page they were reading.
 */
function localizedPath(
	pathname: string,
	from: string | undefined,
	to: string,
	defaultLanguage: string | undefined,
	hideLocale: HideLocale,
): string {
	let path = pathname;

	if (
		hideLocale === "never" ||
		(hideLocale === "default-locale" && from !== defaultLanguage)
	) {
		const end = pathname.indexOf("/", 1);
		path = end === -1 ? "/" : pathname.slice(end);
	}

	if (hideLocale !== "default-locale" || to !== defaultLanguage) {
		path = `/${to}${path === "/" ? "" : path}`;
	}

	return path;
}

function read(): string | null {
	try {
		return window.localStorage.getItem(storageKey);
	} catch {
		return null; // storage blocked, fall back to the URL only
	}
}

function write(locale: string): void {
	try {
		window.localStorage.setItem(storageKey, locale);
	} catch {
		// storage blocked, nothing to persist
	}
}

/**
 * Drop-in replacement for fumadocs' `I18nProvider` that remembers the language
 * the visitor picked and restores it on the next visit, even when they land on
 * a URL carrying a different locale (the proxy resolves `/` from
 * `Accept-Language`, so the stored preference has to win).
 */
export function LocaleProvider({
	children,
	locale,
	defaultLanguage,
	hideLocale = "never",
	onLocaleChange,
	locales,
	translations,
}: I18nProviderProps & { children?: ReactNode }) {
	const router = useRouter();
	const pathname = usePathname();

	useEffect(() => {
		if (!locale) return;

		const stored = read();
		if (!stored || stored === locale) return;
		if (!locales?.some((item) => item.locale === stored)) return;

		router.replace(
			localizedPath(pathname, locale, stored, defaultLanguage, hideLocale),
		);
	}, [locale, locales, pathname, router, defaultLanguage, hideLocale]);

	return (
		<I18nProvider
			locale={locale}
			locales={locales}
			translations={translations}
			defaultLanguage={defaultLanguage}
			hideLocale={hideLocale}
			onLocaleChange={(value) => {
				// persist before navigating, so the redirect above stays a no-op
				write(value);
				onLocaleChange?.(value);
				router.push(
					localizedPath(pathname, locale, value, defaultLanguage, hideLocale),
				);
			}}
		>
			{children}
		</I18nProvider>
	);
}
