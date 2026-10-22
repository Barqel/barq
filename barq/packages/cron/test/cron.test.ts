import { describe, expect, it } from "bun:test";
import {
	Cron,
	type CronDay,
	CronJob,
	CronScheduler,
	getNextCronRun,
	parseCronExpression,
} from "../src/index";

describe("@barqel/barq-cron", () => {
	it("parses 5-field cron patterns and presets", () => {
		const parsed = parseCronExpression("*/15 2 1-5 * 1-5");
		expect(parsed.hasSeconds).toBe(false);
		expect(parsed.minutes.has(0)).toBe(true);
		expect(parsed.minutes.has(15)).toBe(true);
		expect(parsed.hours.has(2)).toBe(true);
		expect(parsed.daysOfWeek.has(1)).toBe(true);
		expect(parsed.daysOfWeek.has(0)).toBe(false);

		const hourly = parseCronExpression("@hourly");
		expect(hourly.minutes.has(0)).toBe(true);
		expect(hourly.hours.size).toBe(24);
	});

	it("computes accurate next run time", () => {
		const parsed = parseCronExpression("0 12 * * *");
		const baseDate = new Date(2026, 0, 1, 10, 0, 0);
		const next = getNextCronRun(parsed, baseDate);

		expect(next.getHours()).toBe(12);
		expect(next.getMinutes()).toBe(0);
		expect(next.getDate()).toBe(1);
	});

	it("executes task manually and tracks stats", async () => {
		let executed = false;
		const job = new CronJob(
			"* * * * *",
			() => {
				executed = true;
			},
			{ autoStart: false },
		);

		expect(job.isRunning).toBe(false);
		await job.trigger();

		expect(executed).toBe(true);
		expect(job.runCount).toBe(1);
		expect(job.lastRun).toBeInstanceOf(Date);
	});

	it("prevents overlapping tasks when enabled", async () => {
		let count = 0;
		const job = new CronJob(
			"* * * * *",
			async () => {
				count++;
				await Bun.sleep(50);
			},
			{ autoStart: false, preventOverlap: true },
		);

		const p1 = job.trigger();
		const p2 = job.trigger();
		await Promise.all([p1, p2]);

		expect(count).toBe(1);
	});

	it("manages multiple jobs via CronScheduler", () => {
		const scheduler = new CronScheduler();
		const j1 = scheduler.add("@daily", () => {}, {
			name: "daily_sync",
			autoStart: false,
		});
		scheduler.add("@hourly", () => {}, {
			name: "hourly_cache",
			autoStart: false,
		});

		expect(scheduler.get("daily_sync")).toBe(j1);
		expect(scheduler.list().length).toBe(2);

		expect(scheduler.remove("daily_sync")).toBe(true);
		expect(scheduler.get("daily_sync")).toBeUndefined();
		scheduler.clear();
	});

	it("builds readable schedules with Cron helpers", () => {
		expect(Cron.hourly).toBe("0 * * * *");
		expect(Cron.daily).toBe("0 0 * * *");
		expect(Cron.weekly).toBe("0 0 * * 0");
		expect(Cron.every(30, "seconds")).toBe("@every 30s");
		expect(Cron.every(10)).toBe("@every 10m");
		expect(Cron.every(2, "hours")).toBe("@every 2h");
		expect(Cron.at("03:30")).toBe("30 3 * * *");
		expect(Cron.at("3:30")).toBe("30 3 * * *");
		expect(Cron.on("friday", "17:00")).toBe("0 17 * * 5");
		expect(Cron.on("monday")).toBe("0 0 * * 1");
	});

	it("parses every Cron helper output", () => {
		const expressions = [
			Cron.everyMinute,
			Cron.everyFiveMinutes,
			Cron.everyTenMinutes,
			Cron.everyFifteenMinutes,
			Cron.everyThirtyMinutes,
			Cron.hourly,
			Cron.daily,
			Cron.weekly,
			Cron.monthly,
			Cron.yearly,
			Cron.every(45, "seconds"),
			Cron.every(10, "minutes"),
			Cron.every(6, "hours"),
			Cron.at("03:30"),
			Cron.on("friday", "17:00"),
		];

		for (const expression of expressions) {
			expect(() => parseCronExpression(expression)).not.toThrow();
		}
	});

	it("rejects invalid Cron helper inputs", () => {
		expect(() => Cron.every(0)).toThrow("positive whole number");
		expect(() => Cron.every(2.5, "minutes")).toThrow("positive whole number");
		expect(() => Cron.every(90, "minutes")).toThrow("too large");
		expect(() => Cron.every(24, "hours")).toThrow("too large");
		expect(() => Cron.at("25:00")).toThrow('expected "HH:mm"');
		expect(() => Cron.at("noon")).toThrow('expected "HH:mm"');
		expect(() => Cron.on("noday" as CronDay)).toThrow("Invalid weekday");
	});
});
