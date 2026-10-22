// Typed event contracts.
//
// An event is a value — `defineEvent` returns a small object that carries
// the event name (used by the bus) plus a type-only payload marker:
//
//   export const userCreated = defineEvent<UserCreatedPayload>("user.created");
//
// The same value drives both sides of the bus, so payloads are checked
// end-to-end without any global registry:
//
//   eventBus().emit(userCreated, payload);        // producer — checked
//   bus.on(userCreated, (payload) => { … });      // consumer — typed

/** A typed event contract created by `defineEvent`. */
export interface EventDefinition<P = unknown> {
	/** Event name used by the bus (e.g. `"user.created"`). */
	readonly name: string;

	/** Type-only marker — never present at runtime. */
	readonly __payload: P;
}

/** Payload type of an event contract. */
export type EventPayload<E extends EventDefinition> = E["__payload"];

/**
 * Creates a typed event contract.
 *
 *   const userCreated = defineEvent<UserCreatedPayload>("user.created");
 */
export function defineEvent<P>(name: string): EventDefinition<P> {
	return { name } as EventDefinition<P>;
}
