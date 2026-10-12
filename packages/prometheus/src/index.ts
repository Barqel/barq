import type { App, Context } from "@barqel/barq";
import { Counter, Histogram, Registry } from "./registry";
import { collectDefaultMetrics } from "./system";
import type { PrometheusOptions } from "./types";

export * from "./types";
export * from "./registry";

export function prometheusPlugin(options: PrometheusOptions = {}) {
	const metricsPath = options.metricsPath ?? "/metrics";
	const defaultMetrics = options.defaultMetrics ?? true;
	const normalizePath = options.normalizePath ?? ((pathname: string) => pathname);
	const skip = options.skip ?? (() => false);

	const registry = new Registry();

	const reqCounter = registry.register(
		new Counter("http_requests_total", "Total number of HTTP requests"),
	);

	const reqDuration = registry.register(
		new Histogram(
			"http_request_duration_seconds",
			"HTTP request duration in seconds",
			options.buckets,
		),
	);

	let updateSystemMetrics: (() => void) | undefined;
	if (defaultMetrics) {
		updateSystemMetrics = collectDefaultMetrics(registry);
	}

	return <TState extends object = Record<string, unknown>>(
		app: App<TState>,
	) => {
		app.use({
			before(ctx: Context) {
				if (ctx.pathname === metricsPath || skip(ctx)) return;
				(ctx.state as any)._promStartTime = performance.now();
			},
			after(ctx: Context, res: Response) {
				if (ctx.pathname === metricsPath || skip(ctx)) return res;

				const startTime = (ctx.state as any)._promStartTime as number | undefined;
				if (startTime !== undefined) {
					const durationSec = (performance.now() - startTime) / 1000;
					const path = normalizePath(ctx.pathname, ctx);
					const method = ctx.req.method;
					const status = res.status;

					reqCounter.inc({ method, path, status });
					reqDuration.observe({ method, path, status }, durationSec);
				}
				return res;
			},
		});

		app.get(metricsPath, () => {
			if (updateSystemMetrics) {
				updateSystemMetrics();
			}
			return new Response(registry.getMetricsAsText(), {
				headers: {
					"content-type": "text/plain; version=0.0.4; charset=utf-8",
				},
			});
		});

		(app as any).prometheus = registry;
	};
}
