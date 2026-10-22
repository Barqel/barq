// Custom pivot models — Eloquent's `Pivot` class and `belongsToMany(..., { using })`.
//
// ```ts
// class Membership extends orm.pivot("role_user") {
//   static casts = { note: "string", grantedAt: "datetime" } as const;
// }
//
// const roles = belongsToMany(Role, {
//   through: "role_user",
//   foreignPivotKey: "userId",
//   relatedPivotKey: "roleId",
//   withPivot: ["note", "grantedAt"],
//   using: Membership,
// });
// ```
//
// Eager-loaded pivots become instances of the custom class with casts applied
// on read (`pivot.get("note")`) and on write (`attach` / `updateExistingPivot`
// prepare values through the casts' `set` side). Pivot models are not full
// models: they carry no events, dirty tracking or query methods — matching
// Eloquent, where bulk pivot writes bypass model events too.

import { SchemaError } from "../errors";
import {
	type CastContext,
	type CastSpec,
	type ResolvedCast,
	resolveCast,
} from "../model/casts";

const PIVOT_TOKEN = Symbol("barq.pivot");
const PIVOT_CASTS = new WeakMap<
	object,
	Readonly<Record<string, ResolvedCast>>
>();

/** Instance surface of a pivot model. */
export interface PivotLike {
	/** Column value with casts applied. */
	get(column: string): unknown;
	/** Assigns a value; casts are applied like on a model attribute. */
	set(column: string, value: unknown): PivotLike;
	/** Raw attributes (database form). */
	attributes(): Record<string, unknown>;
	/** Attributes in database form, casts' `set` side applied. */
	toDatabase(): Record<string, unknown>;
	toJSON(): Record<string, unknown>;
}

/** A pivot model class created through `orm.pivot(table)`. */
export interface PivotClass {
	new (...args: never[]): PivotLike;
	readonly __pivotTable: string;
	readonly casts?: Readonly<Record<string, CastSpec>>;
}

/** Constructor shape accepted by the `using` option. */
export type PivotClassLike = abstract new (...args: never[]) => PivotLike;

/** Base class returned by `orm.pivot(table)`. */
export type PivotBase = PivotClass & { readonly __pivotTable: string };

/** Pivot model base — extend the class returned by `orm.pivot(table)`. */
export class Pivot implements PivotLike {
	/** @internal */ _attributes: Record<string, unknown> = {};
	/** @internal */ _casts: Readonly<Record<string, ResolvedCast>> = {};

	protected constructor(token?: symbol) {
		if (token !== PIVOT_TOKEN) {
			throw new SchemaError(
				"Pivot models are hydrated by the ORM and cannot be constructed directly.",
			);
		}
	}

	get(column: string): unknown {
		const cast = this._casts[column];
		const raw = this._attributes[column];
		return cast === undefined ? raw : cast.get(raw);
	}

	set(column: string, value: unknown): this {
		const cast = this._casts[column];
		this._attributes[column] =
			cast === undefined ? value : cast.get(cast.set(value));
		return this;
	}

	attributes(): Record<string, unknown> {
		return { ...this._attributes };
	}

	toDatabase(): Record<string, unknown> {
		const output: Record<string, unknown> = {};
		for (const [column, value] of Object.entries(this._attributes)) {
			const cast = this._casts[column];
			output[column] = cast === undefined ? value : cast.set(value);
		}
		return output;
	}

	toJSON(): Record<string, unknown> {
		const output: Record<string, unknown> = {};
		for (const column of Object.keys(this._attributes)) {
			output[column] = this.get(column);
		}
		return output;
	}
}

const TABLE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Creates a pivot base class bound to one pivot table. @internal */
export function createPivotBase(table: string): PivotBase {
	if (!TABLE_PATTERN.test(table)) {
		throw new SchemaError(
			`orm.pivot(${JSON.stringify(table)}): the pivot table name must match ${TABLE_PATTERN}.`,
		);
	}
	const Bound = class extends Pivot {};
	Object.defineProperty(Bound, "__pivotTable", {
		value: table,
		enumerable: false,
		configurable: true,
	});
	return Bound as unknown as PivotBase;
}

function pivotCasts(
	pivotClass: unknown,
	encryptionKey: string | undefined,
): Readonly<Record<string, ResolvedCast>> {
	const cached = PIVOT_CASTS.get(pivotClass as object);
	if (cached !== undefined) return cached;
	const cls = pivotClass as {
		casts?: Readonly<Record<string, CastSpec>>;
		__pivotTable?: string;
	};
	const table = cls.__pivotTable ?? "pivot";
	const resolved: Record<string, ResolvedCast> = {};
	for (const [column, spec] of Object.entries(cls.casts ?? {})) {
		const context: CastContext = { table, column, encryptionKey };
		resolved[column] = resolveCast(spec, context);
	}
	PIVOT_CASTS.set(pivotClass as object, resolved);
	return resolved;
}

/** Hydrates one pivot row into an instance of a custom pivot model. @internal */
export function instantiatePivot(
	pivotClass: unknown,
	attributes: Record<string, unknown>,
	encryptionKey: string | undefined,
): Pivot {
	const cls = pivotClass as new (token?: symbol) => Pivot;
	const instance = new cls(PIVOT_TOKEN);
	instance._casts = pivotCasts(pivotClass, encryptionKey);
	instance._attributes = { ...attributes };
	return instance;
}

/**
 * Applies a pivot model's casts (the `set` side) to write values. Also
 * validates the given columns against `withPivot` at the call site. @internal
 */
export function preparePivotValues(
	pivotClass: unknown,
	values: Readonly<Record<string, unknown>>,
	encryptionKey: string | undefined,
): Record<string, unknown> {
	const casts = pivotCasts(pivotClass, encryptionKey);
	const output: Record<string, unknown> = {};
	for (const [column, value] of Object.entries(values)) {
		const cast = casts[column];
		output[column] = cast === undefined ? value : cast.set(value);
	}
	return output;
}

/** Whether a value is a pivot model class created by `orm.pivot()`. @internal */
export function isPivotClass(value: unknown): value is PivotClass {
	return (
		typeof value === "function" &&
		typeof (value as { __pivotTable?: unknown }).__pivotTable === "string"
	);
}
