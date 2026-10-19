// Model factories and seeders.
//
// ```ts
// const user = await User.factory()
//   .define({ name: (index) => `User ${index}`, email: (index) => `user${index}@example.com` })
//   .state({ active: true })
//   .count(3)
//   .create({ active: false });   // Collection<User>
// ```
//
// Definitions are value-or-function maps: a function receives the row index
// (0-based within the factory instance) and returns the value. Values go
// through the same mass-assignment filtering and casts as `Model.create()`,
// so `fillable` / `guarded` behave exactly like Eloquent.
//
// Seeders are plain functions or `{ run(orm) }` objects:
//
// ```ts
// await runSeeders(orm, [seedUsers, { run: (orm) => orm.table("teams").insert({...}).run() }]);
// ```

import { Collection } from "../collection";
import { SchemaError } from "../errors";
import type { Orm } from "../orm";
import type { CreateValues } from "../query/types";
import type { Schema, TableName } from "../schema/define";

/** A factory value: a literal, or a function of the 0-based row index. */
export type FactoryValue<V> = V | ((index: number) => V);

/** Definition map for one model — every create value, all optional. */
export type FactoryDefinition<S extends Schema, T extends TableName<S>, M> = {
	[K in keyof CreateValues<M, S, T>]?: FactoryValue<CreateValues<M, S, T>[K]>;
};

/** Instance-building callbacks supplied by `Model.factory()` (internal). */
export interface FactoryHandlers<M> {
	make: (values: Record<string, unknown>) => M;
	create: (values: Record<string, unknown>) => Promise<M>;
}

/**
 * Fluent factory (Eloquent's `Model::factory()`).
 *
 * ```ts
 * const users = await User.factory()
 *   .define({ email: (index) => `user${index}@example.com` })
 *   .count(2)
 *   .create();
 * ```
 */
export class Factory<S extends Schema, T extends TableName<S>, M> {
	readonly #handlers: FactoryHandlers<M>;
	#definition: Record<string, unknown> = {};
	#states: Array<Record<string, unknown>> = [];
	#count = 1;
	#sequence = 0;

	/** @internal */
	constructor(handlers: FactoryHandlers<M>) {
		this.#handlers = handlers;
	}

	/** Merges attribute defaults; chainable. */
	define(definition: FactoryDefinition<S, T, M>): this {
		this.#definition = { ...this.#definition, ...definition };
		return this;
	}

	/** Adds a state applied after `define` (call repeatedly to stack). */
	state(definition: FactoryDefinition<S, T, M>): this {
		this.#states.push(definition as Record<string, unknown>);
		return this;
	}

	/** Number of models produced by `make()` / `create()` (default 1). */
	count(count: number): this {
		if (!Number.isInteger(count) || count < 0) {
			throw new SchemaError(
				`Factory.count(): expected a non-negative integer, got ${count}.`,
			);
		}
		this.#count = count;
		return this;
	}

	/** Builds unsaved model instances. */
	make(overrides: FactoryDefinition<S, T, M> = {}): Collection<M> {
		const rows = this.#rows(overrides as Record<string, unknown>);
		return Collection.make(rows.map((row) => this.#handlers.make(row)));
	}

	/** Builds and persists models (one insert per model, events fire). */
	async create(
		overrides: FactoryDefinition<S, T, M> = {},
	): Promise<Collection<M>> {
		const rows = this.#rows(overrides as Record<string, unknown>);
		const created: M[] = [];
		for (const row of rows) created.push(await this.#handlers.create(row));
		return Collection.make(created);
	}

	/** Builds one unsaved instance (ignores `count`, does not advance it). */
	makeOne(overrides: FactoryDefinition<S, T, M> = {}): M {
		return this.#handlers.make(
			this.#rows(overrides as Record<string, unknown>, 1)[0] ?? {},
		);
	}

	/** Builds and persists one instance. */
	async createOne(overrides: FactoryDefinition<S, T, M> = {}): Promise<M> {
		const row = this.#rows(overrides as Record<string, unknown>, 1)[0] ?? {};
		return this.#handlers.create(row);
	}

	#rows(
		overrides: Record<string, unknown>,
		count = this.#count,
	): Array<Record<string, unknown>> {
		const rows: Array<Record<string, unknown>> = [];
		for (let offset = 0; offset < count; offset += 1) {
			const index = this.#sequence + offset;
			const row: Record<string, unknown> = {};
			for (const source of [this.#definition, ...this.#states, overrides]) {
				for (const [column, value] of Object.entries(source)) {
					row[column] =
						typeof value === "function"
							? (value as (index: number) => unknown)(index)
							: value;
				}
			}
			rows.push(row);
		}
		this.#sequence += count;
		return rows;
	}
}

/** A seeder: Eloquent-style object or a plain async function. */
export interface Seeder<S extends Schema> {
	run(orm: Orm<S>): Promise<void> | void;
}

export type SeederLike<S extends Schema> =
	| Seeder<S>
	| ((orm: Orm<S>) => unknown);

/** Helper that types a seeder without losing the ORM generic. */
export function defineSeeder<S extends Schema>(
	seeder: SeederLike<S>,
): SeederLike<S> {
	return seeder;
}

/** Runs seeders in order (`db:seed`). */
export async function runSeeders<S extends Schema>(
	orm: Orm<S>,
	seeders: ReadonlyArray<SeederLike<S>>,
): Promise<void> {
	for (const seeder of seeders) {
		if (typeof seeder === "function") {
			await seeder(orm);
		} else {
			await seeder.run(orm);
		}
	}
}
