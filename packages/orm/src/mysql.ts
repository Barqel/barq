// MySQL/MariaDB entry point.
//
// `mysql2` is an optional peer dependency — install it when you import this
// module: `bun add mysql2`.

import type { Dialect } from "kysely";
import { MysqlDialect } from "kysely";

export interface MysqlOptions {
	/** Connection string (`mysql://user:pass@host:3306/database`). Takes precedence. */
	uri?: string;
	host?: string;
	port?: number;
	user?: string;
	password?: string;
	database?: string;
	/** Pool size. Default 10. */
	connectionLimit?: number;
	/** TLS options forwarded to mysql2. */
	ssl?: boolean | Record<string, unknown>;
}

/**
 * Creates a MySQL dialect. The `mysql2` module is imported lazily, so
 * applications that never call `mysql()` do not need it installed.
 */
export function mysql(options: MysqlOptions = {}): Dialect {
	if (options.uri !== undefined) {
		const uri = options.uri;
		return new MysqlDialect({
			pool: async () => {
				const { createPool } = await import("mysql2");
				// Kysely's MySQL driver expects mysql2's callback-style pool
				// (`getConnection(cb)` / `end(cb)`), not `mysql2/promise`.
				// `supportBigNumbers` makes mysql2 return values above the safe
				// integer range as strings, preserving all 64 bits.
				return createPool({
					uri,
					supportBigNumbers: true,
					bigNumberStrings: true,
					dateStrings: false,
				}) as never;
			},
		});
	}
	return new MysqlDialect({
		pool: async () => {
			const { createPool } = await import("mysql2/promise");
			return createPool({
				host: options.host ?? "localhost",
				port: options.port ?? 3306,
				user: options.user ?? "root",
				password: options.password ?? "",
				database: options.database,
				connectionLimit: options.connectionLimit ?? 10,
				ssl: options.ssl as never,
				supportBigNumbers: true,
				bigNumberStrings: true,
				dateStrings: false,
			}) as never;
		},
	});
}
