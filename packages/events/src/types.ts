export type EventListener<T = any> = (payload: T, eventName: string) => void | Promise<void>;

export interface EventBusOptions {
	wildcards?: boolean;
	delimiter?: string;
	maxListeners?: number;
	onError?: (error: unknown, event: string, payload: unknown) => void;
}
