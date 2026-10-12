import { CronJob } from "./job";
import type { CronJobInterface, CronJobOptions, CronTask } from "./types";

export class CronScheduler {
	private readonly jobs = new Map<string, CronJobInterface>();

	add(pattern: string, task: CronTask, options: CronJobOptions = {}): CronJobInterface {
		const job = new CronJob(pattern, task, options);
		if (this.jobs.has(job.name)) {
			throw new Error(`Job with name "${job.name}" already exists`);
		}
		this.jobs.set(job.name, job);
		return job;
	}

	get(name: string): CronJobInterface | undefined {
		return this.jobs.get(name);
	}

	remove(name: string): boolean {
		const job = this.jobs.get(name);
		if (!job) return false;
		job.stop();
		return this.jobs.delete(name);
	}

	startAll(): void {
		for (const job of this.jobs.values()) {
			job.start();
		}
	}

	stopAll(): void {
		for (const job of this.jobs.values()) {
			job.stop();
		}
	}

	clear(): void {
		this.stopAll();
		this.jobs.clear();
	}

	list(): Array<{ name: string; pattern: string; nextRun: Date | null; lastRun: Date | null; isRunning: boolean }> {
		return Array.from(this.jobs.values()).map((job) => ({
			name: job.name,
			pattern: job.pattern,
			nextRun: job.nextRun,
			lastRun: job.lastRun,
			isRunning: job.isRunning,
		}));
	}
}
