// Model events and observers.
//
// The Laravel event map, adapted to a typed API:
//
//   saving   → fired before both inserts and updates; returning `false`
//              cancels the operation
//   creating → fired before an insert        (cancelable)
//   updating → fired before an update        (cancelable)
//   deleting → fired before a delete or soft delete (cancelable)
//   restoring / forceDeleting → soft-delete gates (cancelable)
//   created / updated / deleted / retrieved / trashed / restored /
//   forceDeleted / saved / replicating → notifications, return value ignored
//
// Listeners are registered per model class and live in a WeakMap, so classes
// created by `orm.model()` are garbage-collectable. `withoutModelEvents()`
// suppresses every event through AsyncLocalStorage — safe under concurrency.

import { AsyncLocalStorage } from "node:async_hooks";
import { InvalidModelUsageError } from "../errors";

export type ModelEventName =
	| "retrieved"
	| "creating"
	| "created"
	| "saving"
	| "saved"
	| "updating"
	| "updated"
	| "deleting"
	| "deleted"
	| "trashed"
	| "restoring"
	| "restored"
	| "forceDeleting"
	| "forceDeleted"
	| "replicating";

/** Every supported event name. */
export const MODEL_EVENT_NAMES: readonly ModelEventName[] = [
	"retrieved",
	"creating",
	"created",
	"saving",
	"saved",
	"updating",
	"updated",
	"deleting",
	"deleted",
	"trashed",
	"restoring",
	"restored",
	"forceDeleting",
	"forceDeleted",
	"replicating",
];

/** Pivot-relation events (belongsToMany / morphToMany writes). */
export type PivotEventName =
	| "pivotAttaching"
	| "pivotAttached"
	| "pivotDetaching"
	| "pivotDetached"
	| "pivotUpdating"
	| "pivotUpdated";

/** Every supported pivot event name. */
export const PIVOT_EVENT_NAMES: readonly PivotEventName[] = [
	"pivotAttaching",
	"pivotAttached",
	"pivotDetaching",
	"pivotDetached",
	"pivotUpdating",
	"pivotUpdated",
];

const EVENT_NAME_SET = new Set<string>([
	...MODEL_EVENT_NAMES,
	...PIVOT_EVENT_NAMES,
]);

/** Events whose listeners may cancel the operation by returning `false`. */
const GATE_EVENTS = new Set<ModelEventName>([
	"creating",
	"saving",
	"updating",
	"deleting",
	"restoring",
	"forceDeleting",
]);

/** Pivot events whose listeners may cancel the write by returning `false`. */
const PIVOT_GATE_EVENTS = new Set<PivotEventName>([
	"pivotAttaching",
	"pivotDetaching",
	"pivotUpdating",
]);

/** A model event listener. Return `false` on a gate event to cancel. */
export type ModelEventListener<ModelType = unknown> = (
	model: ModelType,
) => boolean | void | Promise<boolean | void>;

/**
 * Payload handed to pivot event listeners. `model` is the parent (owning)
 * model instance, matching Eloquent's `pivotAttached($model, $relation, …)`.
 */
export interface PivotEventPayload<ModelType = unknown> {
	/** Parent model that owns the relation. */
	readonly model: ModelType;
	/** Relation name, e.g. `"roles"`. */
	readonly relation: string;
	/** Related ids involved in the write (`null` means “every pivot row”). */
	readonly ids: readonly unknown[] | null;
	/** Extra pivot attributes (empty for detach). */
	readonly attributes: Readonly<Record<string, unknown>>;
}

/** A pivot event listener. Return `false` on a gate event to cancel. */
export type PivotEventListener<ModelType = unknown> = (
	payload: PivotEventPayload<ModelType>,
) => boolean | void | Promise<boolean | void>;

/** An observer: every supported model and pivot event maps to a handler. */
export type ModelObserver<ModelType = unknown> = Partial<
	Record<ModelEventName, ModelEventListener<ModelType>>
> &
	Partial<Record<PivotEventName, PivotEventListener<ModelType>>>;

type AnyListener = (payload: unknown) => unknown;

const REGISTRY = new WeakMap<object, Map<string, Set<AnyListener>>>();
const SUPPRESS = new AsyncLocalStorage<true>();

function listenersFor(
	cls: object,
	event: string,
	create: boolean,
): Set<AnyListener> | undefined {
	let byEvent = REGISTRY.get(cls);
	if (byEvent === undefined) {
		if (!create) return undefined;
		byEvent = new Map();
		REGISTRY.set(cls, byEvent);
	}
	let listeners = byEvent.get(event);
	if (listeners === undefined) {
		if (!create) return undefined;
		listeners = new Set();
		byEvent.set(event, listeners);
	}
	return listeners;
}

function assertEventName(
	event: string,
): asserts event is ModelEventName | PivotEventName {
	if (!EVENT_NAME_SET.has(event)) {
		throw new InvalidModelUsageError(
			`Unknown model event "${event}". Supported events: ${[
				...MODEL_EVENT_NAMES,
				...PIVOT_EVENT_NAMES,
			].join(", ")}.`,
		);
	}
}

/**
 * Registers a listener for one event on a model class.
 * Returns an unsubscribe function.
 */
export function onModelEvent(
	cls: object,
	event: ModelEventName,
	listener: AnyListener,
): () => void {
	assertEventName(event);
	if (typeof listener !== "function") {
		throw new InvalidModelUsageError(
			`on(${JSON.stringify(event)}): the listener must be a function.`,
		);
	}
	const set = listenersFor(cls, event, true)!;
	set.add(listener);
	return () => {
		set.delete(listener);
	};
}

/**
 * Registers a listener for one pivot event on the **parent** model class
 * (Eloquent's `pivotAttached`, `pivotDetaching`, …).
 * Returns an unsubscribe function.
 */
export function onPivotEvent(
	cls: object,
	event: PivotEventName,
	listener: (payload: PivotEventPayload) => unknown,
): () => void {
	assertEventName(event);
	if (typeof listener !== "function") {
		throw new InvalidModelUsageError(
			`on(${JSON.stringify(event)}): the listener must be a function.`,
		);
	}
	const set = listenersFor(cls, event, true)!;
	set.add(listener as AnyListener);
	return () => {
		set.delete(listener as AnyListener);
	};
}

/** Whether `name` is a pivot event (rather than a model event). @internal */
export function isPivotEventName(name: string): name is PivotEventName {
	return (PIVOT_EVENT_NAMES as readonly string[]).includes(name);
}

/**
 * Registers a full observer object on a model class (Eloquent `observe()`).
 * Returns an unsubscribe function that removes every handler.
 */
export function observeModel(
	cls: object,
	observer: Record<string, unknown>,
): () => void {
	if (typeof observer !== "object" || observer === null) {
		throw new InvalidModelUsageError(
			"observe(): expected an object of event handlers.",
		);
	}
	for (const key of Object.keys(observer)) {
		assertEventName(key);
		if (typeof observer[key] !== "function") {
			throw new InvalidModelUsageError(
				`observe(): "${key}" must be a function.`,
			);
		}
	}
	const offs: Array<() => void> = [];
	for (const [event, handler] of Object.entries(observer)) {
		offs.push(
			isPivotEventName(event)
				? onPivotEvent(cls, event, handler as AnyListener)
				: onModelEvent(cls, event as ModelEventName, handler as AnyListener),
		);
	}
	return () => {
		for (const off of offs) off();
	};
}

/**
 * Fires an event. Gate events return `false` as soon as a listener cancels;
 * notification events always return `true`.
 * @internal
 */
export async function emitModelEvent(
	cls: object,
	event: ModelEventName,
	model: unknown,
): Promise<boolean> {
	if (SUPPRESS.getStore() === true) return true;
	const listeners = listenersFor(cls, event, false);
	if (listeners === undefined || listeners.size === 0) return true;
	const gate = GATE_EVENTS.has(event);
	for (const listener of [...listeners]) {
		const result = await listener(model);
		if (gate && result === false) return false;
	}
	return true;
}

/**
 * Fires a pivot event on the parent model class. Gate events return `false`
 * as soon as a listener cancels; notification events always return `true`.
 * @internal
 */
export async function emitPivotEvent(
	cls: object,
	event: PivotEventName,
	payload: PivotEventPayload,
): Promise<boolean> {
	if (SUPPRESS.getStore() === true) return true;
	const listeners = listenersFor(cls, event, false);
	if (listeners === undefined || listeners.size === 0) return true;
	const gate = PIVOT_GATE_EVENTS.has(event);
	for (const listener of [...listeners]) {
		const result = await listener(payload);
		if (gate && result === false) return false;
	}
	return true;
}

/**
 * Runs `callback` with model events suppressed (Eloquent `withoutEvents`).
 */
export function withoutModelEvents<T>(
	callback: () => Promise<T> | T,
): Promise<T> {
	return SUPPRESS.run(true, async () => callback());
}
