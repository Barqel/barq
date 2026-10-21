// SQLite constraint removal by table rebuild.
//
// SQLite cannot drop an inline/table-level constraint (`constraint "x" …`)
// with `alter table`. The supported workaround is its documented rebuild
// procedure: create a new table with the constraint removed, copy the rows,
// drop the old table, rename the new one, and recreate the indexes. This
// module rewrites the original `create table` statement from `sqlite_master`
// — byte-for-byte apart from the removed clause — so every other column,
// default and constraint survives untouched.

import { SchemaError } from "../errors";

/** A `create index` statement to replay after a rebuild. @internal */
export interface RebuildIndex {
	readonly name: string;
	/** Original `create index` SQL (still valid after the rename). */
	readonly sql: string;
}

/** Escapes a SQLite identifier for interpolation into a statement. @internal */
export function quoteSqlite(name: string): string {
	return `"${name.replaceAll('"', '""')}"`;
}

/**
 * Rewrites a `create table` statement with the named constraint removed.
 * Returns `null` when the statement declares no such constraint.
 * @internal
 */
export function stripNamedConstraint(
	createSql: string,
	constraint: string,
): string | null {
	const loose = new RegExp(
		`constraint\\s+["'\`]?${constraint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]?`,
		"i",
	);
	const match = loose.exec(createSql);
	if (match === null) return null;
	const index = match.index;
	// Walk to the end of the clause: the next comma at parenthesis depth 0,
	// or the table body's closing parenthesis.
	let depth = 0;
	let end = -1;
	for (let i = index; i < createSql.length; i += 1) {
		const char = createSql[i]!;
		if (char === "(") depth += 1;
		else if (char === ")") {
			if (depth === 0) {
				end = i;
				break;
			}
			depth -= 1;
		} else if (char === "," && depth === 0) {
			end = i;
			break;
		}
	}
	if (end === -1) return null;
	const before = createSql.slice(0, index).replace(/[\s,]+$/, " ");
	const after = createSql.slice(end);
	return `${before}${after.startsWith(",") ? after.slice(1) : after}`;
}

/** Renames the table inside a `create table` statement. @internal */
export function withTableName(createSql: string, name: string): string {
	const pattern = /^(\s*create\s+table\s+(?:if\s+not\s+exists\s+)?)\S+/i;
	if (!pattern.test(createSql)) {
		throw new SchemaError(
			`SQLite rebuild: could not rewrite the create statement for "${name}".`,
		);
	}
	return createSql.replace(
		pattern,
		(_match, head: string) => `${head}${quoteSqlite(name)}`,
	);
}

/** The ordered statements that rebuild `table` without one constraint. */
export interface RebuildPlan {
	/** Fully quoted new-table name used while copying. */
	readonly tempTable: string;
	/** Statements to run, in order, inside one transaction. */
	readonly statements: readonly string[];
}

/**
 * Plans the rebuild of `table` without the constraint named `constraint`.
 * @internal
 */
export function planSqliteRebuild(options: {
	readonly table: string;
	readonly createSql: string;
	readonly constraint: string;
	readonly columns: readonly string[];
	readonly indexes: readonly RebuildIndex[];
}): RebuildPlan {
	const { table, constraint, columns, indexes } = options;
	const stripped = stripNamedConstraint(options.createSql, constraint);
	if (stripped === null) {
		throw new SchemaError(
			`dropUnique("${constraint}") / dropForeign("${constraint}") on SQLite: "${table}" declares no constraint with that name. Drop and recreate the table instead.`,
		);
	}
	if (columns.length === 0) {
		throw new SchemaError(
			`dropUnique("${constraint}") / dropForeign("${constraint}") on SQLite: "${table}" declares no columns.`,
		);
	}
	const tempTable = `${table}__barq_rebuild`;
	const quotedColumns = columns.map(quoteSqlite).join(", ");
	const statements: string[] = [
		// The original statement, retargeted at the scratch table name.
		withTableName(stripped, tempTable),
		`insert into ${quoteSqlite(tempTable)} (${quotedColumns}) select ${quotedColumns} from ${quoteSqlite(table)}`,
		`drop table ${quoteSqlite(table)}`,
		`alter table ${quoteSqlite(tempTable)} rename to ${quoteSqlite(table)}`,
	];
	for (const index of indexes) {
		statements.push(index.sql);
	}
	return { tempTable, statements };
}
