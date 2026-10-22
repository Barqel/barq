export type CronTask = (job: CronJobInterface) => void | Promise<void>;

export interface CronJobOptions {
	name?: string;
	preventOverlap?: boolean;
	runOnInit?: boolean;
	timeoutMs?: number;
	autoStart?: boolean;
	onError?: (error: unknown, job: CronJobInterface) => void;
}

export interface CronJobInterface {
	readonly name: string;
	readonly pattern: string;
	readonly isRunning: boolean;
	readonly isExecuting: boolean;
	readonly runCount: number;
	readonly lastRun: Date | null;
	readonly nextRun: Date | null;
	start(): this;
	stop(): this;
	pause(): this;
	resume(): this;
	trigger(): Promise<void>;
}

export interface ParsedCronFields {
	hasSeconds: boolean;
	seconds: Set<number>;
	minutes: Set<number>;
	hours: Set<number>;
	daysOfMonth: Set<number>;
	months: Set<number>;
	daysOfWeek: Set<number>;
}
