import type { App } from "@barqel/barq";
import { CronScheduler } from "./scheduler";
import type { CronJobOptions, CronTask } from "./types";

export * from "./types";
export * from "./parser";
export * from "./job";
export * from "./scheduler";

export function cron() {
	const scheduler = new CronScheduler();

	return <TState extends object = Record<string, unknown>>(
		app: App<TState>,
	) => {
		(app as any).cron = scheduler;
		(app as any).schedule = (pattern: string, task: CronTask, options?: CronJobOptions) =>
			scheduler.add(pattern, task, options);
	};
}
