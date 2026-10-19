# Known limitations

Everything below is a deliberate, documented gap — not a hidden one. If a
feature is not listed here, it is expected to work; if you find otherwise, the
right move is a failing test in `tests/`.

## Deliberate gaps and constraints

- **Lazy-loaded relations.** By design: accessing `user.posts` without
  `with("posts")` is a compile-time error in typed code and never triggers a
  query. `RelationNotLoadedError` exists for dynamic access paths.
- **Relation paths deeper than 3 levels.** `AllRelationPaths` walks relations
  up to depth 3; deeper chains must be loaded step by step.
- **Relation-manager names are runtime strings at the instance level.** A base
  model instance cannot see its subclass's static relation map, so
  `user.relation("…")` and `user.load("…")` accept `string` and validate at
  runtime. Cast through `unknown` to
  `RelationManagerOf<typeof User, "posts">` when the compile-time manager
  surface matters; `User.query().with("posts")` remains fully typed.
- **Loaded extras are not part of the instance's static type.** `loadCount`,
  `loadSum`, `loadAvg`, `loadMin`, `loadMax` and `loadAggregate` attach
  `postsCount`/`postsSumViews`/… at runtime. Extend or cast the instance type
  when you need those properties statically.
- **`morphTo` constraints and aggregates.** A morph-to has no single target
  table, so it cannot be constrained through the generic
  `whereHas("commentable", cb)`, nested (`whereHas("commentable.posts")`),
  aggregated (`withCount("commentable")`, `withSum(...)`) or constrained
  eagerly (`with({ commentable: cb })`). Use
  `whereHasMorph("commentable", ["posts"], cb)` for alias-scoped constraints.
  Bare `whereHas("commentable")`, `whereDoesntHave("commentable")` and
  `with("commentable")` work; the other forms are compile errors in typed code
  and runtime `InvalidQueryError`s otherwise.
- **Scope declarations need a helper or explicit annotations.** TypeScript
  cannot contextually type a whole static initializer from the base model, and
  a field annotated directly with `typeof Model` can become circular. Use
  `defineScopes(schema, "table", {…})` / `defineGlobalScopes(schema, "table",
  {…})`, or annotate callbacks explicitly with `LocalScope<typeof Model, [args]>`
  / `GlobalScope<typeof Model>`. The helpers preserve literal scope names so
  `scope("nope")` and `withoutGlobalScopes("nope")` are compile errors.
- **Collections are Array subclasses.** Query/model reads return `Collection`,
  and helpers such as `map`, `filter`, `slice`, `merge`, `pluck`, `where` and
  `groupBy` return collections. Methods not overridden by `Collection` keep
  native array behavior; native methods can return plain arrays because
  `Symbol.species` is `Array`. Prefer the documented collection helpers.
- **Cast read values are runtime-narrowed.** `get()` is typed from the schema.
  A `collection` cast returns a `Collection` and a `stringable` cast returns a
  `Stringable`, but schema columns typed `json` remain broad; narrow with
  `instanceof Collection` / `String(...)` when needed. Cast getters do not
  rewrite the static `get()` return type.
- **Cursor pagination is forward-only.** `cursorPaginate` orders by one column
  (the primary key unless `column` is passed), emits an opaque `nextCursor`,
  and always returns `prevCursor: null`. It does not combine with arbitrary
  multi-column ordering or return a total count.
- **SQLite JSON predicates have a pragmatic subset.** `whereJsonContains`
  supports top-level scalars, top-level arrays, and one-level objects;
  `whereJsonLength` measures a top-level JSON array. Deep JSON paths are not
  exposed as a builder API — use `whereRaw`/`raw()` for path expressions.
- **`Stringable` is intentionally small.** It covers common string operations
  (case, trim, contains/starts/ends, replace, slug/camel/studly, length, value,
  JSON), not Laravel's entire string API.
- **Touched owners are direct table updates.** `static touches` only follows
  `belongsTo` relations, updates the owner's configured `updatedAt` column
  after a successful save, and does not fire owner model events or touch
  recursively.
- **Pivot managers need a real pivot table.** `attach`/`sync`/`toggle` and
  friends require the relation's `through` table and keys to exist in the
  database/schema; calling pivot methods on non-pivot relations throws
  `InvalidQueryError`. `hasManyThrough` managers support reads, not writes.
- **Pivot objects and pivot constraints have different homes.** Extra pivot
  columns (`withPivot`), pivot timestamps (`timestamps`) and the renamed
  accessor (`as`) are hydrated only by eager loading — `with("roles")` attaches
  one pivot object per (parent, related) pair, including morph pivots'
  `${name}Type` column. Relation-manager queries
  (`user.relation("roles").query()`) return plain related models without pivot
  objects, and `wherePivot`/`wherePivotIn`/`orderByPivot` exist on the manager
  only — never inside an eager-load constraint callback or `whereHas`.
  `orderByPivot` compiles to a correlated scalar subquery with `limit 1`; with
  duplicate pivot rows the ordered value is the first matching row's.
- **Custom pivot models are not supported.** Pivot rows hydrate into plain
  records (`role.membership.note`), not a model class; Eloquent-style
  `using()` pivot models, pivot casts and pivot events do not exist.
- **One-of-many rows come in two flavors.** Eager loading (`with("latestPost")`)
  returns a single row and breaks ties deterministically on the primary key in
  the aggregate's direction. `whereHas`/`withCount`/`withSum` and manager
  `query()` use the correlated `= extreme` predicate, which matches *every*
  tied row — with duplicate extremes a count can exceed one. The extreme
  subquery always applies the model's default soft-delete scope, even when the
  surrounding constraint callback calls `withTrashed()`.
- **Morph alias resolution order.** The string stored in polymorphic columns is
  `static morphAlias` → global `orm.morphMap({…})` → table name. Registering or
  changing a map entry only affects writes/reads after it; existing rows keep
  the alias they were written with. `whereHas("commentable")` (bare `morphTo`)
  admits the relation's own types map plus every global map alias, and eager
  loading resolves unknown type strings through the global map. `morphedByMany`
  keeps the declaring model's perspective: `foreignPivotKey` references the
  local model, `relatedPivotKey` is the morph id column, and the type column
  stores the *related* class's alias.
- **`morphTo` manager queries need a resolvable type.**
  `comment.relation("commentable").query()` builds a builder for the class
  registered for this row's type (types map → global morph map) and throws
  `InvalidQueryError` when the type column is null or unknown.
- **Self-referential nested `whereHas`.** A path such as
  `whereHas("parent.parent")` on a self-referencing relation compiles to two
  `EXISTS` blocks that use the same table alias; at depth ≥ 2 the inner
  correlation can be ambiguous. Use an explicit join or split the query.
- **`increment` / `decrement` on non-numeric columns.** Only declared
  `integer`, `bigint`, `float`, `double` and `decimal` columns are accepted;
  runtime validation rejects everything else instead of corrupting values.

## Behavioral notes / sharp edges

- **Soft deletes are opt-in.** `static softDeletes = true` uses `deletedAt`;
  `static softDeletes = { column: "removedAt" }` overrides it. The column must
  exist in the schema. `withTrashed()`, `onlyTrashed()`, `restore()` and
  `forceDelete()` throw `InvalidQueryError` on models without soft deletes.
- **Model events are in-process listeners.** They run synchronously in the
  operation's async flow (notification listeners are awaited). There is no
  queue, retry or cross-process delivery. `withoutModelEvents()` suppresses
  them through `AsyncLocalStorage`, so concurrent scopes stay isolated.
- **Hashed casts are one-way.** `hashed` stores a salted scrypt hash and never
  hydrates the original value; use `verifyHashedValue(value, hash)` for login
  checks. Assigning a value that already starts with `scrypt:` is idempotent.
- **Encrypted casts need a key.** `encrypted` uses AES-256-GCM and requires
  `new Orm({ encryptionKey })`; using the cast without a key throws
  `CastError`. The GCM authentication tag detects tampering, but ciphertext is
  not bound to a column or row identity.
- **Accessor names are reserved.** An accessor may not collide with a database
  column or a member of `Model.prototype`; the class is rejected with
  `SchemaError`. Accessors are computed on every read and only included in
  `toJSON()` when listed in `appends`.
- **`firstOrCreate` race windows.** The lookup and insert are separate
  statements. A unique index is still required to make concurrent callers
  safe; the resulting constraint error is translated, but the helper does not
  retry the lookup automatically.
- **64-bit precision is opt-in.** Default `bigint` columns remain `number`
  for compatibility, so values beyond `Number.MAX_SAFE_INTEGER` lose precision.
  Use `defineSchema(schema, { bigInt: true })` or `bigInt: true` on individual
  columns for exact `bigint` values. Raw `orm.raw(...)` results always stay
  driver-native (MySQL/PostgreSQL decimal strings, SQLite `bigint` in BigInt
  mode), and `JSON.stringify` needs a `bigint`-to-string replacer.
- **SQLite foreign keys are enabled per connection.** The driver executes
  `PRAGMA foreign_keys = ON` when it opens a connection. Use
  `orm.raw("pragma foreign_keys = off")` explicitly if you need the engine
  default instead.
- **Upsert conflict behavior.** SQLite/PostgreSQL compile to
  `on conflict (<columns>) do update set <col> = excluded.<col>`. MySQL has no
  `ON CONFLICT`: it compiles to `ON DUPLICATE KEY UPDATE` and cannot accept a
  conflict target — MySQL picks the unique key itself, and the incoming row is
  read through `values(<column>)` (deprecated in MySQL 8.0.20+ but valid).
- **MySQL DDL and transactions.** MySQL auto-commits DDL; migrations on MySQL
  cannot roll back schema changes as a unit. The bookkeeping row is still
  written atomically.
- **Transaction isolation option** is passed to the driver where supported
  (`set transaction isolation level`); SQLite ignores it (single-writer).
- **`raw()` placeholders.** `orm.raw(sql, parameters)` sends the SQL verbatim:
  use `?` for SQLite/MySQL and `$1..$n` for PostgreSQL. The typed query builder
  and `raw()` expressions (`whereRaw(raw("length(name) > ?", [5]))`) translate
  placeholders per dialect automatically.

## Verification status

- **SQLite** (Bun `bun:sqlite`): the full integration suite runs on every
  `bun test`, including DDL, CRUD, relations, aggregates, soft deletes, events,
  polymorphic/through relations, transactions, savepoints, migrations,
  collections, relation managers, scopes, cursor/lazy pagination, lifecycle
  helpers and advanced casts. The Node `node:sqlite` path is exercised by the
  packed-package smoke test on Node 24, not by the full suite.
- **BigInt mode**: covered on live SQLite (full signed range, filters,
  updates, insert IDs, models, relations and relation aggregates) and by the
  shared live suite on MySQL/PostgreSQL, including a MySQL insert id beyond
  `Number.MAX_SAFE_INTEGER`. Type-level tests assert `bigint` row, insert,
  aggregate and relation-aggregate types.
- **MySQL / PostgreSQL**: verified live with the shared 21-test
  `runDialectSuite` against MySQL 8.4.11 and PostgreSQL 16.15 and 18.6,
  including DDL, auto-increment identity, CRUD, relations/eager loading,
  polymorphic and pivot relations (`morphedByMany`, pivot extras/timestamps,
  `wherePivot`/`wherePivotIn`/`orderByPivot`), one-of-many extremes, default
  owners, aggregates, upserts, soft deletes, transactions and migrations. SQL
  generation is also asserted statement-by-statement via
  `@barqel/barq-orm/testing` (`compileOnlyOrm`).
  The entry points stay env-gated and skip cleanly unless
  `BARQ_ORM_MYSQL_URL` / `BARQ_ORM_PG_URL` are set; `.github/workflows/orm.yml`
  supplies both as service containers and runs the entire suite.
- **Node.js < 24**: `node:sqlite` is unstable/flagged below Node 24; use Bun or
  Node ≥ 24 for SQLite. The MySQL/PG drivers are plain `mysql2`/`pg` and work on
  older Node versions.
