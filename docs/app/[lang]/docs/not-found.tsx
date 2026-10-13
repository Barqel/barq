"use client";

import { StatusPage } from "@/components/status-page";
import { getPathLocale } from "@/lib/i18n";
import { notFoundCopy } from "@/lib/status";
import { usePathname } from "next/navigation";

export default function NotFound() {
	const lang = getPathLocale(usePathname());

	return (
		<StatusPage lang={lang} copy={notFoundCopy[lang] ?? notFoundCopy.en} />
	);
}
