import { describe, expect, it } from "bun:test";
import {
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
		const j2 = scheduler.add("@hourly", () => {}, {
			name: "hourly_cache",
			autoStart: false,
		});

		expect(scheduler.get("daily_sync")).toBe(j1);
		expect(scheduler.list().length).toBe(2);

		expect(scheduler.remove("daily_sync")).toBe(true);
		expect(scheduler.get("daily_sync")).toBeUndefined();
		scheduler.clear();
	});
});
