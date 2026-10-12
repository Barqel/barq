import type { Context, Middleware } from "@barqel/barq";
import { negotiateLocale } from "./negotiator";
import { createTranslator } from "./translator";
import type { I18nOptions, TranslateFunction } from "./types";

export function i18nMiddleware(options: I18nOptions): Middleware {
	const queryParam = options.queryParam ?? "lang";
	const headerName = options.headerName?.toLowerCase() ?? "accept-language";
	const cookieName = options.cookieName;

	return {
		async before(ctx: Context) {
			let locale: string | null = null;

			if (options.extractor) {
				locale = await options.extractor(ctx);
			}

			if (!locale && queryParam) {
				const fromQuery = ctx.queryParam(queryParam);
				if (fromQuery && options.locales.includes(fromQuery)) {
					locale = fromQuery;
				}
			}

			if (!locale && cookieName) {
				const fromCookie = ctx.cookies.get(cookieName);
				if (fromCookie && options.locales.includes(fromCookie)) {
					locale = fromCookie;
				}
			}

			if (!locale) {
				const acceptHeader = ctx.req.headers.get(headerName);
				locale = negotiateLocale(acceptHeader, options.locales, options.defaultLocale);
			}

			const t: TranslateFunction = createTranslator(
				options.translations,
				locale,
				options.defaultLocale,
			);

			const state = ctx.state as Record<string, unknown>;
			state.locale = locale;
			state.t = t;
			(ctx as any).t = t;
		},

		after(ctx: Context, res: Response) {
			const locale = (ctx.state as Record<string, unknown>).locale as string | undefined;
			if (locale && !res.headers.has("content-language")) {
				const headers = new Headers(res.headers);
				headers.set("content-language", locale);
				return new Response(res.body, {
					status: res.status,
					statusText: res.statusText,
					headers,
				});
			}
			return res;
		},
	};
}
