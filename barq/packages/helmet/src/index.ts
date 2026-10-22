import type { App, Context, Middleware } from "@barqel/barq";
import { buildHelmetHeaders } from "./headers";
import type { HelmetOptions } from "./types";

export { buildHelmetHeaders } from "./headers";
export * from "./types";

export function helmet(options: HelmetOptions = {}): Middleware {
	const staticHeaders = buildHelmetHeaders(options);
	const removePoweredBy = options.xPoweredBy !== true;

	return {
		after(_ctx: Context, res: Response) {
			const headers = new Headers(res.headers);

			for (const [key, value] of Object.entries(staticHeaders)) {
				if (!headers.has(key)) {
					headers.set(key, value);
				}
			}

			if (removePoweredBy && headers.has("x-powered-by")) {
				headers.delete("x-powered-by");
			}

			return new Response(res.body, {
				status: res.status,
				statusText: res.statusText,
				headers,
			});
		},
	};
}

export function helmetPlugin(options: HelmetOptions = {}) {
	const mw = helmet(options);
	return (app: App<any>) => {
		app.use(mw);
	};
}
