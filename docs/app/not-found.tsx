"use client";

import { getDirection, getPathLocale } from "@/lib/i18n";
import { notFoundCopy } from "@/lib/status";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * With `output: 'export'` this becomes `out/404.html`. Next wraps it in its own
 * document, so this only renders the body — `lang`/`dir` are patched onto
 * `<html>` on the client because the locale can only be read off the URL.
 */
export default function NotFound() {
	const lang = getPathLocale(usePathname());
	const copy = notFoundCopy[lang] ?? notFoundCopy.en;

	useEffect(() => {
		document.documentElement.lang = lang;
		document.documentElement.dir = getDirection(lang);
	}, [lang]);

	return (
		<main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
			<p className="text-fd-muted-foreground text-6xl font-bold">{copy.code}</p>
			<h1 className="text-2xl font-semibold">{copy.title}</h1>
			<p className="text-fd-muted-foreground">{copy.description}</p>
			<a
				className="text-fd-primary font-medium underline"
				href={`/${lang}/docs/`}
			>
				{copy.action}
			</a>
		</main>
	);
}
