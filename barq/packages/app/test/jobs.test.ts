import { describe, expect, it } from "bun:test";
import { Cron, CronScheduler, Job, registerJobs } from "../src/index";

class DemoJob extends Job {
	static runs = 0;

	readonly name = "demo-job";
	readonly schedule = Cron.hourly;

	async handle(): Promise<void> {
		DemoJob.runs += 1;
	}
}

describe("registerJobs", () => {
	it("registers jobs without starting timers when autoStart is off", () => {
		const scheduler = new CronScheduler();

		registerJobs(scheduler, [DemoJob], { autoStart: false });

		expect(scheduler.get("demo-job")).toBeDefined();
		expect(scheduler.list()).toEqual([
			expect.objectContaining({
				name: "demo-job",
				pattern: "0 * * * *",
				isRunning: false,
			}),
		]);
	});

	it("runs a job on demand", async () => {
		const scheduler = new CronScheduler();

		registerJobs(scheduler, [DemoJob], { autoStart: false });
		await scheduler.get("demo-job")?.trigger();

		expect(DemoJob.runs).toBe(1);
	});
});
