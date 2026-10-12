import type { Labels, Metric } from "./types";

function toLabelString(labels: Labels): string {
	const keys = Object.keys(labels);
	if (keys.length === 0) return "";
	const parts = keys.map((k) => {
		const v = String(labels[k]).replace(/"/g, '\\"').replace(/\n/g, "\\n");
		return `${k}="${v}"`;
	});
	return `{${parts.join(",")}}`;
}

export class Counter implements Metric {
	public readonly type = "counter";
	private readonly values = new Map<string, number>();

	constructor(
		public readonly name: string,
		public readonly help: string,
	) {}

	inc(labels: Labels = {}, value = 1): void {
		const key = toLabelString(labels);
		const current = this.values.get(key) ?? 0;
		this.values.set(key, current + value);
	}

	expose(): string {
		let out = `# HELP ${this.name} ${this.help}\n# TYPE ${this.name} ${this.type}\n`;
		for (const [labels, value] of this.values.entries()) {
			out += `${this.name}${labels} ${value}\n`;
		}
		return out;
	}
}

export class Gauge implements Metric {
	public readonly type = "gauge";
	private readonly values = new Map<string, number>();

	constructor(
		public readonly name: string,
		public readonly help: string,
	) {}

	set(labels: Labels = {}, value: number): void {
		this.values.set(toLabelString(labels), value);
	}

	inc(labels: Labels = {}, value = 1): void {
		const key = toLabelString(labels);
		const current = this.values.get(key) ?? 0;
		this.values.set(key, current + value);
	}

	dec(labels: Labels = {}, value = 1): void {
		const key = toLabelString(labels);
		const current = this.values.get(key) ?? 0;
		this.values.set(key, current - value);
	}

	expose(): string {
		let out = `# HELP ${this.name} ${this.help}\n# TYPE ${this.name} ${this.type}\n`;
		for (const [labels, value] of this.values.entries()) {
			out += `${this.name}${labels} ${value}\n`;
		}
		return out;
	}
}

export class Histogram implements Metric {
	public readonly type = "histogram";
	private readonly values = new Map<
		string,
		{ count: number; sum: number; buckets: number[] }
	>();

	constructor(
		public readonly name: string,
		public readonly help: string,
		public readonly buckets: number[] = [0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10],
	) {}

	observe(labels: Labels = {}, value: number): void {
		const key = toLabelString(labels);
		let data = this.values.get(key);
		if (!data) {
			data = { count: 0, sum: 0, buckets: new Array(this.buckets.length + 1).fill(0) };
			this.values.set(key, data);
		}

		data.count++;
		data.sum += value;
		for (let i = 0; i < this.buckets.length; i++) {
			if (value <= this.buckets[i]!) {
				data.buckets[i]++;
			}
		}
		data.buckets[this.buckets.length]++;
	}

	expose(): string {
		let out = `# HELP ${this.name} ${this.help}\n# TYPE ${this.name} ${this.type}\n`;
		for (const [labels, data] of this.values.entries()) {
			const labelPrefix = labels === "" ? "{" : `${labels.slice(0, -1)},`;
			for (let i = 0; i < this.buckets.length; i++) {
				out += `${this.name}_bucket${labelPrefix}le="${this.buckets[i]}"} ${data.buckets[i]}\n`;
			}
			out += `${this.name}_bucket${labelPrefix}le="+Inf"} ${data.buckets[this.buckets.length]}\n`;
			out += `${this.name}_sum${labels} ${data.sum}\n`;
			out += `${this.name}_count${labels} ${data.count}\n`;
		}
		return out;
	}
}

export class Registry {
	private readonly metrics = new Map<string, Metric>();

	register<T extends Metric>(metric: T): T {
		this.metrics.set(metric.name, metric);
		return metric;
	}

	getMetricsAsText(): string {
		let out = "";
		for (const metric of this.metrics.values()) {
			out += `${metric.expose()}\n`;
		}
		return out;
	}

	clear(): void {
		this.metrics.clear();
	}
}
