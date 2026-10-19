// Readable schedule helpers for jobs — every helper returns a plain cron
// string (or `@every` shortcut) that `parseCronExpression` already knows:
//
//   Cron.hourly                → "0 * * * *"
//   Cron.at("03:30")           → "30 3 * * *"
//   Cron.on("friday", "17:00") → "0 17 * * 5"
//   Cron.every(10, "minutes")  → "@every 10m"

export type CronUnit = "seconds" | "minutes" | "hours";

export type CronDay =
	| "sunday"
	| "monday"
	| "tuesday"
	| "wednesday"
	| "thursday"
	| "friday"
	| "saturday";

const DAY_NUMBERS: Record<CronDay, number> = {
	sunday: 0,
	monday: 1,
	tuesday: 2,
	wednesday: 3,
	thursday: 4,
	friday: 5,
	saturday: 6,
};

const UNIT_SUFFIX: Record<CronUnit, string> = {
	seconds: "s",
	minutes: "m",
	hours: "h",
};

/** Maximums enforced by the parser's `@every` handling. */
const UNIT_MAX: Record<CronUnit, number> = {
	seconds: 59,
	minutes: 59,
	hours: 23,
};

function parseTime(time: string): { minutes: number; hours: number } {
	const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
	const hours = match ? Number(match[1]) : Number.NaN;
	const minutes = match ? Number(match[2]) : Number.NaN;

	if (
		Number.isNaN(hours) ||
		Number.isNaN(minutes) ||
		hours > 23 ||
		minutes > 59
	) {
		throw new Error(
			`Invalid time "${time}" — expected "HH:mm" (e.g. "03:30").`,
		);
	}

	return { minutes, hours };
}

export const Cron = Object.freeze({
	/** Every minute. */
	everyMinute: "* * * * *",
	/** Every 5 minutes. */
	everyFiveMinutes: "*/5 * * * *",
	/** Every 10 minutes. */
	everyTenMinutes: "*/10 * * * *",
	/** Every 15 minutes. */
	everyFifteenMinutes: "*/15 * * * *",
	/** Every 30 minutes. */
	everyThirtyMinutes: "*/30 * * * *",
	/** `"0 * * * *"` — every hour, on the hour. */
	hourly: "0 * * * *",
	/** `"0 0 * * *"` — every day at midnight. */
	daily: "0 0 * * *",
	/** `"0 0 * * 0"` — every Sunday at midnight. */
	weekly: "0 0 * * 0",
	/** `"0 0 1 * *"` — the 1st of every month at midnight. */
	monthly: "0 0 1 * *",
	/** `"0 0 1 1 *"` — January 1st at midnight. */
	yearly: "0 0 1 1 *",

	/** Custom interval (minutes by default) — `Cron.every(30, "seconds")` → `"@every 30s"`. */
	every(amount: number, unit: CronUnit = "minutes"): string {
		if (!Number.isInteger(amount) || amount < 1) {
			throw new Error(
				`Invalid interval amount "${amount}" — expected a positive whole number.`,
			);
		}

		if (amount > UNIT_MAX[unit]) {
			throw new Error(
				`Interval ${amount} ${unit} is too large — the maximum is ${UNIT_MAX[unit]}.`,
			);
		}

		return `@every ${amount}${UNIT_SUFFIX[unit]}`;
	},

	/** Every day at a wall-clock time — `Cron.at("03:30")` → `"30 3 * * *"`. */
	at(time: string): string {
		const { minutes, hours } = parseTime(time);
		return `${minutes} ${hours} * * *`;
	},

	/** Every week on a weekday, at a time (default midnight) — `Cron.on("friday", "17:00")` → `"0 17 * * 5"`. */
	on(day: CronDay, time = "00:00"): string {
		const number: number | undefined = DAY_NUMBERS[day];

		if (number === undefined) {
			throw new Error(
				`Invalid weekday "${day}" — expected one of: ${Object.keys(DAY_NUMBERS).join(", ")}.`,
			);
		}

		const { minutes, hours } = parseTime(time);
		return `${minutes} ${hours} * * ${number}`;
	},
});
