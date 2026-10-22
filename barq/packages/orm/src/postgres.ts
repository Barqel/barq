// PostgreSQL entry point.
//
// `pg` is an optional peer dependency — install it when you import this
// module: `bun add pg`.

import type { Dialect } from "kysely";
import { PostgresDialect } from "kysely";

export interface PostgresOptions {
	/** Connection string (`postgres://user:pass@host:5432/database`). Takes precedence. */
	uri?: string;
	host?: string;
	port?: number;
	user?: string;
	password?: string;
	database?: string;
	/** Pool size. Default 10. */
	max?: number;
	/** TLS options forwarded to pg. */
	ssl?: boolean | Record<string, unknown>;
}

/**
 * Creates a PostgreSQL dialect. The `pg` module is imported lazily, so
 * applications that never call `postgres()` do not need it installed.
 */
export function postgres(options: PostgresOptions = {}): Dialect {
	return new PostgresDialect({
		pool: async () => {
			// `pg` is imported lazily and typed structurally: applications that
			// do not use PostgreSQL never load it, and consumers do not need
			// `@types/pg` installed to type-check their own code. The specifier
			// is a variable so TypeScript does not try to resolve its types.
			const pgModuleName = "pg";
			const pg = (await import(pgModuleName)) as unknown as {
				Pool: new (config: Record<string, unknown>) => unknown;
				types?: {
					getTypeParser: (
						oid: number,
						format?: string,
					) => (value: string) => unknown;
				};
			};
			// PostgreSQL's int8 can exceed Number.MAX_SAFE_INTEGER. Keep the
			// exact decimal string on this pool only (never by mutating pg's
			// process-wide parser registry); the ORM's row plan converts each
			// schema column to the type it promises (`number` by default,
			// `bigint` when BigInt mode is enabled).
			const types =
				pg.types === undefined
					? undefined
					: {
							getTypeParser: (oid: number, format?: string) =>
								oid === 20
									? (value: string) => value
									: pg.types!.getTypeParser(oid, format),
						};
			const pool =
				options.uri !== undefined
					? new pg.Pool({
							connectionString: options.uri,
							max: options.max ?? 10,
							ssl: options.ssl,
							types,
						})
					: new pg.Pool({
							host: options.host ?? "localhost",
							port: options.port ?? 5432,
							user: options.user ?? "postgres",
							password: options.password ?? "",
							database: options.database,
							max: options.max ?? 10,
							ssl: options.ssl,
							types,
						});
			return pool as never;
		},
	});
}
