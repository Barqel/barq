// Predicate AST and its compilation onto Kysely expressions.
//
// The builder records a flat, ordered list of `WhereEntry` values. Each entry
// carries how it links to the previous one ("and" / "or"), so `a and b or c`
// folds left-to-right — the same shape Laravel produces. Nested callbacks
// become `group` / `negate` predicates that fold recursively.

import type { Expression, ExpressionBuilder } from "kysely";
import type { DialectKind } from "../errors";
import { InvalidQueryError } from "../errors";
import { type RawExpression, raw, rawToKysely } from "./raw";

export type Predicate =
	| {
			readonly kind: "basic";
			readonly column: string;
			readonly operator: string;
			readonly value: unknown;
	  }
	| {
			readonly kind: "in";
			readonly column: string;
			readonly values: readonly unknown[];
			readonly not: boolean;
	  }
	| { readonly kind: "null"; readonly column: string; readonly not: boolean }
	| {
			readonly kind: "between";
			readonly column: string;
			readonly range: readonly [unknown, unknown];
			readonly not: boolean;
	  }
	| { readonly kind: "raw"; readonly expression: RawExpression }
	| {
			readonly kind: "custom";
			readonly build: (eb: ExpressionBuilder<any, any>) => unknown;
	  }
	| { readonly kind: "group"; readonly entries: readonly WhereEntry[] }
	| { readonly kind: "negate"; readonly entries: readonly WhereEntry[] };

export interface WhereEntry {
	readonly boolean: "and" | "or";
	readonly predicate: Predicate;
}

const KNOWN_OPERATORS = new Set([
	"=",
	"==",
	"!=",
	"<>",
	">",
	">=",
	"<",
	"<=",
	"like",
	"not like",
	"ilike",
]);

function normalizeOperator(operator: string, dialect: DialectKind): string {
	const normalized = operator.trim().toLowerCase();
	if (!KNOWN_OPERATORS.has(normalized)) {
		throw new InvalidQueryError(
			`Unknown comparison operator ${JSON.stringify(operator)}. Known operators: ${[...KNOWN_OPERATORS].join(", ")}.`,
		);
	}
	if (normalized === "==") return "=";
	if (normalized === "ilike") {
		// MySQL and SQLite LIKE are case-insensitive by default.
		return dialect === "postgres" ? "ilike" : "like";
	}
	return normalized;
}

/** ExpressionBuilder with erased generics — internal compile surface only. */
type AnyBuilder = ExpressionBuilder<any, any>;
type BoolExpression = Expression<any>;

/**
 * A dialect-portable tautology, used when a predicate folds to nothing.
 * @internal
 */
export function trueExpression(eb: AnyBuilder): BoolExpression {
	return eb(eb.val(1), "=", eb.val(1));
}

function compileOne(
	eb: AnyBuilder,
	predicate: Predicate,
	dialect: DialectKind,
): BoolExpression | undefined {
	switch (predicate.kind) {
		case "basic": {
			if (predicate.value === undefined) {
				throw new InvalidQueryError(
					`where(${JSON.stringify(predicate.column)}): undefined is not a valid comparison value. Use whereNull() or pass null explicitly.`,
				);
			}
			const operator = normalizeOperator(predicate.operator, dialect);
			if (predicate.value === null) {
				if (operator === "=") return eb(eb.ref(predicate.column), "is", null);
				if (operator === "!=" || operator === "<>") {
					return eb(eb.ref(predicate.column), "is not", null);
				}
				throw new InvalidQueryError(
					`where(${JSON.stringify(predicate.column)}): operator "${operator}" cannot be used with null. Use whereNull() / whereNotNull().`,
				);
			}
			return eb(
				eb.ref(predicate.column),
				operator as Parameters<AnyBuilder>[1],
				predicate.value,
			);
		}
		case "in": {
			if (predicate.values.length === 0) {
				// Predictable empty-array behavior: `IN ()` is a contradiction,
				// `NOT IN ()` is a tautology.
				return rawToKysely(raw(predicate.not ? "1 = 1" : "1 = 0"));
			}
			return eb(
				eb.ref(predicate.column),
				predicate.not ? "not in" : "in",
				predicate.values,
			);
		}
		case "null":
			return eb(
				eb.ref(predicate.column),
				predicate.not ? "is not" : "is",
				null,
			);
		case "between": {
			const between = eb.between(
				eb.ref(predicate.column),
				predicate.range[0],
				predicate.range[1],
			);
			return predicate.not ? eb.not(between) : between;
		}
		case "raw":
			return rawToKysely(predicate.expression);
		case "custom":
			return predicate.build(eb) as BoolExpression;
		case "group":
			return foldEntries(eb, predicate.entries, dialect);
		case "negate": {
			const inner = foldEntries(eb, predicate.entries, dialect);
			return inner === undefined
				? undefined
				: (eb.unary("not", inner as never) as BoolExpression);
		}
	}
}

/**
 * Folds an ordered entry list into a single boolean expression.
 * Returns `undefined` when the list has nothing to compile.
 * @internal
 */
export function foldEntries(
	eb: AnyBuilder,
	entries: readonly WhereEntry[],
	dialect: DialectKind,
): BoolExpression | undefined {
	if (entries.length === 0) return undefined;

	let result: BoolExpression | undefined;
	for (const entry of entries) {
		const next = compileOne(eb, entry.predicate, dialect);
		if (next === undefined) continue;
		if (result === undefined) {
			result = next;
			continue;
		}
		result =
			entry.boolean === "or" ? eb.or([result, next]) : eb.and([result, next]);
	}
	return result;
}
