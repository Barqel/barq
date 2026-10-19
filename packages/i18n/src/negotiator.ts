interface QualityLocale {
	locale: string;
	q: number;
}

export function negotiateLocale(
	acceptLanguageHeader: string | null,
	supportedLocales: string[],
	defaultLocale: string,
): string {
	if (!acceptLanguageHeader) return defaultLocale;

	const candidates: QualityLocale[] = [];
	const parts = acceptLanguageHeader.split(",");

	for (const part of parts) {
		const [rawLocale, rawQ] = part.trim().split(";");
		const locale = rawLocale?.trim().toLowerCase();
		if (!locale) continue;

		let q = 1;
		if (rawQ) {
			const match = /q=([0-9.]+)/i.exec(rawQ);
			if (match?.[1]) {
				const parsed = Number.parseFloat(match[1]);
				if (!Number.isNaN(parsed)) q = parsed;
			}
		}

		candidates.push({ locale, q });
	}

	candidates.sort((a, b) => b.q - a.q);

	const normalizedSupported = supportedLocales.map((l) => l.toLowerCase());

	for (const candidate of candidates) {
		if (candidate.q === 0) continue;

		const directIdx = normalizedSupported.indexOf(candidate.locale);
		if (directIdx !== -1) {
			return supportedLocales[directIdx]!;
		}

		const baseCode = candidate.locale.split("-")[0];
		if (baseCode) {
			const baseIdx = normalizedSupported.findIndex((l) =>
				l.startsWith(baseCode),
			);
			if (baseIdx !== -1) {
				return supportedLocales[baseIdx]!;
			}
		}
	}

	return defaultLocale;
}
