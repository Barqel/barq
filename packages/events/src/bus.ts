import type { EventBusOptions, EventListener } from "./types";

interface ListenerWrapper {
	fn: EventListener;
	once: boolean;
}

export class EventBus<TEvents extends Record<string, any> = Record<string, any>> {
	private readonly listeners = new Map<string, Set<ListenerWrapper>>();
	private readonly wildcardListeners = new Set<{ pattern: RegExp; wrapper: ListenerWrapper }>();
	private readonly options: EventBusOptions;

	constructor(options: EventBusOptions = {}) {
		this.options = {
			wildcards: true,
			delimiter: ".",
			maxListeners: 50,
			...options,
		};
	}

	on<K extends keyof TEvents & string>(event: K, listener: EventListener<TEvents[K]>): () => void;
	on(event: string, listener: EventListener): () => void;
	on(event: string, listener: EventListener): () => void {
		return this.addListener(event, listener, false);
	}

	once<K extends keyof TEvents & string>(event: K, listener: EventListener<TEvents[K]>): () => void;
	once(event: string, listener: EventListener): () => void;
	once(event: string, listener: EventListener): () => void {
		return this.addListener(event, listener, true);
	}

	off(event: string, listener: EventListener): void {
		if (this.options.wildcards && event.includes("*")) {
			for (const item of this.wildcardListeners) {
				if (item.wrapper.fn === listener) {
					this.wildcardListeners.delete(item);
				}
			}
			return;
		}

		const set = this.listeners.get(event);
		if (!set) return;

		for (const item of set) {
			if (item.fn === listener) {
				set.delete(item);
				break;
			}
		}

		if (set.size === 0) {
			this.listeners.delete(event);
		}
	}

	async emit<K extends keyof TEvents & string>(event: K, payload: TEvents[K]): Promise<void>;
	async emit(event: string, payload?: unknown): Promise<void>;
	async emit(event: string, payload?: unknown): Promise<void> {
		return this.emitParallel(event, payload);
	}

	async emitParallel(event: string, payload?: unknown): Promise<void> {
		const matched = this.collectListeners(event);
		if (matched.length === 0) return;

		const promises = matched.map(async (wrapper) => {
			try {
				await Promise.resolve(wrapper.fn(payload, event));
			} catch (err) {
				this.handleError(err, event, payload);
			}
		});

		await Promise.all(promises);
	}

	async emitSerial(event: string, payload?: unknown): Promise<void> {
		const matched = this.collectListeners(event);
		for (const wrapper of matched) {
			try {
				await Promise.resolve(wrapper.fn(payload, event));
			} catch (err) {
				this.handleError(err, event, payload);
			}
		}
	}

	emitSync(event: string, payload?: unknown): void {
		const matched = this.collectListeners(event);
		for (const wrapper of matched) {
			try {
				const result = wrapper.fn(payload, event);
				if (result && typeof (result as any).catch === "function") {
					(result as any).catch((err: unknown) => this.handleError(err, event, payload));
				}
			} catch (err) {
				this.handleError(err, event, payload);
			}
		}
	}

	clear(): void {
		this.listeners.clear();
		this.wildcardListeners.clear();
	}

	private addListener(event: string, fn: EventListener, once: boolean): () => void {
		const wrapper: ListenerWrapper = { fn, once };

		if (this.options.wildcards && event.includes("*")) {
			const escaped = event.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
			const pattern = new RegExp(`^${escaped}$`);
			this.wildcardListeners.add({ pattern, wrapper });
			return () => this.off(event, fn);
		}

		let set = this.listeners.get(event);
		if (!set) {
			set = new Set();
			this.listeners.set(event, set);
		}
		set.add(wrapper);

		return () => this.off(event, fn);
	}

	private collectListeners(event: string): ListenerWrapper[] {
		const out: ListenerWrapper[] = [];

		const exact = this.listeners.get(event);
		if (exact) {
			for (const item of exact) {
				out.push(item);
				if (item.once) exact.delete(item);
			}
			if (exact.size === 0) this.listeners.delete(event);
		}

		if (this.options.wildcards && this.wildcardListeners.size > 0) {
			for (const item of this.wildcardListeners) {
				if (item.pattern.test(event)) {
					out.push(item.wrapper);
					if (item.wrapper.once) this.wildcardListeners.delete(item);
				}
			}
		}

		return out;
	}

	private handleError(err: unknown, event: string, payload: unknown): void {
		if (this.options.onError) {
			this.options.onError(err, event, payload);
		} else {
			console.error(`[EventBus] Error in listener for "${event}":`, err);
		}
	}
}
