// Base class for event listeners — the listener class carries the whole
// contract: the event name, the payload shape and the handler.
//
//   @injectable()
//   export class UserCreatedListener extends Listener.of<{
//     name: string;
//     email: string;
//   }>("user.created") {
//     async handle(payload: PayloadOf<this>): Promise<void> {
//       await sendWelcomeEmail(payload.email);
//     }
//   }
//
// Register the class in `barq.config.ts` (`listeners: [...]`), scaffold it
// with `listener:make user.created`, and emit the event anywhere with the
// class itself — `eventBus().emit(UserCreatedListener.event, payload)` —
// checked against the payload declared above. Listeners may inject
// services: add `@injectable()` when they do.

import {
	defineEvent,
	type EventBus,
	type EventDefinition,
	type EventListener,
} from "@barqel/barq-events";
import { container, type InjectionToken } from "tsyringe";

export abstract class Listener<P = unknown> {
	/** The event contract this listener subscribes to. */
	abstract readonly event: EventDefinition<P>;

	/** Handle one event payload. Default `emit` runs listeners in parallel. */
	abstract handle(payload: P): void | Promise<void>;

	/**
	 * Binds a listener class to one event — the payload is the explicit
	 * type argument, the event name is the runtime argument:
	 *
	 *   export class UserCreatedListener extends Listener.of<UserCreatedPayload>("user.created") {
	 *     async handle(payload: PayloadOf<this>): Promise<void> { … }
	 *   }
	 */
	static of<P>(name: string): ListenerFactory<P> {
		abstract class Bound extends Listener<P> {
			static readonly event = defineEvent<P>(name);
			readonly event = Bound.event;
		}

		return Bound;
	}
}

/**
 * A listener bound to one event — the class `Listener.of()` returns.
 * `event` is provided by the binding; `handle()` stays abstract.
 */
export type BoundListener<P> = Listener<P> & {
	readonly event: EventDefinition<P>;
};

/** The constructor returned by `Listener.of()` — carries the static event. */
export type ListenerFactory<P> = (abstract new () => BoundListener<P>) & {
	readonly event: EventDefinition<P>;
};

/** Payload type of a listener class — write `PayloadOf<this>` in `handle()`. */
export type PayloadOf<C extends { event: EventDefinition }> =
	C["event"]["__payload"];

export type ListenerClass = new (...args: never[]) => Listener;

/** Subscribes every registered `Listener` class to the bus. */
export function registerListeners(
	bus: EventBus,
	listenerClasses: ListenerClass[],
): void {
	for (const ListenerClass of listenerClasses) {
		const listener = container.resolve(
			ListenerClass as unknown as InjectionToken<Listener>,
		);

		const handler: EventListener = (payload) =>
			listener.handle(payload as never);

		bus.on(listener.event, handler);
	}
}
