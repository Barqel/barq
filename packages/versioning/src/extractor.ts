import type { Context } from "@barqel/barq";
import type { VersioningOptions, VersioningType } from "./types";

export function defaultNormalizeVersion(raw: string): string {
	const trimmed = raw.trim().toLowerCase();
	return trimmed.startsWith("v") ? trimmed.slice(1) : trimmed;
}

export async function extractVersion(
	ctx: Context,
	options: VersioningOptions = {},
): Promise<string | null> {
	if (options.extractor) {
		const extracted = await options.extractor(ctx);
		if (extracted) {
			const normalize = options.normalize ?? defaultNormalizeVersion;
			return normalize(extracted);
		}
	}

	const types: VersioningType[] = Array.isArray(options.type)
		? options.type
		: options.type
			? [options.type]
			: ["header", "query"];

	const normalize = options.normalize ?? defaultNormalizeVersion;

	for (const type of types) {
		if (type === "header") {
			const headerName = (options.header ?? "accept-version").toLowerCase();
			const headerVal = ctx.req.headers.get(headerName);
			if (headerVal) {
				return normalize(headerVal);
			}
		}

		if (type === "query") {
			const queryParamName = options.query ?? "v";
			const queryVal = ctx.queryParam(queryParamName);
			if (queryVal) {
				return normalize(queryVal);
			}
		}

		if (type === "media-type") {
			const acceptHeader = ctx.req.headers.get("accept");
			if (acceptHeader) {
				const prefix = options.mediaTypePrefix ?? "application/vnd.api";
				const regex = new RegExp(`${prefix}\\.v?([a-zA-Z0-9._-]+)\\+`, "i");
				const match = regex.exec(acceptHeader);
				if (match && match[1]) {
					return normalize(match[1]);
				}
			}
		}
	}

	return null;
}
