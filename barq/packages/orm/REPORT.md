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
  (bidirectional keyset, single- or multi-column), `chunk`, `chunkById`,
  `lazy`, `lazyById`, `cursor`.
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
  "userId", "views", "max")` build a `hasOne` selecting exactly one extreme row
  per parent (deterministic primary-key tiebreak, reused by `whereHas` and the
  relation aggregates); `belongsTo` accepts `withDefault`/`withDefaultFor` to
  attach a placeholder owner when the foreign key dangles.
- Morph aliases resolve as `static morphAlias` → global `orm.morphMap({…})` →
  table name; `orm.morphClass(value)` maps an alias back to its class and
  `orm.morphMapEntries()` lists the registered map. `morphToMany` pivots also
  expose the `${name}Type` column.
- `with("posts", "posts.author", "profile")` — nested paths, typed results,
  merged per relation (no intersecting array types), 4 levels deep.
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
  16.15 and 18.6 (33 tests each). The entry points stay env-gated for local runs;
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

### 1.13 Priority-2 parity wave (completed)

- **Casts.** `int`/`integer` (truncating writes), `float`/`double`/`real`
  (numeric coercion), `object`, `decimal`/`decimal:<scale>` (fixed-scale
  strings), `immutable_date`/`immutable_datetime` (defensive copies on every
  read via the `decorate` flag), and parameterized
  `date:<format>`/`datetime:<format>` casts using the PHP-token subset
  `Y y m n d j H G i s u`. Unknown names/parameters throw `SchemaError` when
  model metadata resolves.
- **Blueprint / migrator.** `char`, `tinyInteger`, `smallInteger`,
  `mediumInteger`, `jsonb`, `unsigned()`, `useCurrent()`, `constrained()`,
  `foreignIdFor()`, variadic `dropColumn([...])`, `dropUnique`/`dropForeign`;
  `Migrator.reset()`, `refresh()`, `fresh()` and `pretend()`. Foreign keys are
  emitted as named table-level constraints on every dialect (MySQL parses but
  ignores inline `references`).
- **Operational helpers.** `Model.prune(chunk?)` with `static prunable`
  (soft-delete aware, primary-key chunk deletion), `Model.factory()` with
  `Factory.define/state/count/make/create/makeOne/createOne`, and
  `runSeeders()` for functions and `{ run }` objects.
- **Multiple connections.** `new Orm({ connections })`, `orm.connection(name)`,
  `orm.connectionNames()` and per-model `static connection`; children share
  schema, listeners, morph map and macros and are cached per name.
- **Extensibility.** `orm.macro(name, fn)` installs builder macros (bound in
  the builder constructor, `QueryBuilderMacros` augmentation for typed chains)
  and `Model.macro(name, fn)` installs prototype methods.
- **JSON and polymorphic filters.** `whereJsonContains(path)`,
  `whereJsonContainsKey`, `whereJsonDoesntContainKey`, `whereJsonOverlaps`,
  `whereJsonLength(path)`, `whereMorphedTo`/`whereNotMorphedTo` (instance,
  class or alias) and `whereAttachedTo`/`whereNotAttachedTo` across
  belongsTo, morphTo, has-one/has-many, pivots and through relations.
- **Custom pivot models.** `orm.pivot("table")`,
  `belongsToMany(..., { using })`, custom pivot hydration with casts, and
  cast-aware `attach`/`updateExistingPivot`.

### 1.14 Priority-3/4 gap-closing wave (completed)

Every gap that was still open after §1.13 was closed in code, tests, docs and
live verification:

- **Exact one-of-many.** `whereHas`, `withCount`/`withSum`/`withAvg`/`withMin`/
  `withMax` and manager `query()` now use
  `related.<pk> = (select inner.<pk> … order by inner.<column> <dir>, inner.<pk>
  <dir> limit 1)` instead of `= max(...)`, so a tied extreme matches exactly one
  row (the same primary-key tie-break eager loading uses). A related table
  without a primary key raises `InvalidQueryError`; `primaryKey` can be passed
  explicitly.
- **`whereAttachedTo` uses real primary keys.** `belongsTo` defaults its owner
  key to the related model's primary key, and every other relation kind
  constrains on the related model's actual primary key (morph targets too)
  through a shared `#primaryKeyOf` helper.
- **Typed instance aggregates.** `loadCount`, `loadSum`, `loadAvg`, `loadMin`,
  `loadMax` and `loadAggregate` return `this & CountExtrasOf<P>` /
  `this & AggregateExtrasOf<P, C, K>` with alias support
  (`loadCount("posts as pinned")` → `pinnedCount`) and `number | null` values.
- **Pruning fires model events.** `prune()` deletes per instance inside its
  chunk loop, so `deleting`/`deleted`/`trashed` run and a `deleting` listener
  can cancel a row.
- **Explicit `Migrator.dropAllTables()`** returns the dropped table names
  (PostgreSQL `cascade`, MySQL toggles `foreign_key_checks`, names validated
  against the identifier pattern) and backs `fresh()`.
- **Pivot events.** `pivotAttaching`/`pivotAttached`,
  `pivotDetaching`/`pivotDetached`, `pivotUpdating`/`pivotUpdated` fire on the
  parent model class with a typed `{ model, relation, ids, attributes }`
  payload; the `…ing` gates cancel the write. `User.onPivot(event, listener)`
  and mixed observer objects are typed, and `sync`/`toggle` inherit the events
  from `attach`/`detach`.
- **Bidirectional, multi-column cursor pagination.** `cursorPaginate(perPage, {
  order: [...] })` supports several ordered columns; `nextCursor` and
  `prevCursor` are direction-tagged (base64url JSON with tagged `bigint`/`Date`
  values), the reverse page is fetched inverted and reversed back, and the
  result reports `hasMore`/`hasPrevious`.
- **Self-referential nested paths.** A step whose table shadows its owner is
  aliased (`users__rel_<depth>`), fixing `whereHas("parent.parent")`,
  `whereHas("children.children")` and self-referential
  `withCount`/`withSum`/`withExists`.
- **Cross-dialect JSON overlap.** `whereJsonOverlaps` follows MySQL's
  `JSON_OVERLAPS` on every dialect — native operator on MySQL, `jsonb_typeof` +
  `jsonb_array_elements` + `jsonb_each` on PostgreSQL, `json_each` on SQLite —
  so a partial array overlap matches on all three.
- **SQLite constraint drops.** `dropUnique` drops a named unique index
  directly; `dropForeign` (and any named table-level constraint) rebuilds the
  table from its `sqlite_master` statement with the clause stripped, copies the
  rows, renames and recreates the indexes, toggling `foreign_keys` around the
  swap.
- **Relation depth 4.** `AllRelationPaths` walks relations up to depth 4.
- **Expanded `Stringable`** (case conversion, padding, truncation, slicing,
  search, mutation, `wordCount`).
- **Transactional seeders.** `runSeeders(orm, seeders, { transaction: true })`
  wraps the whole list in one transaction.
- **Node runtime job.** `tests/node/smoke.mjs` runs the built and the packed
  package under Node 24 against SQLite, MySQL and PostgreSQL; the new
  `node-runtime` CI job runs it on every push.

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
| 24 | One-of-many selects exactly one row everywhere: the related primary key against an ordered `limit 1` subquery | A relation returns one row and existence/count agree with it, so a tied extreme can never double-count. A related table without a primary key is rejected loudly (`InvalidQueryError`). |
| 25 | `morphedByMany` is the `morphToMany` descriptor with `inverse: true` | One pivot resolver instead of two; keys keep the declaring model's perspective and the type filter uses the related class's alias. |
| 26 | Morph aliases resolve `static morphAlias` → global map → table name | Per-class overrides stay authoritative; the global map is the escape hatch for type strings written elsewhere. Unresolvable `morphTo` manager rows throw `InvalidQueryError` instead of guessing. |
| 27 | Built-in casts coerce on `set`; parameterized names accept a small PHP-token subset | Write/read behavior matches Eloquent without shipping a date-formatting library; invalid names fail loudly at meta resolution. |
| 28 | `immutable_*` casts mark `decorate: true` and re-run `get` on every read | Attributes stay `Date`-typed, while callers can never mutate the stored instance. |
| 29 | Foreign keys are table-level constraints with deterministic names on every dialect | MySQL parses and ignores inline `references`; naming them (`<table>_<column>_foreign`) makes `dropForeign` and live schema introspection reliable. |
| 30 | Child connections are cached `Orm` instances sharing `OrmShared`; each owns its transaction ALS | Independent pools/transaction contexts per connection, with one listener/morph/macro registry for the whole application. |
| 31 | Builder macros are bound in the constructor; model macros go on the prototype | Macro chains keep the concrete builder/instance as `this`; declaring methods on the prototype preserves normal instance dispatch and collision checks. |
| 32 | `dropUnique`/`dropForeign` try constraint names then index names | The same API must remove PG constraints/indexes and MySQL FKs/indexes. SQLite drops a named unique index directly and rebuilds the table (copy → drop → rename → replay indexes, `foreign_keys` toggled around the swap) for a named constraint; only engine-auto-named constraints raise `SchemaError`. |
| 33 | Pivot events fire on the parent model class (Eloquent parity), with `…ing` gates that cancel | Events describe the relation write the application made; a separate pivot-class listener registry would not match Eloquent and would double the API surface. `sync`/`toggle` inherit them by delegating to `attach`/`detach`. |
| 34 | Cursors are opaque base64url JSON with tagged `bigint`/`Date` values | Reversible through `JSON.parse` without losing 64-bit keys or dates, and direction-tagged (`{ v, n }`) so `nextCursor`/`prevCursor` can be inverted for a backward page; the legacy `{ value }` payload still decodes. |
| 35 | Self-referential nested steps alias the inner table (`<table>__rel_<depth>`) | Correlated `EXISTS`/aggregates need distinct aliases when a path revisits its own table; aliasing only the shadowed levels keeps normal SQL unchanged. |
| 36 | `whereJsonOverlaps` reproduces MySQL `JSON_OVERLAPS` on every dialect | One documented semantic instead of three; PostgreSQL and SQLite compile to `jsonb_typeof`/`jsonb_array_elements`/`jsonb_each` and `json_each` expansions so partial array overlap matches like MySQL. |

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
  schema/sqlite-rebuild.ts SQLite table-rebuild planner for named constraint drops
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
  unit/compile-sql.test.ts          41 tests — exact SQL/bindings per dialect
  unit/bigint.test.ts                7 tests — schema mode, validation, row conversion
  integration/sqlite.test.ts        38 tests — full stack on live SQLite
  integration/eloquent.test.ts      37 tests — Eloquent-parity batches
  integration/advanced.test.ts      27 tests — collections, managers, loaders, scopes,
                                    builder breadth, lifecycle, advanced casts
  integration/bigint.test.ts         8 tests — full 64-bit range on live SQLite
  integration/parity.test.ts        31 tests — Priority-1 parity (pivot options and
                                    hydration, one-of-many, withDefault, morph map)
  integration/priority-2.test.ts    36 tests — Priority-2/3/4 runtime coverage on
                                    live SQLite (SQLite constraint rebuild,
                                    self-referential aliasing, transactional seeders)
  integration/dialect-suite.ts      33 tests — shared MySQL/PG/SQLite conformance suite
  integration/dialect-rehearsal.test.ts  33 tests — same suite on live SQLite
  integration/mysql.test.ts         env-gated entry point (33 tests when URL is set)
  integration/postgres.test.ts      env-gated entry point (33 tests when URL is set)
  types/type-tests.ts               72 must-fail directives + shape assertions
  node/smoke.mjs                    Node-runtime smoke: built and packed package
                                    against SQLite, MySQL and PostgreSQL

Source: 17,469 lines of TypeScript across 31 files (strict, ESM, no `any` in the
public API). Tests: 9,314 lines across 14 TypeScript files plus the 314-line Node
smoke script (12 files executed by `bun test`; `dialect-suite.ts` is imported and
`type-tests.ts` is compile-only).

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
suite must be consumed for it to pass** — i.e. all 72 intended compile errors
(unknown tables/columns/filters, wrong insert payloads, bad relation keys/paths,
`with()` in row mode, unknown eager-load keys, non-numeric `increment`,
morph-to aggregates/constraints, missing local-scope arguments, unknown scope
names, pivot ids on the wrong manager shape, invalid `ofMany` directions,
`morphedByMany` key mismatches, missing pivot columns in `wherePivot`, BigInt
`number` misuse, unknown pivot events, non-boolean pivot gates, bad
`cursorPaginate` columns/directions, unknown seeder options, bad `Stringable`
arguments, …) fire exactly where expected, and every positive shape assertion
holds — including the Priority-4 additions: `loadCount`/`loadSum`/`loadMax`
returning the instance widened with `postsCount`/`postsSumViews`/`postsMaxViews`,
typed `onPivot` payloads, `hasPrevious`/multi-column `cursorPaginate`,
`dropAllTables(): Promise<string[]>`, `runSeeders(..., { transaction: true })`,
and the expanded `Stringable` chain.

### 4.2 Lint and format

```
$ bunx biome check --write src tests docs   # only when applying fixes
Checked 45 files in 309ms. Fixed 1 file.
Found 6 warnings.            # pre-existing style warnings, no errors
$ echo $?
0

$ bun run check
$ biome check .
Checked 50 files in 228ms. No fixes applied.
Found 6 warnings.
$ echo $?
0
```

### 4.3 Test suite

```
$ bun test
 262 pass
 2 skip
 0 fail
 1163 expect() calls
Ran 264 tests across 12 files. [2.01s]

$ BARQ_ORM_MYSQL_URL=mysql://hassan-kerdash:…@127.0.0.1:3306/barq_orm_test \
  BARQ_ORM_PG_URL=postgres:///barq_orm_test?host=/var/run/postgresql \
  bun test
 328 pass
 0 fail
 1593 expect() calls
Ran 328 tests across 12 files. [8.34s]

$ BARQ_ORM_MYSQL_URL=mysql://root:secret@127.0.0.1:33306/barq_test \
  BARQ_ORM_PG_URL=postgres://postgres:secret@127.0.0.1:55432/barq_test \
  bun test
 328 pass
 0 fail
 1593 expect() calls
Ran 328 tests across 12 files. [8.15s]
```

The first run used the installed MySQL 8.4.11 and PostgreSQL 18.6 servers; the
second used the same MySQL 8.4 and PostgreSQL 16.15 service-container images as
`.github/workflows/orm.yml` (started locally with Podman). Both live server
suites contributed 33 passing tests each in both runs (the shared
`runDialectSuite` and the SQLite rehearsal now carry 33 cases). Without the two
environment variables the same command is `262 pass, 2 skip, 0 fail`
(264 tests, 1163 assertions): only the env-gated dialect entry points skip.
The total includes the 38-test SQLite suite, the 37-test Eloquent-parity
suite, the 27-test advanced suite, a 7-test BigInt unit suite, an 8-test live
BigInt suite, the 31-test Priority-1 parity suite, the 36-test Priority-2/3/4
suite, a 33-test rehearsal of the shared dialect suite against SQLite, and 66
live dialect tests (33 MySQL + 33 PostgreSQL).

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
$ echo $?
0
(index.js / sqlite.js / mysql.js / postgres.js / testing.js + source maps)
(tsc --emitDeclarationOnly produced per-module .d.ts)

$ bun pm pack --destination /tmp/opencode/barq-pack
Total files: 75
Shasum: 256c99f6ec416ef1dd63b54111466b7594389f97
Unpacked size: 3.0MB  Packed size: 0.56MB
```

### 4.7 Node-runtime smoke — built and packed (`tests/node/smoke.mjs`)

The committed smoke script runs the whole core surface (DDL, model CRUD, eager
loading, relation aggregates and typed `load*` extras, one-of-many ties, JSON
paths, `belongsToMany` with pivot events and pivot extras, transactions and
rollback, cursor paging in both directions, seeders, `dropAllTables`) against
SQLite always, and against live MySQL/PostgreSQL when the URLs are present. It
imports the **built `dist/`** by default and the **packed tarball** when
`BARQ_ORM_PACKED=1`:

```
$ bun run smoke                                  # built dist, SQLite (node --no-warnings tests/node/smoke.mjs)
ok   sqlite
ok   exports (dist)

$ BARQ_ORM_MYSQL_URL=… BARQ_ORM_PG_URL=… bun run smoke
ok   sqlite
ok   mysql
ok   postgres
ok   exports (dist)

$ bun pm pack --destination /tmp/opencode/barq-pack
$ (cd /tmp/opencode/barq-smoke                               # clean consumer
   npm init -y && npm install --no-save /tmp/opencode/barq-pack/*.tgz mysql2 pg
   cp packages/orm/tests/node/smoke.mjs .
   BARQ_ORM_PACKED=1 BARQ_ORM_MYSQL_URL=… BARQ_ORM_PG_URL=… node --no-warnings smoke.mjs)
ok   sqlite
ok   mysql
ok   postgres
ok   exports (packed tarball)
```

The packed consumer imports only `@barqel/barq-orm` (+ `/sqlite`, `/mysql`,
`/postgres`); no source imports are involved. The CI job `node-runtime` runs
exactly these two steps on every push, on Node 24, against service containers.
Earlier waves additionally ran an ad-hoc standalone type-check of the emitted
declarations in a clean consumer (`tsc --noEmit --strict`), which stayed clean.

### 4.8 First hosted GitHub Actions run

The workflow (`.github/workflows/orm.yml`) was pushed and observed through the
public GitHub API:

- Run `39199331811` (`ab9a6c9`) — **failure**: both jobs stopped at
  `bun install --frozen-lockfile` ("lockfile had changes, but lockfile is
  frozen") because the committed root `bun.lock` predated `packages/orm`. The
  failure was reproduced in a clean `git clone` before fixing anything.
- Run `39199669711` (`caefc1b`) — **success**, both jobs green:
  - `Types, lint, build, SQLite`: install → biome → `typecheck` →
    `typecheck:tests` → `bun test` → `build`.
  - `Live MySQL and PostgreSQL`: install → `bun test` against the workflow's
    own `mysql:8.4` and `postgres:16` service containers.

The fix (`caefc1b`) refreshes the workspace lockfile from the committed
`package.json` files only — it adds `packages/orm` and the previously missing
`packages/client`/`packages/env` workspace entries, and carries no working-tree
WIP. Before pushing, the exact CI sequence was rehearsed in a clean clone of
the pushed commit with that lockfile: frozen install (no changes), biome (46
files clean), both typechecks, `bun test` (208 pass / 2 skip / 0 fail), build,
and the live sequence against local MySQL/PostgreSQL (250 pass / 0 fail).

---

### 4.9 Priority-2 live re-verification

- Offline: `bun test` → **255 pass / 2 skip / 0 fail**, 257 tests across 12
  files (1,107 expectations); `bun run typecheck` and `bun run typecheck:tests`
  clean; `biome check` reports warnings only (no errors).
- Local MySQL 8.4.11 + PostgreSQL 18.6:
  `BARQ_ORM_MYSQL_URL=… BARQ_ORM_PG_URL=… bun test tests/integration/mysql.test.ts tests/integration/postgres.test.ts`
  → **58 pass / 0 fail** (29 tests per engine, including the Priority-2 block).
- Podman scratch databases (MySQL 8.4.11 `barq_test`, PostgreSQL 16.15
  `barq_test`, non-destructive to the local `hassan-kerdash` databases): same
  command → **58 pass / 0 fail**.

### 4.10 Priority-3/4 live re-verification

- Offline: `bun test` → **262 pass / 2 skip / 0 fail**, 264 tests across 12
  files (1,163 expectations); `bun run typecheck` and `bun run typecheck:tests`
  clean; `bun run check` reports 6 pre-existing style warnings and no errors
  (exit 0).
- Local MySQL 8.4.11 + PostgreSQL 18.6: `BARQ_ORM_MYSQL_URL=… BARQ_ORM_PG_URL=…
  bun test` → **328 pass / 0 fail** (1,593 expectations), i.e. the full suite
  including 33 shared tests per engine.
- Podman scratch databases (MySQL 8.4.11, PostgreSQL 16.15): same command →
  **328 pass / 0 fail**.
- Node runtime smoke (`bun run smoke`, i.e. `node --no-warnings
  tests/node/smoke.mjs`): built `dist/` and the packed tarball both report
  `ok sqlite`, `ok mysql`, `ok postgres`, `ok exports` — see §4.7.
- Hosted CI: run `39216418150` (`5f9afdf`) — **all three jobs green**:
  `Types, lint, build, SQLite` (biome, both typechecks, `bun test`, build),
  `Live MySQL and PostgreSQL` (the full 328-test suite against the workflow's
  `mysql:8.4` and `postgres:16` service containers) and the new
  `Node runtime smoke (built + packed)` (Node 24: dist smoke against SQLite +
  both live engines, `bun pm pack`, packed-tarball install and smoke).
- Every Priority-4 behaviour is asserted live on all three engines: one-of-many
  tied extremes match exactly one row in predicates and aggregates (both
  directions), `whereAttachedTo` uses the related table's real primary key,
  typed `load*` extras, pruning firing `deleting`/`deleted`/`trashed`,
  `dropAllTables()` returning the dropped names (and backing `fresh()`), pivot
  events in order with cancelling gates and `withoutModelEvents` suppression,
  bidirectional multi-column cursor paging (with BigInt/Date cursor values),
  self-referential nested `whereHas`/`withCount` aliasing, cross-dialect JSON
  overlap, and SQLite named-constraint drops (unique index drop + table
  rebuild).

## 5. Test / verification strategy and results

### 5.1 What each layer proves

| Layer | How | Proves |
| --- | --- | --- |
| Unit — driver/adapter (4 tests) | live in-memory SQLite through the Kysely adapter | driver contract: DDL, `returning`, transactions, raw execution |
| Unit — SQL compilation (41 tests) | `onQuery` capture with DummyDriver, per dialect | exact SQL text + bindings: select/insert/upsert/update/delete/joins/whereHas/`ilike`, aggregate subqueries and constraint callbacks, soft-delete SELECT/DML, `increment`/`decrement`, `inRandomOrder`/`whereNotBetween`/`orWhereNot`, integer raw lists (empty-list constants), `whereExists`/`selectSub`, `union`/`unionAll`, ofMany extreme predicates (`= (select … limit 1)` with the primary-key tiebreak), morph alias filters (`morphToMany`/`morphedByMany`) and pivot-manager SQL (validated operators), MySQL `on duplicate key update values(...)` vs `on conflict (…) do update set excluded.*`, `?` vs `$n`, cross-dialect `whereJsonOverlaps` |
| Unit — BigInt mode (7 tests) | `defineSchema` + row-plan conversion | global/per-column schema flags, validation, 64-bit string conversion, null/invalid passthrough |
| Integration — SQLite (38 tests) | live `bun:sqlite` | full stack: CRUD, casts, fillable/hidden/dirty, pagination, aggregates, eager + nested + `withCount` + `whereHas` with **exactly 5 SELECTs** assertion, transactions (commit/rollback/savepoints/events/retry of a faked `SQLITE_BUSY`), migrations (batches, rollback, status), constraint-error translation, raw SQL |
| Integration — BigInt (8 tests) | live `bun:sqlite` | full signed 64-bit range, per-column mode, filters/updates/plucks, auto-increment ids, increment overflow edge, raw SQL, eager relation keys, relation aggregates, model CRUD/PK lookup |
| Integration — Eloquent parity (37 tests) | live `bun:sqlite` | increment/decrement, `firstOrCreate`/`updateOrCreate`, `getOriginal`/`replicate`, `withSum`/`withAvg`/`withMin`/`withMax`, nested/negated `whereHas`, constrained `with()`, event order/gates/observers/ALS suppression, soft deletes (scopes, eager loading, DML, gates, validation), polymorphic/through relations, accessors/mutators/casts/appends/visibility |
| Integration — advanced parity (27 tests) | live `bun:sqlite` | collect.js collections on rows/models/results; relation managers (create/save/sync/pivot/toggle/through); instance loaders; global/local scopes; date/time/JSON/`whereAny`/`withExists`/`whereHasMorph`; cursor/lazy/chunk pagination; first-or variants; upsert helpers; lifecycle (`touch`/`fresh`/`push`/quiet/`$touches`); advanced casts |
| Integration — Priority-1 parity (31 tests) | live `bun:sqlite` | pivot options (`withPivot`/`timestamps`/`as`) + eager pivot hydration (cloned per pair) + manager `wherePivot`/`wherePivotIn`/`orderByPivot`; `latestOfMany`/`oldestOfMany`/`ofMany` eager picks + `whereHas`/aggregate extremes + `withDefault`/`withDefaultFor`; `morphedByMany` both directions and global `orm.morphMap` resolution; `Model.destroy`/`createOrFirst`/instance `increment`/`toArray`/`append`; builder additions (`soleValue`, `doesntExist`, `inRandomOrder`, `whereNotBetween`, `whereExists`, `selectSub`, `union`, `whereIntegerInRaw`, `unless`, aggregate callbacks) |
| Integration — Priority-2/3/4 (36 tests) | live `bun:sqlite` + shared dialect suite | SQLite named-constraint drop (unique index + table rebuild) and `dropColumn`; self-referential nested `whereHas`/`withCount` aliasing; transactional seeders; cast/blueprint/migrator/pruning/JSON/`whereAttachedTo`/pivot-cast behaviours on SQLite (the shared suite repeats them on MySQL/PG) |
| Packed DTS consumer (`tsc --strict`) | clean temp install of the tarball; imports only `@barqel/barq-orm` | declarations resolve standalone; collection/scope/manager/cast/`Stringable`/BigInt public types are consumable without source |
| Node-runtime smoke (built + packed) | `tests/node/smoke.mjs` on Node 22/24, real MySQL/PostgreSQL servers, CI job `node-runtime` | the shipped artifact's core surface (DDL, CRUD, eager loading, aggregates and typed `load*` extras, one-of-many ties, JSON paths, pivot events and extras, transactions, bidirectional cursor paging, seeders, `dropAllTables`) works on Node, not just Bun |
| Compile-time — type tests (72 must-fail directives) | `tsc --noEmit` over must-fail + shape assertions | unknown tables/columns, wrong filter/insert/update types, join refs, fillable allow-list, relation paths (now to depth 4), constrained `with()` keys, numeric-only increments, morph-to exclusions, accessor shapes, `with()` unavailable in row mode, PK types, relation-key constraints, collection result shapes, scopes and scope arguments, `RelationManagerOf`, pivot option typing (`withPivot` accessor names/columns, `morphedByMany` keys), `ofMany` direction literals, morph map entries, BigInt number/BigInt boundaries, statics, plus the Priority-4 surface: typed `load*` extras, typed `onPivot` payloads and gate returns, `cursorPaginate` columns/directions and `hasPrevious`, `dropAllTables`, `runSeeders` options and `Stringable` |
| Integration — MySQL (33 tests) | shared `runDialectSuite` against live MySQL 8.4.11 | DDL/types, CRUD, relations/eager loading, polymorphic/pivot relations (`morphedByMany`, pivot extras/timestamps, `wherePivotIn`/`orderByPivot`), pivot events, one-of-many tie-exact extremes and default owners, typed `load*`, aggregates, upserts, soft deletes, transactions, savepoints, migrations (`fresh`/`dropAllTables`), bidirectional cursor paging, JSON paths/keys/length/overlaps, pruning, transactional seeders, BigInt ids above 2^53 and raw SQL on the real engine |
| Integration — PostgreSQL (33 tests) | shared `runDialectSuite` against live PostgreSQL 16.15 and 18.6 | the same conformance plan on both versions, including identity columns, `$n` placeholders, `returning`, per-pool int8 strings, advisory locks, JSON-overlap subqueries and bidirectional cursor paging |
| Integration — dialect rehearsal (33 tests) | the same `runDialectSuite` body on live `bun:sqlite` | keeps shared setup/parity assumptions exercised on every default run, including BigInt safe integers, pivot key hydration, the rebuild-based constraint drops and BigInt/Date cursor values |

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
- Cursor pagination walks forwards and backwards over a multi-column order: the
  reverse page is fetched with inverted directions and reversed back, cursor
  values are JSON-tagged so `bigint` and `Date` keys survive the round trip,
  and `hasMore`/`hasPrevious` report the edges. `lazyById`/`chunkById` still
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
  deterministic primary-key tiebreak (asserted live), and
  `whereHas`/`withCount`/`withSum` compile the same choice as a correlated
  `related.<pk> = (select inner.<pk> … order by … limit 1)` predicate, so a tied
  extreme matches exactly one row in predicates and aggregates as well —
  asserted live on SQLite, MySQL and PostgreSQL, including a deliberate
  two-row tie. `withDefault`/`withDefaultFor` fill dangling `belongsTo` keys.
- `morphedByMany` round-trips in both directions on live engines; a global
  `orm.morphMap({…})` resolves aliases for `morphTo` hydration and bare
  `whereHas("commentable")`, and `static morphAlias` overrides the stored type
  string (asserted in SQL and at runtime).
- The 41-test compiled-SQL layer pins the new builder surface per dialect:
  integer raw lists (empty → `1 = 0` / `1 = 1`), `whereExists`/`selectSub`,
  `union`/`unionAll`, `inRandomOrder`, `whereNotBetween`, ofMany extremes
  (primary-key subquery form), morph alias filters, pivot-manager SQL with
  validated operators, and the three `whereJsonOverlaps` compilations.
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
  `EXISTS`; the type tests reject unknown and morph-to nested paths. A nested
  step that would shadow its own owner table is aliased
  (`users__rel_<depth>`), so `whereHas("parent.parent")` on a self-referencing
  relation and self-referential `withCount`/`withSum` correlate against the
  enclosing row on all three engines.
- Pivot writes emit `pivotAttaching`/`pivotAttached`,
  `pivotDetaching`/`pivotDetached` and `pivotUpdating`/`pivotUpdated` on the
  parent model class with a typed `{ model, relation, ids, attributes }`
  payload; a `…ing` gate returning `false` cancels the write, listener order is
  asserted live, and `withoutModelEvents()` suppresses them. `sync`/`toggle`
  inherit the events from `attach`/`detach`.
- Pruning deletes per instance inside its chunk loop, so `deleting`/`deleted`
  (and `trashed` for soft-deleting models) fire and a `deleting` listener can
  cancel an individual row.
- `Migrator.dropAllTables()` returns the dropped table names on all three
  engines (PostgreSQL `cascade`, MySQL toggling `foreign_key_checks`, names
  validated against the identifier pattern) and backs `fresh()`.
- `whereJsonOverlaps` follows MySQL's `JSON_OVERLAPS` on every dialect —
  asserted with partial array overlap, shared object keys and scalar equality
  on SQLite, MySQL and PostgreSQL.
- SQLite `dropUnique`/`dropForeign` now work: a named unique index is dropped
  directly, and a named constraint triggers SQLite's documented table rebuild
  (scratch table from the rewritten `sqlite_master` statement, row copy, drop,
  rename, index replay, `foreign_keys` toggled around the swap).
- `loadCount`/`loadSum`/`loadAvg`/`loadMin`/`loadMax`/`loadAggregate` return the
  instance widened with the extras (`this & { postsCount: number }`,
  `postsSumViews: number | null`, alias-aware), matching the query builder's
  `with*` typing.
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
  workflow supplies both service containers to reproduce the 328-test run.
- The CI workflow executed on a hosted GitHub runner after the push: run
  `39199669711` (`caefc1b`) is green for both the `verify` job and the
  `live-dialects` job against the workflow's own MySQL 8.4 and PostgreSQL 16
  service containers (`mysql:8.4` + `postgres:16`). Run `39199331811`
  (`ab9a6c9`) had failed first at `bun install --frozen-lockfile`; the lockfile
  fix and its local rehearsal are documented in §4.8. The latest push
  (`5f9afdf`, run `39216418150`) is green for all three jobs, including the
  Node runtime smoke.
- The full suite runs under Bun; the Node runtime is covered by
  `tests/node/smoke.mjs` against the built **and packed** artifact on SQLite,
  MySQL and PostgreSQL (§4.7), wired into the `node-runtime` CI job.
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
2. **Relation paths deeper than 4 levels**: not typed; load step by step.
3. **Instance relation/load names are runtime-validated**: the base instance
   cannot see subclass statics. Use `RelationManagerOf<typeof Model, "name">`
   for the typed manager surface; query eager loading remains fully typed.
   `loadCount`/`loadSum`/… return the instance widened with the extras
   (`postsCount`, `postsSumViews`, …), so those are statically available; the
   *reference* stays a runtime-validated string.
4. **`morphTo` generic constraints/aggregates/nesting**: unsupported by design
   (no single target table). `whereHasMorph(path, [alias], callback)` is the
   explicit type-scoped filter; bare `with`/`whereHas` work. Invalid generic
   forms are compile errors and runtime `InvalidQueryError`s.
5. **Self-referential nested `whereHas`**: each shadowing step is aliased
   (`users__rel_<depth>`), so depth ≥ 2 correlates correctly; through-relation
   joins inside nested paths are not aliased.
6. **Scope declaration ergonomics**: use `defineScopes`/`defineGlobalScopes` or
   explicit `LocalScope`/`GlobalScope` annotations to avoid circular static
   initialization; literal names are then checked at compile time.
7. **Cursor pagination is key-set based**: one column (`column`/`direction`) or
   several (`order`), with `nextCursor`/`prevCursor`/`hasMore`/`hasPrevious`.
   Cursors are opaque, valid only for the same ordering and filters (a value
   count mismatch throws `InvalidQueryError`), and there is no total; use
   `paginate`/`simplePaginate` when a total is required.
8. **Collection surface is curated**: native array methods not overridden keep
   array semantics (and may return plain arrays via `Symbol.species`). The
   documented Eloquent helpers return `Collection`.
9. **Cast read values are runtime-narrowed**: `get()` stays typed from the
   schema; `collection`/`stringable` values need `instanceof Collection` /
   `String(...)` when the schema column is `json`.
10. **JSON overlap is one semantic everywhere**: MySQL `JSON_OVERLAPS`,
    PostgreSQL `jsonb_typeof` + `jsonb_array_elements`/`jsonb_each`, SQLite
    `json_each` — scalars by equality, arrays by shared elements, objects by
    shared key/value pairs. JSON paths accept `$.a.b`/`a.b` (letters, digits,
    `_`, `$`); array indexes and quoted keys are rejected.
11. **Touched owners** (`static touches`) update the belongsTo owner's
    `updatedAt` directly after a save; owner model events are not fired and
    touches do not recurse.
12. **`Stringable` covers the common surface**, not Laravel's full string API
    (case conversion, trim/pad/truncate, sliding/`before`/`after`/`between`,
    search, mutation, `slug`, `length`, `wordCount`).
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
24. **Custom pivot models (`using`) cover hydration, writes and casts, not
    pivot-class events.** Eager-loaded pivots instantiate the class with its
    casts and `attach`/`updateExistingPivot` apply them; pivot **events** fire
    on the parent model class (`User.onPivot(...)`), matching Eloquent. Extra
    columns still require `withPivot`; manager queries return plain related
    models.
25. **One-of-many selects exactly one row everywhere**: eager loading,
    `whereHas` and the aggregates all use the primary-key-against-`limit 1`
    subquery, so tied extremes match once; the subquery always applies the
    default soft-delete scope, even if the surrounding callback calls
    `withTrashed()`.
26. **Morph alias resolution**: `static morphAlias` → `orm.morphMap` → table
    name; maps affect future writes, not existing rows. A `morphTo` manager
    query (`comment.relation("commentable").query()`) throws
    `InvalidQueryError` when the row's type is null or unknown.

27. **SQLite constraint drops rebuild the table**: a named unique index is
    dropped with `drop index`; a named constraint triggers the documented
    rebuild (scratch table, row copy, drop, rename, index replay), so keep it
    in a migration. Auto-named constraints (`sqlite_autoindex_…`) raise
    `SchemaError`. MySQL tries `drop foreign key` → `drop index`, PostgreSQL
    `drop constraint` → `drop index`.
28. **`migrator.fresh()`/`dropAllTables()` drop every table** in the connected
    database; `fresh()` then re-runs migrations, `dropAllTables()` returns the
    dropped names. Use a scratch database; `reset()`/`refresh()` only reverse
    recorded batches.
29. **Transactions are scoped per connection**: a child `Orm` has its own
    `AsyncLocalStorage` context, so a default-connection transaction does not
    cover queries sent through `orm.connection(name)`.
30. **`whereAttachedTo` uses the related model's real primary key** for
    has-one/has-many/pivot/through relations (a table without one throws
    `InvalidQueryError`); `belongsTo` uses the owner key (defaulting to the
    related primary key) and `morphTo` uses the morph columns plus the target's
    primary key.
31. **Pruning fires model events** (per-instance deletes inside each chunk);
    soft-deleting models are trashed. `runSeeders` is sequential by default and
    transactional with `{ transaction: true }`.
32. **Built-in cast names do not refine static return types**: `decimal:<n>`
    and `date:<fmt>` return strings at runtime while `get()` stays
    schema-typed; custom casts with `set` narrow write payloads via
    `CastedValues`.

No failing tests are hidden; no fake implementations are presented as real.

---

## 8. Remaining work

1. Publish to npm when ready: `license: MIT`, `publishConfig.access: public`,
   repository/homepage/bugs metadata, `exports` map and `files` list are
   already set, the tarball is built and installed from disk in CI, and the
   packed artifact is smoked on Node — but **no registry credentials exist in
   this environment, so `@barqel/barq-orm` has not been published**. This is
   the one remaining gap that cannot be closed here.
2. Optional: run the full `bun:test` suite under Node by shimming `bun:test`
   onto `node:test` (today the Node coverage is the committed smoke script,
   which exercises the core surface against SQLite, MySQL and PostgreSQL on
   the built and packed artifact).
3. Optional: refine static types for the remaining runtime-narrowed reads
   (built-in cast names, JSON columns) if application code needs them.
4. Optional: broaden `Stringable`/collection helpers further if application
   needs exceed the documented surface.

---

## 9. Exact run commands

```sh
cd barq/packages/orm

# verify
bun run typecheck                       # src, strict
bun run typecheck:tests                 # src + tests + type-tests + bench + example
bun run check                           # biome format + lint
bun test                                # 262 pass / 2 skip / 0 fail (no servers)

# try it
bun run examples/blog.ts

# benchmark
bun run bench --json benchmarks/results.json

# build + pack + Node smoke (built dist, then the packed tarball)
bun run build
bun run smoke
bun pm pack --destination /tmp/opencode/barq-pack
mkdir -p /tmp/opencode/barq-smoke && cd /tmp/opencode/barq-smoke
npm init -y && npm install --no-save /tmp/opencode/barq-pack/*.tgz mysql2 pg
cp /path/to/barq/packages/orm/tests/node/smoke.mjs .
BARQ_ORM_PACKED=1 node --no-warnings smoke.mjs

# live dialect gate (local MySQL 8.4.11 + PostgreSQL 18.6 used for this report)
psql -d postgres -c 'create database barq_orm_test'   # if absent
BARQ_ORM_MYSQL_URL="mysql://hassan-kerdash:${MYSQL_PASSWORD}@127.0.0.1:3306/barq_orm_test" \
BARQ_ORM_PG_URL='postgres:///barq_orm_test?host=/var/run/postgresql' \
  bun test                              # 328 pass / 0 fail

# CI equivalent: .github/workflows/orm.yml provisions MySQL 8.4 + PostgreSQL 16
# service containers and runs `bun test` (job `live-dialects`) plus the Node
# smoke against dist and the packed tarball (job `node-runtime`).
```

---

## 10. Honesty statement

- SQLite is fully integration-tested, live, on every `bun test`; the shipped
  artifact was executed standalone on Node against SQLite, MySQL and
  PostgreSQL — both the built `dist/` and the packed tarball installed in a
  clean consumer (`tests/node/smoke.mjs`, §4.7).
- MySQL 8.4.11 and PostgreSQL 16.15/18.6 were verified with live servers for
  this report: 33 shared-suite tests each, zero failures, in two independent
  environments (installed servers and Podman scratch containers). The
  PostgreSQL 16.15 run used the exact `postgres:16` service image from CI; the
  other used the installed PostgreSQL 18.6. The entry points remain env-gated
  so the default `bun test` needs no infrastructure.
- The `328 pass / 0 fail` figure is the actual output of `bun test` with both
  URLs configured (1,593 assertions across 328 tests, 12 files). Without
  servers the same command is `262 pass / 2 skip / 0 fail` (264 tests, 1,163
  assertions), skipping only those two gated entry points.
- The CI workflow ran on a hosted GitHub runner (run `39199669711`, `caefc1b`):
  both jobs are green, including the live MySQL/PostgreSQL service-container
  job. The preceding run failed at `bun install --frozen-lockfile`; the
  lockfile was refreshed from committed files only, rehearsed in a clean clone,
  and the rerun passed (§4.8).
