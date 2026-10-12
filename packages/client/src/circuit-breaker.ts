import type { CircuitBreakerOptions } from "./types";

export class CircuitBreakerOpenError extends Error {
	constructor(message = "Circuit breaker is open. Request rejected.") {
		super(message);
		this.name = "CircuitBreakerOpenError";
	}
}

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export class CircuitBreaker {
	private state: CircuitState = "CLOSED";
	private failureCount = 0;
	private successCount = 0;
	private nextAttempt = 0;

	private readonly failureThreshold: number;
	private readonly recoveryTimeMs: number;
	private readonly halfOpenSuccessThreshold: number;
	private readonly enabled: boolean;

	constructor(options: CircuitBreakerOptions = {}) {
		this.enabled = options.enabled ?? true;
		this.failureThreshold = options.failureThreshold ?? 5;
		this.recoveryTimeMs = options.recoveryTimeMs ?? 30_000;
		this.halfOpenSuccessThreshold = options.halfOpenSuccessThreshold ?? 2;
	}

	get currentState(): CircuitState {
		if (this.state === "OPEN" && Date.now() >= this.nextAttempt) {
			this.state = "HALF_OPEN";
			this.successCount = 0;
		}
		return this.state;
	}

	assertCanExecute(): void {
		if (!this.enabled) return;
		if (this.currentState === "OPEN") {
			throw new CircuitBreakerOpenError();
		}
	}

	recordSuccess(): void {
		if (!this.enabled) return;
		if (this.state === "HALF_OPEN") {
			this.successCount++;
			if (this.successCount >= this.halfOpenSuccessThreshold) {
				this.state = "CLOSED";
				this.failureCount = 0;
			}
		} else if (this.state === "CLOSED") {
			this.failureCount = 0;
		}
	}

	recordFailure(): void {
		if (!this.enabled) return;
		if (this.state === "HALF_OPEN") {
			this.trip();
		} else if (this.state === "CLOSED") {
			this.failureCount++;
			if (this.failureCount >= this.failureThreshold) {
				this.trip();
			}
		}
	}

	private trip(): void {
		this.state = "OPEN";
		this.nextAttempt = Date.now() + this.recoveryTimeMs;
	}

	reset(): void {
		this.state = "CLOSED";
		this.failureCount = 0;
		this.successCount = 0;
		this.nextAttempt = 0;
	}
}
