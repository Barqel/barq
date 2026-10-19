// Migrations.
//
// ```ts
// export default {
//   async up({ schema }) {
//     await schema.create("users", (t) => { t.id(); t.string("email").unique(); });
//   },
//   async down({ schema }) {
//     await schema.drop("users");
//   },
// };
// ```
//
// The runner records applied migrations in a bookkeeping table
// (`barq_migrations` by default), applies pending ones in name order inside
// one batch, and rolls back whole batches. PostgreSQL and SQLite run each
// migration inside a transaction (their DDL is transactional); MySQL DDL
// auto-commits, so migrations there are documented as non-atomic.
//
// A migration lock prevents two runners from applying the same batch:
// PostgreSQL uses `pg_advisory_lock`, MySQL uses `GET_LOCK`, and SQLite needs
// none (single writer).

import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { MigrationError } from "../errors";
import type { Orm } from "../orm";
import { SchemaBuilder } from "../schema/builder";
import type { Schema } from "../schema/columns";

/** Context handed to every migration. */
export interface MigrationContext<S extends Schema> {
	/** DDL entry point — transaction-aware. */
	readonly schema: SchemaBuilder<S>;
	/** The owning ORM (raw SQL, transactions, data backfills). */
	readonly orm: Orm<S>;
	/** Executes raw SQL with bindings. */
	execute(sql: string, parameters?: readonly unknown[]): Promise<void>;
}

/** A migration module. */
export interface Migration<S extends Schema = Schema> {
	readonly name: string;
	up(context: MigrationContext<S>): Promise<void> | void;
	down(context: MigrationContext<S>): Promise<void> | void;
}

export interface MigratorOptions<S extends Schema> {
	/** Migrations, applied in `name` order. */
	migrations: ReadonlyArray<Migration<S>>;
	/** Bookkeeping table name. Defaults to `barq_migrations`. */
	table?: string;
}

/** One row of `Migrator.status()`. */
export interface MigrationStatus {
	name: string;
	ran: boolean;
	batch: number | null;
}

/** Result of `Migrator.migrate()`. */
export interface MigrateResult {
	applied: string[];
	batch: number;
}

/** One migration's compiled statements from `Migrator.pretend()`. */
export interface PretendMigration {
	migration: string;
	direction: "up" | "down";
	statements: string[];
}

const DEFAULT_TABLE = "barq_migrations";
const TABLE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface MigrationRecord {
	name: string;
	batch: number;
}

/** Internal compile boundary. */
type AnyStatement = any;

/** Applies and rolls back migrations. */
export class Migrator<S extends Schema> {
	readonly #orm: Orm<S>;
	readonly #migrations: ReadonlyArray<Migration<S>>;
	readonly #table: string;

	constructor(orm: Orm<S>, options: MigratorOptions<S>) {
		const table = options.table ?? DEFAULT_TABLE;
		if (!TABLE_PATTERN.test(table)) {
			throw new MigrationError(
				`Invalid migrations table name ${JSON.stringify(table)}.`,
			);
		}
		const seen = new Set<string>();
		for (const migration of options.migrations) {
			if (seen.has(migration.name)) {
				throw new MigrationError(
					`Duplicate migration name "${migration.name}".`,
				);
			}
			seen.add(migration.name);
		}
		this.#orm = orm;
		this.#migrations = [...options.migrations].sort((left, right) =>
			left.name.localeCompare(right.name),
		);
		this.#table = table;
	}

	/** Creates the bookkeeping table when missing. */
	async ensureTable(): Promise<void> {
		const schema = this.#orm.schemaBuilder();
		if (await schema.hasTable(this.#table)) return;
		await schema.create(this.#table, (table) => {
			table.string("name", 255).primary();
			table.integer("batch");
			table.datetime("ranAt").nullable();
		});
	}

	/** Names + applied state, in migration order. */
	async status(): Promise<MigrationStatus[]> {
		await this.ensureTable();
		const records = await this.#records();
		const batchByName = new Map(
			records.map((record) => [record.name, record.batch]),
		);
		return this.#migrations.map((migration) => ({
			name: migration.name,
			ran: batchByName.has(migration.name),
			batch: batchByName.get(migration.name) ?? null,
		}));
	}

	/** Applies every pending migration as one batch. */
	async migrate(): Promise<MigrateResult> {
		await this.ensureTable();
		await this.#acquireLock();
		try {
			const records = await this.#records();
			const ran = new Set(records.map((record) => record.name));
			const pending = this.#migrations.filter(
				(migration) => !ran.has(migration.name),
			);
			const highest = records.reduce(
				(max, record) => Math.max(max, record.batch),
				0,
			);
			if (pending.length === 0) {
				return { applied: [], batch: highest };
			}
			const batch = highest + 1;
			const applied: string[] = [];
			for (const migration of pending) {
				await this.#run(migration, "up");
				await this.#insertRecord(migration.name, batch);
				applied.push(migration.name);
			}
			return { applied, batch };
		} finally {
			await this.#releaseLock();
		}
	}

	/** Rolls back the last `steps` batches (default 1). */
	async rollback(steps = 1): Promise<string[]> {
		if (!Number.isInteger(steps) || steps < 1) {
			throw new MigrationError(
				`rollback(): steps must be a positive integer, got ${steps}.`,
			);
		}
		await this.ensureTable();
		await this.#acquireLock();
		try {
			const records = await this.#records();
			const batches = [...new Set(records.map((record) => record.batch))]
				.sort((left, right) => right - left)
				.slice(0, steps);
			if (batches.length === 0) return [];
			const byName = new Map(
				this.#migrations.map((migration) => [migration.name, migration]),
			);
			const rolledBack: string[] = [];
			for (const batch of batches) {
				const inBatch = records
					.filter((record) => record.batch === batch)
					.sort((left, right) => right.name.localeCompare(left.name));
				for (const record of inBatch) {
					const migration = byName.get(record.name);
					if (migration === undefined) {
						throw new MigrationError(
							`Cannot roll back "${record.name}": the migration file is missing.`,
							{ migration: record.name },
						);
					}
					await this.#run(migration, "down");
					await this.#deleteRecord(record.name);
					rolledBack.push(record.name);
				}
			}
			return rolledBack;
		} finally {
			await this.#releaseLock();
		}
	}

	// -----------------------------------------------------------------------
	// fresh / refresh / reset / pretend
	// -----------------------------------------------------------------------

	/**
	 * Rolls back every applied migration (all batches).
	 */
	async reset(): Promise<string[]> {
		await this.ensureTable();
		const records = await this.#records();
		const batches = new Set(records.map((record) => record.batch));
		if (batches.size === 0) return [];
		return this.rollback(batches.size);
	}

	/** `reset()` followed by `migrate()` — Eloquent's `migrate:refresh`. */
	async refresh(): Promise<MigrateResult> {
		await this.reset();
		return this.migrate();
	}

	/**
	 * Drops **every table in the database** and re-runs all migrations
	 * (Eloquent's `migrate:fresh`). Destructive by design — point it at a
	 * scratch database. PostgreSQL drops with `cascade`; MySQL disables
	 * foreign-key checks around the drops.
	 */
	async fresh(): Promise<MigrateResult> {
		await this.ensureTable();
		const tables = await this.#orm.executor().introspection.getTables();
		const names = tables
			.map((table) => table.name)
			.filter((name) => TABLE_PATTERN.test(name));
		const kind = this.#orm.dialectKind;
		if (kind === "mysql") {
			await this.#orm.raw("set foreign_key_checks = 0");
		}
		try {
			for (const name of names) {
				if (kind === "postgres") {
					await this.#orm.raw(`drop table if exists "${name}" cascade`);
				} else if (kind === "mysql") {
					await this.#orm.raw(`drop table if exists \`${name}\``);
				} else {
					await this.#orm.raw(`drop table if exists "${name}"`);
				}
			}
		} finally {
			if (kind === "mysql") {
				await this.#orm.raw("set foreign_key_checks = 1");
			}
		}
		return this.migrate();
	}

	/**
	 * Compiles the SQL of every pending migration **without executing it**
	 * (Eloquent's `migrate --pretend`). Statements carry bind placeholders —
	 * the same text a database log would show.
	 */
	async pretend(): Promise<PretendMigration[]> {
		await this.ensureTable();
		const records = await this.#records();
		const ran = new Set(records.map((record) => record.name));
		const pending = this.#migrations.filter(
			(migration) => !ran.has(migration.name),
		);
		const output: PretendMigration[] = [];
		for (const migration of pending) {
			const { statements } = await this.#orm.captureStatements(async () => {
				await migration.up(this.#context(this.#orm));
			});
			output.push({
				migration: migration.name,
				direction: "up",
				statements,
			});
		}
		return output;
	}

	// -----------------------------------------------------------------------
	// internals
	// -----------------------------------------------------------------------

	#context(orm: Orm<S>): MigrationContext<S> {
		return {
			schema: orm.schemaBuilder(),
			orm,
			execute: async (sql: string, parameters: readonly unknown[] = []) => {
				await orm.raw(sql, parameters);
			},
		};
	}

	async #run(migration: Migration<S>, direction: "up" | "down"): Promise<void> {
		// PostgreSQL and SQLite have transactional DDL — a failed migration
		// leaves no partial schema. MySQL auto-commits DDL, so wrapping it in a
		// transaction would create a false sense of atomicity.
		if (this.#orm.dialectKind === "mysql") {
			try {
				await migration[direction](this.#context(this.#orm));
			} catch (cause) {
				throw new MigrationError(
					`Migration "${migration.name}" failed while running "${direction}".`,
					{ migration: migration.name, cause },
				);
			}
			return;
		}
		try {
			await this.#orm.transaction(async () => {
				await migration[direction](this.#context(this.#orm));
			});
		} catch (cause) {
			throw new MigrationError(
				`Migration "${migration.name}" failed while running "${direction}".`,
				{ migration: migration.name, cause },
			);
		}
	}

	async #records(): Promise<MigrationRecord[]> {
		const result = await this.#orm.execute(
			(this.#orm.executor() as AnyStatement)
				.selectFrom(this.#table)
				.selectAll()
				.orderBy("batch")
				.orderBy("name")
				.compile(),
		);
		return (result.rows as Array<Record<string, unknown>>).map((row) => ({
			name: String(row.name),
			batch: Number(row.batch),
		}));
	}

	async #insertRecord(name: string, batch: number): Promise<void> {
		await this.#orm.execute(
			(this.#orm.executor() as AnyStatement)
				.insertInto(this.#table)
				.values({ name, batch, ranAt: new Date() })
				.compile(),
		);
	}

	async #deleteRecord(name: string): Promise<void> {
		await this.#orm.execute(
			(this.#orm.executor() as AnyStatement)
				.deleteFrom(this.#table)
				.where("name", "=", name)
				.compile(),
		);
	}

	async #acquireLock(): Promise<void> {
		const kind = this.#orm.dialectKind;
		if (kind === "postgres") {
			await this.#orm.raw("select pg_advisory_lock(hashtext($1))", [
				this.#table,
			]);
			return;
		}
		if (kind === "mysql") {
			const result = await this.#orm.raw("select get_lock(?, ?) as acquired", [
				this.#table,
				10,
			]);
			const acquired = Number(
				(result.rows[0] as { acquired?: unknown } | undefined)?.acquired ?? 0,
			);
			if (acquired !== 1) {
				throw new MigrationError(
					"Could not acquire the migration lock within 10 seconds — another migrator is running.",
				);
			}
		}
		// SQLite: a single writer per database file; no lock needed.
	}

	async #releaseLock(): Promise<void> {
		const kind = this.#orm.dialectKind;
		if (kind === "postgres") {
			await this.#orm.raw("select pg_advisory_unlock(hashtext($1))", [
				this.#table,
			]);
			return;
		}
		if (kind === "mysql") {
			await this.#orm.raw("select release_lock(?)", [this.#table]);
		}
	}
}

/**
 * Loads `*.ts` / `*.js` migration modules from a directory.
 * Each module exports `up` and `down` (or a default object with both).
 * Sorted by filename — prefix with `0001_`, `0002_`, … for a stable order.
 */
export async function loadMigrations<S extends Schema = Schema>(
	directory: string,
): Promise<Array<Migration<S>>> {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = entries
		.filter((entry) => entry.isFile() && /\.(?:[cm]?[jt]s)$/.test(entry.name))
		.map((entry) => entry.name)
		.sort();
	const migrations: Array<Migration<S>> = [];
	for (const file of files) {
		const fullPath = path.join(directory, file);
		let module: { up?: unknown; down?: unknown; default?: unknown };
		try {
			module = (await import(pathToFileURL(fullPath).href)) as typeof module;
		} catch (cause) {
			throw new MigrationError(`Could not load migration "${file}".`, {
				cause,
			});
		}
		const exported = (module.default ?? module) as {
			up?: unknown;
			down?: unknown;
		};
		if (typeof exported.up !== "function") {
			throw new MigrationError(
				`Migration "${file}" does not export an "up" function.`,
			);
		}
		if (typeof exported.down !== "function") {
			throw new MigrationError(
				`Migration "${file}" does not export a "down" function.`,
			);
		}
		migrations.push({
			name: file.replace(/\.(?:[cm]?[jt]s)$/, ""),
			up: exported.up as Migration<S>["up"],
			down: exported.down as Migration<S>["down"],
		});
	}
	return migrations;
}
