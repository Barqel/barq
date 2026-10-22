// CORS options derived from `APP_CORS_ORIGIN` (comma-separated list or "*").
import type { CorsOptions } from "@barqel/barq";

export function parseOrigins(raw: string): string | string[] {
	const value = raw.trim();

	if (value === "" || value === "*") {
		return "*";
	}

	const origins = value
		.split(",")
		.map((origin) => origin.trim())
		.filter(Boolean);

	return origins.length <= 1 ? (origins[0] ?? "*") : origins;
}

export function corsOptions(origin: string): CorsOptions {
	return {
		origin: parseOrigins(origin),
		methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
		allowedHeaders: ["Content-Type", "Authorization", "Accept-Language"],
		credentials: false,
		maxAge: 86400,
	} satisfies CorsOptions;
}
