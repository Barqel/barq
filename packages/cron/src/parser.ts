import type { ParsedCronFields } from "./types";

const PRESETS: Record<string, string> = {
	"@yearly": "0 0 1 1 *",
	"@annually": "0 0 1 1 *",
	"@monthly": "0 0 1 * *",
	"@weekly": "0 0 * * 0",
	"@daily": "0 0 * * *",
	"@midnight": "0 0 * * *",
	"@hourly": "0 * * * *",
};

export function parseCronExpression(expression: string): ParsedCronFields {
	let expr = expression.trim();
	if (PRESETS[expr]) {
		expr = PRESETS[expr]!;
	}

	if (expr.startsWith("@every ")) {
		const intervalStr = expr.slice(7).trim();
		return parseInterval(intervalStr);
	}

	const parts = expr.split(/\s+/);
	if (parts.length !== 5 && parts.length !== 6) {
		throw new Error(`Invalid cron pattern: "${expression}". Must contain 5 or 6 fields.`);
	}

	const hasSeconds = parts.length === 6;
	const secField = hasSeconds ? parts[0]! : "0";
	const minField = hasSeconds ? parts[1]! : parts[0]!;
	const hourField = hasSeconds ? parts[2]! : parts[1]!;
	const domField = hasSeconds ? parts[3]! : parts[2]!;
	const monField = hasSeconds ? parts[4]! : parts[3]!;
	const dowField = hasSeconds ? parts[5]! : parts[4]!;

	return {
		hasSeconds,
		seconds: parseField(secField, 0, 59),
		minutes: parseField(minField, 0, 59),
		hours: parseField(hourField, 0, 23),
		daysOfMonth: parseField(domField, 1, 31),
		months: parseField(monField, 1, 12),
		daysOfWeek: parseField(dowField, 0, 7, true),
	};
}

function parseField(field: string, min: number, max: number, isDayOfWeek = false): Set<number> {
	const values = new Set<number>();
	const items = field.split(",");

	for (const item of items) {
		if (item === "*") {
			for (let i = min; i <= max; i++) values.add(isDayOfWeek && i === 7 ? 0 : i);
			continue;
		}

		if (item.includes("/")) {
			const [rangePart, stepPart] = item.split("/") as [string, string];
			const step = Number.parseInt(stepPart, 10);
			if (Number.isNaN(step) || step <= 0) {
				throw new Error(`Invalid step value in: "${item}"`);
			}

			let start = min;
			let end = max;
			if (rangePart !== "*") {
				if (rangePart.includes("-")) {
					const [rStart, rEnd] = rangePart.split("-").map((v) => Number.parseInt(v, 10));
					start = rStart!;
					end = rEnd!;
				} else {
					start = Number.parseInt(rangePart, 10);
				}
			}

			for (let i = start; i <= end; i += step) {
				values.add(isDayOfWeek && i === 7 ? 0 : i);
			}
			continue;
		}

		if (item.includes("-")) {
			const [start, end] = item.split("-").map((v) => Number.parseInt(v, 10)) as [number, number];
			if (Number.isNaN(start) || Number.isNaN(end) || start > end || start < min || end > max) {
				throw new Error(`Invalid range in: "${item}"`);
			}
			for (let i = start; i <= end; i++) {
				values.add(isDayOfWeek && i === 7 ? 0 : i);
			}
			continue;
		}

		const num = Number.parseInt(item, 10);
		if (Number.isNaN(num) || num < min || num > max) {
			throw new Error(`Invalid field value: "${item}" outside range ${min}-${max}`);
		}
		values.add(isDayOfWeek && num === 7 ? 0 : num);
	}

	return values;
}

function parseInterval(interval: string): ParsedCronFields {
	const match = /^(\d+)(s|m|h|d)?$/i.exec(interval);
	if (!match) throw new Error(`Invalid interval: "${interval}"`);

	const amount = Number.parseInt(match[1]!, 10);
	const unit = (match[2] ?? "s").toLowerCase();

	if (unit === "s") {
		if (amount > 59) throw new Error("Interval seconds must be <= 59");
		return {
			hasSeconds: true,
			seconds: parseField(`*/${amount}`, 0, 59),
			minutes: parseField("*", 0, 59),
			hours: parseField("*", 0, 23),
			daysOfMonth: parseField("*", 1, 31),
			months: parseField("*", 1, 12),
			daysOfWeek: parseField("*", 0, 7, true),
		};
	}

	if (unit === "m") {
		if (amount > 59) throw new Error("Interval minutes must be <= 59");
		return {
			hasSeconds: false,
			seconds: new Set([0]),
			minutes: parseField(`*/${amount}`, 0, 59),
			hours: parseField("*", 0, 23),
			daysOfMonth: parseField("*", 1, 31),
			months: parseField("*", 1, 12),
			daysOfWeek: parseField("*", 0, 7, true),
		};
	}

	if (unit === "h") {
		if (amount > 23) throw new Error("Interval hours must be <= 23");
		return {
			hasSeconds: false,
			seconds: new Set([0]),
			minutes: new Set([0]),
			hours: parseField(`*/${amount}`, 0, 23),
			daysOfMonth: parseField("*", 1, 31),
			months: parseField("*", 1, 12),
			daysOfWeek: parseField("*", 0, 7, true),
		};
	}

	throw new Error(`Unsupported interval unit: "${unit}"`);
}

export function getNextCronRun(fields: ParsedCronFields, fromDate: Date = new Date()): Date {
	const next = new Date(fromDate.getTime());
	const stepMs = fields.hasSeconds ? 1000 : 60000;

	if (fields.hasSeconds) {
		next.setMilliseconds(0);
		next.setTime(next.getTime() + stepMs);
	} else {
		next.setSeconds(0, 0);
		next.setTime(next.getTime() + stepMs);
	}

	const maxIterations = 60 * 24 * 366 * 5;
	let count = 0;

	while (count < maxIterations) {
		count++;

		const month = next.getMonth() + 1;
		if (!fields.months.has(month)) {
			next.setMonth(next.getMonth() + 1, 1);
			next.setHours(0, 0, 0, 0);
			continue;
		}

		const dom = next.getDate();
		const dow = next.getDay();
		if (!fields.daysOfMonth.has(dom) || !fields.daysOfWeek.has(dow)) {
			next.setDate(next.getDate() + 1);
			next.setHours(0, 0, 0, 0);
			continue;
		}

		const hour = next.getHours();
		if (!fields.hours.has(hour)) {
			next.setHours(next.getHours() + 1, 0, 0, 0);
			continue;
		}

		const minute = next.getMinutes();
		if (!fields.minutes.has(minute)) {
			next.setMinutes(next.getMinutes() + 1, 0, 0);
			continue;
		}

		if (fields.hasSeconds) {
			const second = next.getSeconds();
			if (!fields.seconds.has(second)) {
				next.setSeconds(next.getSeconds() + 1, 0);
				continue;
			}
		}

		return next;
	}

	throw new Error("Could not find matching next cron execution within limits");
}
