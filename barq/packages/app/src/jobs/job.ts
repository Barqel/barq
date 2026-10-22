// Base class for scheduled jobs — subclass it and write `handle()` only:
//
//   export class CleanupTokensJob extends Job {
//     readonly name = "cleanup-tokens";
//     readonly schedule = Cron.hourly;
//
//     async handle(): Promise<void> {
//       await tokens.deleteExpired();
//     }
//   }
//
// Register the class in `barq.config.ts` (`jobs: [...]`) — it starts with
// the server and stops on graceful shutdown. Jobs may inject services
// (`constructor(private readonly users: UserService) {}`) — add the
// `@injectable()` decorator when they do.
//
// Schedules, two ways (both from `@barqel/barq-cron`, re-exported here):
//   Cron helpers  Cron.hourly · Cron.daily · Cron.every(10, "minutes")
//                 Cron.at("03:30") · Cron.on("friday", "17:00")
//   Raw strings   "0 3 * * *" (5-field) · "*/10 * * * * *" (with seconds)
//                 "@daily" · "@hourly" · "@every 30s" · "@every 5m"

import type { CronScheduler } from "@barqel/barq-cron";
import { container, type InjectionToken } from "tsyringe";
import { ENV, env } from "../kernel/env";

export abstract class Job {
	/** Unique job name — shows up in logs and `app.cron.list()`. */
	abstract readonly name: string;

	/** Cron expression, shortcut or `Cron` helper (see file header). */
	abstract readonly schedule: string;

	/** Skip a run while the previous one is still executing (default: on). */
	readonly preventOverlap: boolean = true;

	/** Run once immediately after boot (default: off). */
	readonly runOnInit: boolean = false;

	/** Abort the run after this many milliseconds. */
	readonly timeoutMs?: number;

	/** Your logic — no `ctx`, jobs run outside any request scope. */
	abstract handle(): void | Promise<void>;
}

export type JobClass = new (...args: never[]) => Job;

export interface RegisterJobsOptions {
	/** Start timers immediately (default: true). In tests pass `false`. */
	autoStart?: boolean;
}

/** Turns every registered `Job` class into a running `CronJob`. */
export function registerJobs(
	scheduler: CronScheduler,
	jobClasses: JobClass[],
	options: RegisterJobsOptions = {},
): void {
	const autoStart = options.autoStart ?? true;

	for (const JobClass of jobClasses) {
		const job = container.resolve(JobClass as unknown as InjectionToken<Job>);

		scheduler.add(job.schedule, () => job.handle(), {
			name: job.name,
			preventOverlap: job.preventOverlap,
			runOnInit: job.runOnInit,
			timeoutMs: job.timeoutMs,
			autoStart: false,
			onError: (error) => {
				console.error(`[cron] job "${job.name}" failed:`, error);
			},
		});
	}

	if (autoStart) {
		scheduler.startAll();
	}

	// Development visibility: one line per job with its next run time.
	if (autoStart && env.APP_ENV === ENV.DEVELOPMENT) {
		for (const entry of scheduler.list()) {
			console.info(
				`[cron] "${entry.name}" scheduled (${entry.pattern}) — next run: ${
					entry.nextRun?.toISOString() ?? "not started"
				}`,
			);
		}
	}
}
