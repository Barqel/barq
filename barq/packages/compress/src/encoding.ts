import type { CompressionAlgorithm } from "./types";

interface EncodingPreference {
	encoding: string;
	q: number;
}

export function negotiateEncoding(
	header: string | null,
	supported: CompressionAlgorithm[] = ["br", "gzip", "deflate"],
): CompressionAlgorithm | null {
	if (!header) return null;

	const preferences: EncodingPreference[] = [];
	const parts = header.split(",");

	for (const part of parts) {
		const [rawEnc, rawQ] = part.trim().split(";");
		const encoding = rawEnc?.toLowerCase();
		if (!encoding) continue;

		let q = 1;
		if (rawQ) {
			const match = /q=([0-9.]+)/i.exec(rawQ);
			if (match?.[1]) {
				const parsed = Number.parseFloat(match[1]);
				if (!Number.isNaN(parsed)) q = parsed;
			}
		}

		preferences.push({ encoding, q });
	}

	preferences.sort((a, b) => {
		if (b.q !== a.q) return b.q - a.q;
		const aIdx = supported.indexOf(a.encoding as CompressionAlgorithm);
		const bIdx = supported.indexOf(b.encoding as CompressionAlgorithm);
		const aRank = aIdx === -1 ? 999 : aIdx;
		const bRank = bIdx === -1 ? 999 : bIdx;
		return aRank - bRank;
	});

	for (const pref of preferences) {
		if (pref.q === 0) continue;

		if (pref.encoding === "*") {
			return supported[0] ?? null;
		}

		if (supported.includes(pref.encoding as CompressionAlgorithm)) {
			return pref.encoding as CompressionAlgorithm;
		}
	}

	return null;
}
