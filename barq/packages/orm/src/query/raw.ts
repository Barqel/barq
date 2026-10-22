// Safe raw SQL fragments.
//
// `raw()` is the only way to inject a SQL string into a query. Bindings use
// `?` placeholders and are validated to match the number of placeholders, so
// raw fragments never silently interpolate untrusted values.
//
// LIMITATION: `?` characters inside SQL string literals are not supported —
// count the placeholders yourself and pass every value through `parameters`.

import type { RawBuilder } from "kysely";
import { sql } from "kysely";
import { type DialectKind, QueryError } from "../errors";

const RAW_BRAND: unique symbol = Symbol.for("@barqel/barq-orm/raw");

/** Quotes one SQL identifier for the given dialect. @internal */
export function quoteIdentifier(name: string, dialect: DialectKind): string {
	if (dialect === "mysql") return `\`${name.replaceAll("`", "``")}\``;
	return `"${name.replaceAll('"', '""')}"`;
}

/** Quotes a possibly dotted reference part by part. @internal */
export function quoteReference(
	reference: string,
	dialect: DialectKind,
): string {
	return reference
		.split(".")
		.map((part) => quoteIdentifier(part, dialect))
		.join(".");
}

/** A raw SQL fragment with explicit bindings. */
export interface RawExpression<T = unknown> {
	readonly [RAW_BRAND]: true;
	readonly sql: string;
	readonly parameters: readonly unknown[];
	/** Phantom type for callers that want to annotate the result. */
	readonly __type?: T;
}

/**
 * Creates a raw SQL expression.
 *
 * ```ts
 * User.query().whereRaw(raw("length(name) > ?", [5]));
 * ```
 */
export function raw<T = unknown>(
	sqlText: string,
	parameters: readonly unknown[] = [],
): RawExpression<T> {
	const placeholders = sqlText.split("?").length - 1;
	if (placeholders !== parameters.length) {
		throw new QueryError(
			`Raw SQL expects ${placeholders} parameter(s) but received ${parameters.length}.`,
			{ sql: sqlText, parameters },
			"RAW_PARAMETER_MISMATCH",
		);
	}
	return { [RAW_BRAND]: true, sql: sqlText, parameters };
}

/** @internal */
export function isRawExpression(value: unknown): value is RawExpression {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { [RAW_BRAND]?: unknown })[RAW_BRAND] === true
	);
}

/**
 * Converts a raw expression into a Kysely builder.
 * @internal
 */
export function rawToKysely(expression: RawExpression): RawBuilder<unknown> {
	const fragments = expression.sql.split("?");
	let builder = sql`${sql.raw(fragments[0] ?? "")}`;
	expression.parameters.forEach((parameter, index) => {
		builder = sql`${builder}${parameter}${sql.raw(fragments[index + 1] ?? "")}`;
	});
	return builder;
}
