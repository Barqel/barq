import { getNextCronRun, parseCronExpression } from "./parser";
import type {
	CronJobInterface,
	CronJobOptions,
	CronTask,
	ParsedCronFields,
} from "./types";

export class CronJob implements CronJobInterface {
	readonly name: string;
	readonly pattern: string;
	private readonly task: CronTask;
	private readonly options: CronJobOptions;
	private readonly fields: ParsedCronFields;

	private timer: ReturnType<typeof setTimeout> | null = null;
	private _isRunning = false;
	private _isExecuting = false;
	private _runCount = 0;
	private _lastRun: Date | null = null;
	private _nextRun: Date | null = null;

	constructor(pattern: string, task: CronTask, options: CronJobOptions = {}) {
		this.pattern = pattern;
		this.task = task;
		this.options = options;
		this.name = options.name ?? `job_${Math.random().toString(36).slice(2, 9)}`;
		this.fields = parseCronExpression(pattern);

		if (options.autoStart ?? true) {
			this.start();
		}
	}

	get isRunning(): boolean {
		return this._isRunning;
	}

	get isExecuting(): boolean {
		return this._isExecuting;
	}

	get runCount(): number {
		return this._runCount;
	}

	get lastRun(): Date | null {
		return this._lastRun;
	}

	get nextRun(): Date | null {
		return this._nextRun;
	}

	start(): this {
		if (this._isRunning) return this;
		this._isRunning = true;

		if (this.options.runOnInit) {
			this.trigger().catch((err) => this.handleError(err));
		}

		this.scheduleNext();
		return this;
	}

	stop(): this {
		this._isRunning = false;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		this._nextRun = null;
		return this;
	}

	pause(): this {
		return this.stop();
	}

	resume(): this {
		return this.start();
	}

	async trigger(): Promise<void> {
		if (this.options.preventOverlap && this._isExecuting) {
			return;
		}

		this._isExecuting = true;
		this._lastRun = new Date();
		this._runCount++;

		try {
			if (this.options.timeoutMs) {
				await Promise.race([
					Promise.resolve(this.task(this)),
					new Promise((_, reject) =>
						setTimeout(
							() => reject(new Error(`Job "${this.name}" timed out`)),
							this.options.timeoutMs,
						),
					),
				]);
			} else {
				await Promise.resolve(this.task(this));
			}
		} catch (error) {
			this.handleError(error);
		} finally {
			this._isExecuting = false;
		}
	}

	private scheduleNext(): void {
		if (!this._isRunning) return;

		try {
			const next = getNextCronRun(this.fields, new Date());
			this._nextRun = next;

			const delay = Math.max(0, next.getTime() - Date.now());
			this.timer = setTimeout(() => {
				this.trigger()
					.catch((err) => this.handleError(err))
					.finally(() => this.scheduleNext());
			}, delay);

			if (typeof this.timer.unref === "function") {
				this.timer.unref();
			}
		} catch (err) {
			this.handleError(err);
		}
	}

	private handleError(error: unknown): void {
		if (this.options.onError) {
			this.options.onError(error, this);
		} else {
			console.error(`[CronJob:${this.name}] Execution failed:`, error);
		}
	}
}
