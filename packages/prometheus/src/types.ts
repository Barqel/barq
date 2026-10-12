import type { Context } from "@barqel/barq";

export interface PrometheusOptions {
	metricsPath?: string;
	defaultMetrics?: boolean;
	buckets?: number[];
	normalizePath?: (pathname: string, ctx: Context) => string;
	skip?: (ctx: Context) => boolean;
}

export type Labels = Record<string, string | number>;

export interface Metric {
	name: string;
	help: string;
	type: "counter" | "gauge" | "histogram";
	expose(): string;
}
