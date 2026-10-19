# Final report — `@barqel/barq-orm` v1.0.0

Honest engineering report. Every command below was executed in this workspace;
outputs are verbatim (trimmed only where marked). Anything not verified here is
called out as **not verified** rather than assumed.

---

## 1. What was implemented

### 1.1 Typed schema layer

- `defineSchema({...})` with column types `string` (+ length), `text`,
  `integer`, `bigint`, `float`, `double`, `decimal`, `boolean`, `date`,
  `datetime`, `json`, `uuid`, `binary`; flags `primaryKey`, `autoIncrement`,
  `generated`, `nullable`, `default`, `defaultNow`, `bigInt` and decimal
  precision/scale. The DDL builder adds `unique`, `references` (with
  on-delete/on-update actions) and table indexes.
- BigInt mode is schema-driven: `bigInt: true` on one column or
  `defineSchema(schema, { bigInt: true })` globally changes the column's value
  type from `number` to `bigint` and triggers exact driver reads.
- The schema is the single source of truth: it produces table row types, insert
  payloads (`Generated<T>` columns optional on insert, present on select),
  update payloads, filter value types and migration context types.

### 1.2 Query builder (`orm.table("…")`) — lightweight typed rows

- Filters: `where` / `orWhere` (column-op-value, 2-arg equality, callback
  groups, `null`/`undefined` → `is null`/`is not null`), `whereNot`/
  `orWhereNot`, `whereIn`/`whereNotIn`, `whereNull`/`whereNotNull`,
  `whereBetween`/`whereNotBetween`/`orWhereNotBetween`, `whereColumn`,
  `whereAny`/`whereAll`/`whereNone`, `whereRaw`, `when(condition, callback)`,
  `unless(condition, callback)`.
- Integer literal lists and correlated subqueries: `whereIntegerInRaw`/
  `whereIntegerNotInRaw` inline validated integers with no bindings (empty
  lists compile to `1 = 0` / `1 = 1`); `whereExists`/`whereNotExists`/
  `orWhereExists`/`orWhereNotExists` take a callback or a sub-builder;
  `selectSub(subquery, "alias")` adds a correlated scalar column.
- Date/time and JSON: `whereDate`, `whereTime`, `whereDay`, `whereMonth`,
  `whereYear`, `whereJsonContains`, `whereJsonLength` (dialect-specific SQL).
- Relations in the builder: nested `whereHas`/`orWhereHas`/
  `whereDoesntHave`/`orWhereDoesntHave`, `whereRelation`, `whereBelongsTo`,
  `whereHasMorph`, `withExists`, and `withWhereHas` (both existence filter and
  eager-load constraint). Aggregate calls accept constraint callbacks that
  constrain the correlated subquery: `withCount({ posts: (q) =>
  q.where("published", true) })`, `withSum("posts", "views", callback)`, and
  the generic `withAggregate("posts", { function: "max", column: "views" })`.
- Joins: `join`, `innerJoin`, `leftJoin` with `on`/`onRef` conditions; joined
  columns become filterable/selectable with qualified references.
- Grouping: `groupBy`, `groupByRaw`, `having`, `havingRaw`.
- Ordering/limits: `orderBy`, `orderByRaw`, `latest`, `oldest`,
  `inRandomOrder`, `reorder`, `limit`, `offset`, `lockForUpdate`/`sharedLock`
  (MySQL/PG; no-op on SQLite).
- Set operations: `union`/`unionAll` (same `Orm` instance required; column
  lists must line up; results hydrate through the base query's plan).
- Pagination: `paginate` (total), `simplePaginate` (no total), `cursorPaginate`
  (forward-only keyset), `chunk`, `chunkById`, `lazy`, `lazyById`, `cursor`.
- Terminals: `get`, `first`, `firstOrFail`, `firstWhere`, `value`, `sole`,
  `soleValue`, `find`, `findOrFail`, `findMany`, `pluck`, `exists`,
  `doesntExist`, `count`, `sum`, `avg`, `min`, `max`, `toSQL`.
- First-or variants: `firstOr`, `findOr`, `findOrNew`, `firstOrNew`,
  `firstOrCreate`, `updateOrCreate`.
- Writes: `insert`, `insertMany`, `insertOrIgnore`, `update`, `updateOrInsert`,
  `delete`, `upsert`, `truncate`, `incrementEach`/`decrementEach`, `create`
  (model-backed), atomic `increment`/`decrement` on numeric columns.
- BigInt mode: filters/bindings, insert ids, updates, plucks and
  `min`/`max`/`sum` keep the full signed 64-bit range as `bigint`; `avg`
  remains a fractional `number`. MySQL and PostgreSQL aggregate strings are
  converted before they reach typed callers.
- Raw escape hatches: `orm.raw(sql, params)` (verbatim, dialect placeholders),
  `raw("…", [params])` expressions usable via raw select/order/group/filter
  methods. Raw results stay driver-native; they do not pass through a schema
  row plan.

### 1.3 Models (`orm.model("table")` factory + subclass)

- `class User extends orm.model("users") { static relations = {…} }`.
- Statics: `create`, `createMany`, `find`, `findOrFail`, `findMany`, `query`,
  `all`, `firstOrCreate`, `updateOrCreate`, `createOrFirst` (insert-first for
  unique-key races), `firstOrNew`, `destroy(ids)`, `withTrashed`,
  `onlyTrashed`, `withoutGlobalScopes`, `exists`, `on`/`observe`,
  `withoutEvents`.
- Instances: `get`/`set` (typed), `save`/`saveQuietly`, `update`/
  `updateQuietly`, `delete`/`deleteQuietly`, `forceDeleteQuietly`,
  `restoreQuietly`, `refresh`, `replicate`, `fresh`, `touch`, `push`,
  `trashed`, `wasRecentlyCreated`, `exists`, `is`/`isNot`, `only`/`except`,
  `getKey`/`getKeyName`, `toJSON`/`toArray` (respect `hidden`/`visible`,
  include `appends` and loaded relations), `append(...names)` for ad-hoc
  serialized extras, atomic `increment`/`decrement` (+ `*Quietly` variants)
  that mirror the change on the instance, dirty tracking (`getDirty`,
  `isDirty`, `isClean`, `getChanges`, `getPrevious`, `getOriginal`,
  `syncOriginal`), and `fill`.
- Configuration (validated at runtime, all optional): `relations`, `fillable`
  (allow-list), `guarded` (deny-list), `casts` (`boolean`, `json`/`array`,
  `collection`, `stringable`, `date`/`datetime`, `decimal`, `number`, `string`,
  `encrypted`, `encrypted:array`, `encrypted:collection`, `hashed`, enum
  validation, class-based `static get`/`static set`, and object
  `{ get, set }`), `mutators`, `accessors`, `appends`,
  `hidden`, `visible`, `softDeletes`, `timestamps`, `morphAlias`, `touches`, and
  `globalScopes`/`scopes`.
- Cast pipeline: assignment applies the mutator, then `cast.set` + `cast.get`
  round-trip; hydration applies `get`; writes apply `set`; `hashed` is
  idempotent for values already prefixed with `scrypt:`.
- Soft deletes: `static softDeletes = true` (`deletedAt`) or
  `{ column }`; default scope, `withTrashed`, `onlyTrashed`, instance and
  builder `restore`/`forceDelete`; runtime `InvalidQueryError` when used
  without soft deletes.
- Events: `retrieved`, `creating`/`created`, `saving`/`saved`,
  `updating`/`updated`, `deleting`/`deleted`, `trashed`, `restoring`/`restored`,
  `forceDeleting`/`forceDeleted`, `replicating`. Gate listeners cancel by
  returning `false`; observers are plain objects; per-class WeakMap registry;
  `withoutEvents()` is concurrency-safe through `AsyncLocalStorage`.
- Mass-assignment protection: unknown keys throw `MassAssignmentError`
  (`fillable`/`guarded` semantics). Deliberately **not** declared on the static
  type, so users never need `static override`.

### 1.4 Relations + explicit eager loading (no N+1, no lazy loading)

- `hasMany`, `hasOne`, `belongsTo`, `belongsToMany` (pivot `through`,
  `foreignPivotKey`, `relatedPivotKey`, plus `withPivot` extras, `timestamps`
  and the `as` accessor rename), `hasManyThrough`, `hasOneThrough`,
  `morphMany`, `morphOne`, `morphTo`, `morphToMany`, `morphedByMany` (the
  inverse lookup over the same morph pivot). Relation keys and column names are
  type-checked against the related model (`hasMany(() => Post, "nope")` is a
  compile error; proven in the type tests).
- One-of-many relations: `latestOfMany`/`oldestOfMany`/`ofMany(() => Post,
  "userId", "views", "max")` build a `hasOne` selecting the extreme row per
  parent; `belongsTo` accepts `withDefault`/`withDefaultFor` to attach a
  placeholder owner when the foreign key dangles.
- Morph aliases resolve as `static morphAlias` → global `orm.morphMap({…})` →
  table name; `orm.morphClass(value)` maps an alias back to its class and
  `orm.morphMapEntries()` lists the registered map. `morphToMany` pivots also
  expose the `${name}Type` column.
- `with("posts", "posts.author", "profile")` — nested paths, typed results,
  merged per relation (no intersecting array types), 3 levels deep.
  Eager loading costs one batched statement per relation per level; morph-to
  adds one per concrete type and constrained through relations add one.
- Constrained eager loading: `with({ posts: (q) => q.where("published", true) })`
  and nested path keys, typed per related model.
- `withCount("posts")`/aliases, plus `withSum`/`withAvg`/`withMin`/`withMax`
  with typed nullable result keys (`postsSumViews`, …) and optional constraint
  callbacks, plus the generic `withAggregate(path, { function, column })`.
  BigInt-mode relation aggregates return `bigint` for sum/min/max and `number`
  for avg. `morphTo` is excluded from aggregates at the type level.
- `whereHas`, `orWhereHas`, `whereDoesntHave`, `orWhereDoesntHave` — nested
  paths compile to chained `EXISTS`. Morph-to can be tested bare, or constrained
  per alias with `whereHasMorph(path, ["posts"], callback)`.
- Relation write managers from an instance: `query`/`get`/`first`/`count`/
  `find`/`findOrFail`/`has`; `hasMany`/`hasOne` `create`/`createMany`/`save`/
  `saveMany`; `belongsTo` `associate`/`dissociate`; many-to-many `attach`/
  `detach`/`sync`/`syncWithoutDetaching`/`toggle`/`updateExistingPivot`/
  `syncWithPivotValues`. Pivot managers additionally filter and order through
  the pivot table with `wherePivot`/`wherePivotIn`/`orderByPivot` (the order
  compiles to a correlated `limit 1` scalar subquery). Wrong operation kinds
  throw `InvalidQueryError`. Through-relation managers support reads.
- Pivot hydration: eager `belongsToMany`/`morphToMany` results attach one pivot
  object per pair (independently cloned, renamed by `as`, timestamps/extra
  columns included, `${name}Type` for morph pivots). Manager `query()` results
  are plain related models — they do not carry pivot objects.
- Instance loaders: `load`, `loadMissing`, `loadCount`, `loadSum`, `loadAvg`,
  `loadMin`, `loadMax`, `loadAggregate`; these attach relationship extras at
  runtime and serialize them with the model.
- Accessing a non-loaded relation throws `RelationNotLoadedError`; in typed code
  it does not even compile.

### 1.5 Transactions

- `orm.transaction(async (tx) => {…}, { isolation?, retries? })` — pinned to a
  single connection via `AsyncLocalStorage`; `tx.table(...)` routes correctly.
- Nested `orm.transaction` calls become savepoints; partial rollback works.
- Bounded retries for retryable errors (`SQLITE_BUSY`, MySQL 1213/1205,
  PostgreSQL 40001/40P01) via `isRetryableTransactionError(error, dialect)`.
- SQLite serializes top-level transactions through a FIFO queue (single-writer
  engine); nested transactions use ORM-managed savepoints via raw SQL.

### 1.6 Schema builder + migrations

- `orm.schemaBuilder()`: `create(table, cb)` with `id`, `string`, `text`,
  `integer`, `bigint`, `float`, `decimal`, `boolean`, `datetime`, `date`, `json`,
  `blob`, `uuid`, `enum`, `timestamps`; plus `drop`, `dropIfExists`, `hasTable`.
- `new Migrator(orm, { migrations, table? })` with per-migration `up({ schema,
  orm, execute })` / `down(...)`; `migrate()` books one batch per run,
  `rollback()` reverses whole batches, `status()` reports. Bookkeeping table is
  configurable. Concurrent migrators serialize via `pg_advisory_lock` /
  `GET_LOCK` / no-op on SQLite. Transactional DDL on PostgreSQL/SQLite; MySQL
  documented as engine auto-commit.

### 1.7 Errors

Hierarchy under `BarqError`: `QueryError` (per-dialect translation),
`UniqueConstraintError`, `ForeignKeyConstraintError`, `NotNullConstraintError`,
`InvalidQueryError`, `ModelNotFoundError`, `RelationNotLoadedError`,
`SchemaError`, `CastError`, `MigrationError`, `TransactionError`,
`ConnectionError`. Original driver causes are preserved on `.cause`.

### 1.8 Testing helpers

- `compileOnlyOrm(schema, dialect)` (`@barqel/barq-orm/testing`): real Kysely
  compilers + DummyDriver — asserts generated SQL/bindings per dialect with no
  database.
- `onQuery(event => …)` listener for asserting statement counts (used to prove
  eager loading issues exactly 5 SELECTs for the canonical fixture).

### 1.9 Dialects

- SQLite: `bun:sqlite` (Bun) and `node:sqlite` (Node ≥ 24) — lazy-imported,
  runtime auto-detected, zero extra dependencies.
- MySQL (`mysql2`) and PostgreSQL (`pg`) — optional peer dependencies, lazily
  imported. SQL generation is covered by compile-only tests and the shared
  conformance suite is **verified live** against MySQL 8.4.11 and PostgreSQL
  16.15 and 18.6 (21 tests each). The entry points stay env-gated for local runs;
  `.github/workflows/orm.yml` provisions both engines as service containers and
  runs the entire suite with both URLs configured.
- SQLite BigInt mode enables `safeIntegers` automatically before the driver is
  created. The ORM passes the schema mode to the dialect through an internal
  capability symbol, so callers do not configure drivers separately.

---

### 1.10 Collections (`collect.js`)

- `Collection<T>` extends `Array<T>` and is returned by query `get()`/`pluck()`,
  pagination data, model `all`/`findMany`/`createMany`, relation-manager reads
  and eager-loaded to-many relations.
- Array ergonomics are preserved (index, length, spread, iteration, JSON) while
  Eloquent helpers return `Collection`: `all`/`toArray`/`toJSON`, `first`/`last`,
  `map`/`filter`/`reject`/`flatMap`/`flatten`/`collapse`, `each`/`tap`/`pipe`,
  `when`/`unless`, `contains`, `pluck`, `groupBy`/`keyBy`, `sortBy`/
  `sortByDesc`/`reverse`, `slice`/`merge`/`take`/`skip`/`chunk`, `unique`,
  `sum`/`avg`/`min`/`max`/`reduce`, and `where`/`whereIn`/`whereNotIn`/
  `whereNull`/`whereNotNull`/`whereBetween`.
- Model values are read through `Model.get()` inside collection helpers, so
  `pluck`, `sum`, `where`, `groupBy`, `keyBy` and aggregate helpers work on
  hydrated models as well as plain rows.
- `Collection` is backed by the installed `collect.js@4.36.1`; the type layer is
  hand-written and exported.

### 1.11 Scopes and lifecycle

- Global scopes are applied in the `QueryBuilder` constructor and can be removed
  all at once or by name via `withoutGlobalScopes(...)`; cloned builders do not
  reapply them.
- Named local scopes run through `query().scope(name, ...args)` and are typed
  with their argument tuple. `defineScopes(schema, table, {…})` and
  `defineGlobalScopes(schema, table, {…})` preserve literal names without a
  circular static initializer; explicit `LocalScope`/`GlobalScope` annotations
  remain supported.
- Lifecycle helpers: `fresh`, `touch`, `push`, `wasRecentlyCreated`, `is`/
  `isNot`, `only`/`except`, `getKey`/`getKeyName`, column-aware `isDirty`/
  `isClean`, `getChanges`/`getPrevious`/`syncOriginal`, quiet save/update/delete/
  force-delete/restore, and `static touches` (belongsTo owner `updatedAt`).

### 1.12 Advanced casts and Stringable

- `collection` → `Collection`; `stringable` → exported fluent `Stringable`.
- `encrypted:array` and `encrypted:collection` encrypt the JSON representation
  with AES-256-GCM and hydrate arrays/collections back.
- Enum casts validate both reads and writes; class-based casts use static
  `get`/`set` methods; object `{ get, set }` casts remain supported.
- Cast output narrowing is a documented runtime concern: `get()` stays typed
  from the schema, so `json` columns need `instanceof Collection` / `String(...)`
  when reading cast-specific values.

---
## 2. Key decisions and rationale

| # | Decision | Why |
| --- | --- | --- |
| 1 | Kysely as internal SQL engine; public API never imports Kysely types | Battle-tested compilation/parameterization; the package owns its API surface. Kysely `Expression` leak points are asserted, not exposed. |
| 2 | Two execution paths (rows vs models) sharing one builder | Raw speed when you want rows; behavior (casts, dirty tracking, events) when you want models. No hidden hydration cost. |
| 3 | Model config statics are runtime-validated, not type-declared | Avoids `static override` ceremony and impossible-to-satisfy generics; type inference stays structural (`RelationsOf<M>`, `CreateValues<M,S,T>`). |
| 4 | Relations target a structural `ModelLike`; columns recovered via phantom `readonly __schema?` marker | Enables `hasMany(() => Post, "userId")` key checking across cyclic model references without runtime overhead (marker is erased). |
| 5 | No lazy loading, ever | Prevents N+1 by construction; `with()` is the only way in, and limits are typed. |
| 6 | Eager loading via batched `where in` per relation level | One statement per level; proven by statement-count tests. |
| 7 | Dialect-specific upsert compilation | MySQL has no `ON CONFLICT`; hiding that would be a lie. MySQL conflict target is not expressible — documented. |
| 8 | Statement capture tests use DummyDriver | Deterministic SQL text assertion per dialect, fast, no servers. |
| 9 | Live MySQL/PG integration runs one shared body (`runDialectSuite`) and stays env-gated | The same conformance plan is verified against both engines, without making the default test command require infrastructure. |
| 10 | Transactions: ALS pinning + savepoints; SQLite top-level FIFO queue | Correctness under concurrency for a single-writer engine without lying about isolation. |
| 11 | Migrations: one batch per `migrate()`, rollback whole batches, advisory locks | Laravel-compatible mental model; concurrency-safe on servers that support it. |
| 12 | `toSQL()` folds where groups into one parenthesized group | Deterministic compiled output that tests can assert exactly; documented. |
| 13 | `orm.raw()` sends SQL verbatim; `raw()` expressions translate placeholders | No magic on top of user SQL; fragments still get per-dialect binding translation. |
| 14 | Casts store attribute-form values; assignment round-trips `get(set(value))` | Hydration and dirty tracking see the same representation, and custom casts cannot silently diverge between reads/writes. |
| 15 | Model events are per-class WeakMap listeners; suppression through ALS | No global registry leaks, classes stay GC-able, and concurrent `withoutEvents()` scopes cannot suppress each other. |
| 16 | Soft deletes are opt-in per model (`static softDeletes`) | No hidden global scopes on tables that never asked for them; misuse is a runtime `InvalidQueryError`. |
| 17 | `withCount`/`withSum`/… compile to correlated subqueries; `whereHas` to `EXISTS` | One statement, no N+1, and the shapes stay typed (`postsCount`, `postsSumViews`). |
| 18 | `morphTo` rejects generic constraints/aggregates at the type level and at runtime | There is no single target table; `whereHasMorph` is the explicit alias-scoped escape hatch. |
| 19 | `Collection` extends `Array` and is backed by `collect.js` | Preserves native array ergonomics and Laravel-flavoured helpers without reimplementing a collection runtime. Model attribute reads go through `get()`. |
| 20 | Relation managers are created from runtime descriptors; instance names stay runtime-validated | A base instance cannot see subclass static relation maps without runaway conditional types. `RelationManagerOf` recovers the typed surface; query eager loading remains fully typed. |
| 21 | Scope declarations use explicit helpers | TypeScript cannot contextually type a whole static initializer from the model base, and self-referential annotations can be circular. Helpers preserve literal names with a schema/table witness. |
| 22 | `withWhereHas` registers the same callback for existence and eager loading | Matches Laravel semantics and avoids two divergent filters. |
| 23 | Pivot hydration is eager-only; pivot constraints are manager-only | Pivot objects are per-pair artifacts of a batched load; managers read a flat related set. `wherePivot`/`orderByPivot` stay on the manager (ordering via a correlated `limit 1` subquery), never inside eager callbacks. |
| 24 | One-of-many eager picks one row (pk tiebreak); `whereHas`/aggregates use `= extreme` | A relation can only return one row, while existence/count stay predicate-based (Eloquent's two flavors). Ties are documented rather than hidden. |
| 25 | `morphedByMany` is the `morphToMany` descriptor with `inverse: true` | One pivot resolver instead of two; keys keep the declaring model's perspective and the type filter uses the related class's alias. |
| 26 | Morph aliases resolve `static morphAlias` → global map → table name | Per-class overrides stay authoritative; the global map is the escape hatch for type strings written elsewhere. Unresolvable `morphTo` manager rows throw `InvalidQueryError` instead of guessing. |

---

## 3. File inventory (this package)

```
src/
  index.ts                 public API assembly + re-exports
  orm.ts                   kernel: dialect kind, transactions (ALS), onQuery, raw
  errors.ts                BarqError hierarchy + per-dialect translation/retryability
  collection.ts            Array-backed Collection<T> + collect()
  support/stringable.ts    fluent immutable Stringable
  sqlite.ts / mysql.ts / postgres.ts   dialect entry points
  testing.ts               compileOnlyOrm (DummyDriver compilers)
  adapters/kysely.ts       KyselyTable<...> mapping (Generated<T>), createKysely
  drivers/sqlite.ts        bun:sqlite + node:sqlite driver (auto-detect, lazy)
  drivers/bigint-mode.ts   internal dialect capability for schema-driven BigInt reads
  query/builder.ts         query builder: filters, relations, pagination, writes, upsert
  query/types.ts           ColumnRef, RelationsOf, AllRelationPaths, LoadedUnion, page types
  query/hydrate.ts         result hydration: rows -> typed rows / model instances
  query/predicates.ts      where-group compilation
  query/raw.ts             raw() expression + placeholder translation
  schema/define.ts         defineSchema + type-level schema mapping
  schema/columns.ts        column descriptor builders
  schema/builder.ts        DDL DSL (create/drop/hasTable, timestamps, references)
  model/model.ts           model factory, statics, scopes, loaders, dirty tracking, hydration
  model/casts.ts           built-in/encrypted/hashed/collection/stringable/enum/class casts
  model/events.ts          model events, observers, gate listeners, ALS suppression
  relations/descriptors.ts relation factories + key typing (ModelLike, ColumnNamesOf)
  relations/eager.ts       batched eager loading + constraints + morph/through + aggregates
  relations/manager.ts     relation write managers + pivot operations + typed manager surface
  relations/of-many.ts     one-of-many extreme predicates + pick/default-owner helpers
  migrations/runner.ts     Migrator, batch bookkeeping, advisory locks

package root
  README.md                user guide (shipped in the tarball)
  LICENSE                  MIT license text (shipped in the tarball)
  package.json             exports, peer deps, repository/publish metadata
  benchmarks/run.ts        benchmark harness (raw/Kysely/Drizzle/ORM)

tests/
  unit/sqlite-driver.test.ts        4 tests — driver + Kysely adapter smoke
  unit/compile-sql.test.ts          35 tests — exact SQL/bindings per dialect
  unit/bigint.test.ts                7 tests — schema mode, validation, row conversion
  integration/sqlite.test.ts        38 tests — full stack on live SQLite
  integration/eloquent.test.ts      37 tests — Eloquent-parity batches
  integration/advanced.test.ts      27 tests — collections, managers, loaders, scopes,
                                    builder breadth, lifecycle, advanced casts
  integration/bigint.test.ts         8 tests — full 64-bit range on live SQLite
  integration/parity.test.ts        31 tests — Priority-1 parity (pivot options and
                                    hydration, one-of-many, withDefault, morph map)
  integration/dialect-suite.ts      21 tests — shared MySQL/PG conformance suite
  integration/dialect-rehearsal.test.ts  21 tests — same suite on live SQLite
  integration/mysql.test.ts         env-gated entry point (skips without URL)
  integration/postgres.test.ts      env-gated entry point (skips without URL)
  types/type-tests.ts               60 must-fail directives + shape assertions

Source: 14,961 lines of TypeScript across 28 files (strict, ESM, no `any` in the
public API). Tests: 7,148 lines across 13 TypeScript files (11 files executed by
`bun test`; `dialect-suite.ts` is imported and `type-tests.ts` is compile-only).

---

## 4. Commands actually run — verbatim results

All commands below were executed from `barq/packages/orm`.

### 4.1 Type checks

```
$ bun run typecheck
$ tsc -p tsconfig.json --noEmit
(no output — clean)

$ bun run typecheck:tests
$ tsc -p tsconfig.test.json
(no output — clean)
```

The second command compiles `src/**` + `tests/**` + `benchmarks/**` +
`examples/**` including the type-test file: **every `@ts-expect-error` in the
suite must be consumed for it to pass** — i.e. all 60 intended compile errors
(unknown tables/columns/filters, wrong insert payloads, bad relation keys/paths,
`with()` in row mode, unknown eager-load keys, non-numeric `increment`,
morph-to aggregates/constraints, missing local-scope arguments, unknown scope
names, pivot ids on the wrong manager shape, invalid `ofMany` directions,
`morphedByMany` key mismatches, missing pivot columns in `wherePivot`, BigInt
`number` misuse, …) fire exactly where expected, and every positive shape
assertion holds.

### 4.2 Lint and format

```
$ bunx biome check --write .   # only when applying fixes
Checked 46 files in 292ms. Fixed 2 files.

$ bun run check
$ biome check .
Checked 46 files in 234ms. No fixes applied.
```

### 4.3 Test suite

```
$ BARQ_ORM_MYSQL_URL=mysql://hassan-kerdash:…@127.0.0.1:3306/barq_orm_test \
  BARQ_ORM_PG_URL=postgres:///barq_orm_test?host=/var/run/postgresql \
  bun test
 250 pass
 0 fail
 1157 expect() calls
Ran 250 tests across 11 files. [5.56s]

$ BARQ_ORM_MYSQL_URL=mysql://root:secret@127.0.0.1:33306/barq_test \
  BARQ_ORM_PG_URL=postgres://postgres:secret@127.0.0.1:55432/barq_test \
  bun test
 250 pass
 0 fail
 1157 expect() calls
Ran 250 tests across 11 files. [5.64s]
```

The first run used the installed MySQL 8.4.11 and PostgreSQL 18.6 servers; the
second used the same MySQL 8.4 and PostgreSQL 16.15 service-container images as
`.github/workflows/orm.yml` (started locally with Podman). Both live server
suites contributed 21 passing tests each in both runs. Without the two
environment variables the same command is `208 pass, 2 skip, 0 fail`
(210 tests, 905 assertions): only the env-gated dialect entry points skip.
The count includes the 38-test SQLite suite, the 37-test Eloquent-parity
suite, the 27-test advanced suite, a 7-test BigInt unit suite, an 8-test live
BigInt suite, the 31-test Priority-1 parity suite, a 21-test rehearsal of the
shared MySQL/PostgreSQL suite against SQLite, and 42 live dialect tests
(21 MySQL + 21 PostgreSQL).

### 4.4 Runnable example (live run, in-memory SQLite)

```
$ bun run examples/blog.ts
migrations applied: 001_create_users_and_posts, 002_create_comments (batch 1)
posts page 1: total=3 lastPage=2 [ "On loops", "On compilers" ]
count posts with views > 5: 2
dirty before save: {
  views: 50,
}
dirty after save: false
Ada: postsCount=2 [ "On loops (1)", "On compilers (0)" ]
Grace: postsCount=1 [ "On COBOL (0)" ]
compiler authors: [ "Ada" ]
user JSON: {"id":1,"name":"Ada","settings":{"theme":"dark"},…,"postsCount":2,"posts":[…]}
transaction rolled back: changed my mind
after savepoint demo: kept= 1 discarded= 0
findOrFail(9999): ModelNotFoundError as expected

done.
```

Covers: migrations (2, one batch), pagination totals, aggregates, dirty
tracking, nested eager loading (`posts.comments`) with `withCount`, `whereHas`
callback, `hidden` + casts in `toJSON`, rollback, savepoint rollback, typed
errors.

### 4.5 Benchmarks (see §5 for methodology)

```
$ bun run bench --json benchmarks/results.json

| Workload | raw bun:sqlite | Kysely | Drizzle | Barq ORM |
| --- | ---: | ---: | ---: | ---: |
| selectByPk | 866170 ops/s | 89571 ops/s | 25199 ops/s | 32165 ops/s |
| selectMany50 | 40607 ops/s | 25477 ops/s | 10887 ops/s | 16907 ops/s |
| countPosts | 1614763 ops/s | 88537 ops/s | 55102 ops/s | 71056 ops/s |
| insertOne | 416270 ops/s | 65711 ops/s | 34287 ops/s | 44991 ops/s |
| updateOne | 1036127 ops/s | 111441 ops/s | 36784 ops/s | 52322 ops/s |
| eager10 | 14794 ops/s | 11773 ops/s | 5060 ops/s | 3013 ops/s |
| hydrate100 | 22837 ops/s | 15628 ops/s | 7085 ops/s | 10698 ops/s |
| modelFind | — | — | — | 31115 ops/s |
| modelEager10 | — | — | — | 3242 ops/s |

Median of 5 rounds after 50 warmup ops; each round runs the workload iterations back-to-back.
```

### 4.6 Build + pack

```
$ bun run build
Bundled 156 modules in 24ms
  index.js 0.35 MB / sqlite.js 6.43 KB / mysql.js 1.0 KB / postgres.js 0.98 KB / testing.js 0.34 MB (+ maps)
(tsc --emitDeclarationOnly produced per-module .d.ts)

$ bun pm pack --destination /tmp/opencode/orm-smoke-final/pack
Total files: 69
Shasum: 358cc26dda3156b9acf60613313e7d84767ad5df
Integrity: sha512-EBouytGxNDl62[...]T4GLYD3Dpf/Og==
Unpacked size: 2.66MB  Packed size: 0.48MB
```

### 4.7 Packed-package smoke test on both runtimes and live dialects

The tarball was extracted with its `kysely` dependency into a clean temp
directory and exercised **against `dist/` only** — no source imports:

```
$ (cd consumer && bun smoke.mjs)
[bun 1.4.2] packed BigInt smoke OK

$ (cd consumer && /home/hassan-kerdash/.nvm/versions/node/v24.21.0/bin/node smoke.mjs)
[node v24.21.0] packed BigInt smoke OK

$ (cd consumer && bunx tsc --noEmit --strict --target ES2022 --module ESNext \
    --moduleResolution Bundler --skipLibCheck packed-typecheck.ts)
(no output — clean)

$ (cd consumer && BARQ_ORM_MYSQL_URL=… BARQ_ORM_PG_URL=… bun dialects.mjs)
[mysql] packed live dialect BigInt smoke OK
[postgres] packed live dialect BigInt smoke OK

$ (cd consumer && BARQ_ORM_MYSQL_URL=… BARQ_ORM_PG_URL=… \
    /home/hassan-kerdash/.nvm/versions/node/v24.21.0/bin/node dialects.mjs)
[mysql] packed live dialect BigInt smoke OK
[postgres] packed live dialect BigInt smoke OK
```

The tarball was installed into a clean consumer that imports only
`@barqel/barq-orm`; no source imports are involved. The SQLite smoke covers the
full `bigint` range, auto-increment ids, model CRUD, eager relations, relation
aggregates, raw SQL, `toSQL`, collections and transactional rollback. The
separate packed type-check asserts `RowOf`/insert/aggregate shapes and rejects
`number` for BigInt columns against the emitted declarations. The packed live
dialect smoke ran against both live engines under both runtimes, using the
PostgreSQL 16.15 and 18.6 servers; it covers a `MAX` signed 64-bit value, model
insert ids, relation aggregates and raw SQL (which remains a decimal string on
both server drivers), plus rollback and cleanup.

---

## 5. Test / verification strategy and results

### 5.1 What each layer proves

| Layer | How | Proves |
| --- | --- | --- |
| Unit — driver/adapter (4 tests) | live in-memory SQLite through the Kysely adapter | driver contract: DDL, `returning`, transactions, raw execution |
| Unit — SQL compilation (35 tests) | `onQuery` capture with DummyDriver, per dialect | exact SQL text + bindings: select/insert/upsert/update/delete/joins/whereHas/`ilike`, aggregate subqueries and constraint callbacks, soft-delete SELECT/DML, `increment`/`decrement`, `inRandomOrder`/`whereNotBetween`/`orWhereNot`, integer raw lists (empty-list constants), `whereExists`/`selectSub`, `union`/`unionAll`, ofMany extreme predicates, morph alias filters (`morphToMany`/`morphedByMany`) and pivot-manager SQL (validated operators), MySQL `on duplicate key update values(...)` vs `on conflict (…) do update set excluded.*`, `?` vs `$n` |
| Unit — BigInt mode (7 tests) | `defineSchema` + row-plan conversion | global/per-column schema flags, validation, 64-bit string conversion, null/invalid passthrough |
| Integration — SQLite (38 tests) | live `bun:sqlite` | full stack: CRUD, casts, fillable/hidden/dirty, pagination, aggregates, eager + nested + `withCount` + `whereHas` with **exactly 5 SELECTs** assertion, transactions (commit/rollback/savepoints/events/retry of a faked `SQLITE_BUSY`), migrations (batches, rollback, status), constraint-error translation, raw SQL |
| Integration — BigInt (8 tests) | live `bun:sqlite` | full signed 64-bit range, per-column mode, filters/updates/plucks, auto-increment ids, increment overflow edge, raw SQL, eager relation keys, relation aggregates, model CRUD/PK lookup |
| Integration — Eloquent parity (37 tests) | live `bun:sqlite` | increment/decrement, `firstOrCreate`/`updateOrCreate`, `getOriginal`/`replicate`, `withSum`/`withAvg`/`withMin`/`withMax`, nested/negated `whereHas`, constrained `with()`, event order/gates/observers/ALS suppression, soft deletes (scopes, eager loading, DML, gates, validation), polymorphic/through relations, accessors/mutators/casts/appends/visibility |
| Integration — advanced parity (27 tests) | live `bun:sqlite` | collect.js collections on rows/models/results; relation managers (create/save/sync/pivot/toggle/through); instance loaders; global/local scopes; date/time/JSON/`whereAny`/`withExists`/`whereHasMorph`; cursor/lazy/chunk pagination; first-or variants; upsert helpers; lifecycle (`touch`/`fresh`/`push`/quiet/`$touches`); advanced casts |
| Integration — Priority-1 parity (31 tests) | live `bun:sqlite` | pivot options (`withPivot`/`timestamps`/`as`) + eager pivot hydration (cloned per pair) + manager `wherePivot`/`wherePivotIn`/`orderByPivot`; `latestOfMany`/`oldestOfMany`/`ofMany` eager picks + `whereHas`/aggregate extremes + `withDefault`/`withDefaultFor`; `morphedByMany` both directions and global `orm.morphMap` resolution; `Model.destroy`/`createOrFirst`/instance `increment`/`toArray`/`append`; builder additions (`soleValue`, `doesntExist`, `inRandomOrder`, `whereNotBetween`, `whereExists`, `selectSub`, `union`, `whereIntegerInRaw`, `unless`, aggregate callbacks) |
| Packed DTS consumer (`tsc --strict`) | clean temp install of the tarball; imports only `@barqel/barq-orm` | declarations resolve standalone; collection/scope/manager/cast/`Stringable`/BigInt public types are consumable without source |
| Packed live dialect smoke (Bun + Node) | published `dist/` only, real MySQL/PostgreSQL servers | BigInt CRUD, max signed 64-bit value, insert ids, relation aggregates, raw SQL and transactions work from the packed artifact on both runtimes |
| Compile-time — type tests (60 must-fail directives) | `tsc --noEmit` over must-fail + shape assertions | unknown tables/columns, wrong filter/insert/update types, join refs, fillable allow-list, relation paths, constrained `with()` keys, numeric-only increments, morph-to exclusions, accessor shapes, `with()` unavailable in row mode, PK types, relation-key constraints, collection result shapes, scopes and scope arguments, `RelationManagerOf`, pivot option typing (`withPivot` accessor names/columns, `morphedByMany` keys), `ofMany` direction literals, morph map entries, BigInt number/BigInt boundaries, statics |
| Integration — MySQL (21 tests) | shared `runDialectSuite` against live MySQL 8.4.11 | DDL/types, CRUD, relations/eager loading, polymorphic/pivot relations (`morphedByMany`, pivot extras/timestamps, `wherePivotIn`/`orderByPivot`), one-of-many extremes and default owners, aggregates, upserts, soft deletes, transactions, savepoints, migrations, BigInt ids above 2^53 and raw SQL on the real engine |
| Integration — PostgreSQL (21 tests) | shared `runDialectSuite` against live PostgreSQL 16.15 and 18.6 | the same conformance plan on both versions, including identity columns, `$n` placeholders, `returning`, per-pool int8 strings and advisory locks |
| Integration — dialect rehearsal (21 tests) | the same `runDialectSuite` body on live `bun:sqlite` | keeps shared setup/parity assumptions exercised on every default run, including BigInt safe integers and pivot key hydration |

### 5.2 Standout verified behaviors

- Eager loading of `hasMany` + `hasOne` + `belongsToMany` over 2 users issues
  **exactly 5 SELECTs** and hydrates nested paths (`posts.author`) with zero
  N+1.
- Query results, plucks, pagination data, model statics and eager to-many
  relations are `Collection` instances; collection helpers read hydrated model
  attributes through `get()` and are covered by runtime tests.
- Relation managers persist foreign keys and pivot rows end to end: hasMany
  create/save/createMany, belongsTo associate/dissociate, belongsToMany
  attach/detach/sync/toggle, `syncWithoutDetaching`, pivot updates, and
  hasManyThrough reads (including the corrected through-key correlation).
- Global scopes apply automatically and can be removed by name; local scopes
  receive typed arguments. `withWhereHas` constrains both the parent filter and
  the eager load.
- `whereHasMorph` filters through concrete morph aliases and `"*"`; invalid
  target relations throw.
- Cursor pagination resumes from an opaque `nextCursor`, `lazyById`/`chunkById`
  cover more than one page without duplicate ids, and insert-or-ignore,
  update-or-insert and `truncate` round-trip against SQLite.
- Lifecycle helpers (`fresh`, `touch`, quiet saves, changes/previous, `push`,
  `$touches`) pass live assertions, including owner timestamp touches.
- Advanced casts (`collection`, `stringable`, enum validation, class-based
  get/set, `encrypted:array`, `encrypted:collection`) round-trip through the
  database; encrypted columns are asserted to be ciphertext at rest.
- The packed tarball's declarations compile in strict mode as a standalone
  consumer, including typed relation-manager `get`/`first`/`count`/`create`
  results.
- The packed artifact itself passed live MySQL and PostgreSQL CRUD/relation
  smoke tests under both Bun 1.4.2 and Node v24.21.0, including BigInt mode.
- BigInt mode preserves the entire signed 64-bit range on all three engines:
  row/model reads, filters, updates, plucks, auto-increment ids, eager relation
  keys, `whereHas`, `min`/`max`/`sum` and relation aggregates. MySQL insert ids above
  2^53 (forced with `ALTER TABLE ... AUTO_INCREMENT`), multi-row `createMany`
  id offsets and raw SQL behavior were asserted live.
- The SQLite rehearsal caught a real integration issue: enabling safe integers
  globally made raw pivot keys `bigint` while model keys were numbers. Pivot
  and through eager loaders now hydrate keys against the owner/related schema
  plans, and pivot managers normalize related ids before sync/toggle.
- Unconstrained through relations issue 2 statements; constrained ones issue 3
  — asserted by captured SQL, not assumed.
- Polymorphic eager loading batches one query per concrete type and hydrates a
  typed `Post | Video | null` union.
- Priority-1 parity is verified live on all three engines: pivot extras
  (`withPivot`/`timestamps`/`as`) hydrate per pair and `wherePivot`/
  `wherePivotIn`/`orderByPivot` filter and order through the pivot table
  (correlated `limit 1`), including the timestamp refresh on `attach`/
  `updateExistingPivot` (asserted on live SQLite, MySQL 8.4.11 and PostgreSQL
  16.15/18.6).
- `latestOfMany`/`oldestOfMany`/`ofMany` pick the extreme row per parent with a
  deterministic primary-key tiebreak (asserted live), while
  `whereHas`/`withCount`/`withSum` compile the correlated `= extreme`
  predicate; `withDefault`/`withDefaultFor` fill dangling `belongsTo` keys.
- `morphedByMany` round-trips in both directions on live engines; a global
  `orm.morphMap({…})` resolves aliases for `morphTo` hydration and bare
  `whereHas("commentable")`, and `static morphAlias` overrides the stored type
  string (asserted in SQL and at runtime).
- The 35-test compiled-SQL layer pins the new builder surface per dialect:
  integer raw lists (empty → `1 = 0` / `1 = 1`), `whereExists`/`selectSub`,
  `union`/`unionAll`, `inRandomOrder`, `whereNotBetween`, ofMany extremes,
  morph alias filters and pivot-manager SQL with validated operators.
- `withSum`/`withAvg`/`withMin`/`withMax` and aliased counts match hand-computed
  totals (`posts.views` sum 112 in the canonical fixture) and stay nullable in
  the type system. The standalone `sum`/`avg`/`min`/`max` builder methods are
  also asserted live on both servers. Driver-returned aggregate strings are
  normalized to numbers for `number` columns and to `bigint` for BigInt-mode
  sum/min/max across SQLite, MySQL and PostgreSQL; `avg` remains a number.
- Live MySQL exposed and now covers three dialect-specific fixes: mysql2's
  callback pool (not the promise pool) is handed to Kysely, computed `select`
  columns follow `*` because MySQL rejects `select expr, *`, and DDL emits
  `tinyint(1)`/`float`/`double` through raw type expressions. It also enables
  exact `BIGINT` reads through `supportBigNumbers`/`bigNumberStrings`.
- Live PostgreSQL covers generated-by-default identity columns, per-pool int8
  decimal strings converted by the schema row plan (instead of lossy parsing),
  advisory-lock `$1` placeholders, and the same aggregate/relation behavior as
  MySQL.
- Nested `whereHas`/`orWhereHas`/`whereDoesntHave` compile to correlated
  `EXISTS`; the type tests reject unknown and morph-to nested paths.
- Model events fire in documented order; gate listeners cancel writes/deletes;
  observers work; `withoutEvents()` suppresses everything without leaking
  across concurrent scopes.
- Soft deletes hide rows from reads/counts/pagination/eager loading, respect
  `withTrashed()` constraints, and gate `restore`/`forceDelete`.
- `increment`/`decrement` reject non-numeric columns at runtime and compile
  time; the earlier silent string-corruption path is covered by a regression
  test.
- Accessors are computed properties that never masquerade as columns; they are
  omitted from `toJSON()` unless listed in `appends`.
- Nested transactions behave as savepoints: inner failure rolls back only the
  inner work; outer commit preserves the outer work.
- A faked `SQLITE_BUSY` error is retried and succeeds with `{ retries: 1 }`.
- Migrations: two migrations apply as one batch; rollback reverts the batch;
  status reports correctly; bookkeeping table is configurable.

### 5.3 Remaining non-verified surface

- **Live MySQL and PostgreSQL are verified** with the full shared suite against
  MySQL 8.4.11 and PostgreSQL 16.15 and 18.6. The env-gated entry points still
  skip by default when those URLs are absent; the committed GitHub Actions
  workflow supplies both service containers to reproduce the 250-test run.
- The CI workflow is present and its YAML/services/commands were validated
  locally, but this session did not execute a GitHub-hosted Actions run. Live
  evidence comes from the local servers and from the packed smoke tests.
- The full 250-test suite ran under Bun only; the `node:sqlite` path is covered
  by the packed BigInt smoke test on Node v24.21.0 (§4.7), not by the full
  suite.
- BigInt `number` default, raw SQL driver-native values and JSON's lack of
  native `bigint` support are documented API boundaries, not hidden failures.
  BigInt mode is opt-in because changing every existing `number` row type would
  be a breaking change.

---

## 6. Benchmarks — methodology and reading

Full write-up in `docs/benchmarks.md`. Summary:

- Four libraries, each on its **own isolated in-memory SQLite database** with
  the same schema (index on `posts(userId)`) and the same seed data (100 users,
  1,000 posts).
- Per workload: one sanity run (asserts non-empty/correct results — nobody wins
  by returning nothing), 50 warmup ops, then 5 timed rounds; **median round**
  reported as ops/s.
- Sequential `await` measures latency, not concurrent throughput; in-memory
  SQLite removes disk/network variance. Numbers are machine-specific (Linux,
  Bun 1.4.2) and intended for relative comparison.

Reading of the results (§4.5): the row path stays within the same order of
magnitude as Kysely and beats Drizzle on every single-statement workload
measured (Drizzle is only faster in `eager10`, 5,060 vs 3,013 ops/s, where its
two raw result sets carry no hydration); the model path (`modelFind` ~31k
ops/s, `modelEager10` ~3.2k ops/s of 110 hydrated rows) pays for hydration,
casts and dirty tracking — the documented price of the behavioral layer.

---

## 7. Known bugs and unsupported features

Everything below is documented in `docs/limitations.md`, not hidden:

1. **Lazy-loaded relations**: intentionally unsupported; `with()` only.
2. **Relation paths deeper than 3 levels**: not typed; load step by step.
3. **Instance relation/load names are runtime-validated**: the base instance
   cannot see subclass statics. Use `RelationManagerOf<typeof Model, "name">`
   for the typed manager surface; query eager loading remains fully typed.
   Loaded extras (`postsCount`, `postsSumViews`, …) are runtime properties and
   need an extended/cast instance type for static access.
4. **`morphTo` generic constraints/aggregates/nesting**: unsupported by design
   (no single target table). `whereHasMorph(path, [alias], callback)` is the
   explicit type-scoped filter; bare `with`/`whereHas` work. Invalid generic
   forms are compile errors and runtime `InvalidQueryError`s.
5. **Self-referential nested `whereHas`**: depth ≥ 2 can be ambiguous because
   both `EXISTS` blocks alias the same table; use a join or split the query.
6. **Scope declaration ergonomics**: use `defineScopes`/`defineGlobalScopes` or
   explicit `LocalScope`/`GlobalScope` annotations to avoid circular static
   initialization; literal names are then checked at compile time.
7. **Cursor pagination is forward-only on one column**: opaque `nextCursor`,
   `prevCursor: null`, no total; arbitrary multi-column keysets are not
   provided.
8. **Collection surface is curated**: native array methods not overridden keep
   array semantics (and may return plain arrays via `Symbol.species`). The
   documented Eloquent helpers return `Collection`.
9. **Cast read values are runtime-narrowed**: `get()` stays typed from the
   schema; `collection`/`stringable` values need `instanceof Collection` /
   `String(...)` when the schema column is `json`.
10. **SQLite JSON predicates** cover top-level scalars/arrays and one-level
    objects; deep JSON paths require `whereRaw`/`raw()`.
11. **Touched owners** (`static touches`) update the belongsTo owner's
    `updatedAt` directly after a save; owner model events are not fired and
    touches do not recurse.
12. **`Stringable` covers common operations**, not Laravel's full string API.
13. **`firstOrCreate` race window**: lookup + insert are separate statements; a
    unique index is still required for concurrent safety.
14. **Accessor names** may not collide with columns or `Model.prototype`;
    violations throw `SchemaError`.
15. **Model events are process-local/awaited**; no queue or cross-process
    delivery.
16. **BigInt is opt-in**: default `bigint` columns stay `number` and lose
    precision beyond `Number.MAX_SAFE_INTEGER`. Raw SQL bypasses schema
    conversion, and JSON requires a `bigint`-to-string replacer.
17. **SQLite foreign keys are enabled by the driver** (`PRAGMA
    foreign_keys = ON` per connection); turn them off with raw SQL only if you
    deliberately need the engine default.
18. **MySQL upsert semantics**: `ON DUPLICATE KEY UPDATE` cannot take a conflict
    target; MySQL chooses the unique key. `values(col)` is used (deprecated in
    MySQL 8.0.20+ but valid).
19. **MySQL DDL is not transactional** (engine behavior); migration bookkeeping
    stays atomic.
20. **`isolation` option**: passed where supported; SQLite ignores it.
21. **`orm.raw()` placeholders are verbatim** per dialect (`?` vs `$n`).
22. **Node < 24**: `node:sqlite` is not stable there; use Bun or Node ≥ 24 for
    SQLite (MySQL/PG drivers are unaffected).
23. **Pivot objects are eager-only; pivot constraints are manager-only.**
    `with("roles")` attaches one pivot object per pair (cloned per pair);
    `user.relation("roles").query()` returns plain related models.
    `wherePivot`/`wherePivotIn`/`orderByPivot` exist on the manager, never
    inside eager-load constraint callbacks or `whereHas`. `orderByPivot` uses a
    correlated `limit 1` scalar subquery per row.
24. **Custom pivot models (`using`-style) are unsupported**: pivot rows are
    plain records — no pivot model class, pivot casts or pivot events.
25. **One-of-many tie semantics**: eager loading returns exactly one row
    (primary-key tiebreak in the aggregate's direction), while
    `whereHas`/`withCount`/`withSum` use `= extreme` and may match several tied
    rows. The extreme subquery always applies the default soft-delete scope,
    even if the surrounding callback calls `withTrashed()`.
26. **Morph alias resolution**: `static morphAlias` → `orm.morphMap` → table
    name; maps affect future writes, not existing rows. A `morphTo` manager
    query (`comment.relation("commentable").query()`) throws
    `InvalidQueryError` when the row's type is null or unknown.

No failing tests are hidden; no fake implementations are presented as real.

---

## 8. Remaining work

1. Disambiguate self-referential nested `whereHas` (per-depth aliases).
2. Optional: multi-column/backward cursor pagination.
3. Optional: broaden `Stringable` / collection helpers further if application
   needs exceed the documented surface.
4. Optional: run the full SQLite suite under Node as well (not just the packed
   BigInt smoke test).
5. Publish to npm when ready: `license: MIT`, `publishConfig.access: public`,
   repository/homepage/bugs metadata and `prepublishOnly` are already set;
   the package has not actually been published.
6. Observe the new CI workflow on GitHub after the next push (it was not run on
   a hosted runner during this local session).
7. Deferred by scope (Priority 2): Eloquent cast/date parity (`int`/`float`/
   `object`/`immutable`/parameterized casts) and Blueprint/migrator extras
   (`fresh`/`refresh`/`reset`/`pretend`).
8. Deferred by scope (Priority 2/3): pruning, factories/seeders,
   multi-connection routing, macros, JSON extras and
   `whereMorphedTo`/`whereAttachedTo`.
9. Deferred by scope (Priority 3): custom pivot models (`using`) and pivot
   casts/events (see §7.24).

---

## 9. Exact run commands

```sh
cd barq/packages/orm

# verify
bun run typecheck                       # src, strict
bun run typecheck:tests                 # src + tests + type-tests + bench + example
bun run check                           # biome format + lint
bun test                                # 208 pass / 2 skip / 0 fail (no servers)

# try it
bun run examples/blog.ts

# benchmark
bun run bench --json benchmarks/results.json

# build + pack + standalone smoke
bun run build
bun pm pack --destination /tmp/opencode/orm-smoke-final/pack
# (install tarball into a clean directory, then:)
bunx tsc --noEmit --strict --target ES2022 --module ESNext \
  --moduleResolution Bundler --skipLibCheck packed-typecheck.ts
bun smoke.mjs                           # Bun 1.4.2
node smoke.mjs                          # Node v24.21.0 (node:sqlite)
BARQ_ORM_MYSQL_URL=… BARQ_ORM_PG_URL=… bun dialects.mjs   # packed live DBs
BARQ_ORM_MYSQL_URL=… BARQ_ORM_PG_URL=… node dialects.mjs  # packed live DBs

# live dialect gate (local MySQL 8.4.11 + PostgreSQL 18.6 used for this report)
psql -d postgres -c 'create database barq_orm_test'   # if absent
BARQ_ORM_MYSQL_URL="mysql://hassan-kerdash:${MYSQL_PASSWORD}@127.0.0.1:3306/barq_orm_test" \
BARQ_ORM_PG_URL='postgres:///barq_orm_test?host=/var/run/postgresql' \
  bun test                              # 250 pass / 0 fail

# CI equivalent: .github/workflows/orm.yml provisions MySQL 8.4 + PostgreSQL 16
# service containers and runs the same command with those URLs.
```

---

## 10. Honesty statement

- SQLite is fully integration-tested, live, on every `bun test`; the packed
  artifact was executed standalone on Bun 1.4.2 and Node v24.21.0, and its
  MySQL/PostgreSQL smoke passed against both live servers on both runtimes.
- MySQL 8.4.11 and PostgreSQL 16.15/18.6 were verified with live servers for
  this report: 21 shared-suite tests each, zero failures. The PostgreSQL 16.15
  run used the exact `postgres:16` service image from CI; the other used the
  installed PostgreSQL 18.6. The entry points remain env-gated so the default
  `bun test` needs no infrastructure.
- The `250 pass / 0 fail` figure is the actual output of `bun test` with both
  URLs configured (1157 assertions across 250 tests, 11 files). Without servers
  the same command is `208 pass / 2 skip / 0 fail` (210 tests, 905 assertions),
  skipping only those two gated entry points.
- The CI workflow was added and locally validated (YAML parsed; service images,
  install and test commands match the executed local gate), but no GitHub
  Actions run was executed during this session. This is explicitly **not
  verified on a hosted runner** yet.
