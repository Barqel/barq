# Known limitations

Everything below is a deliberate, documented gap — not a hidden one. If a
feature is not listed here, it is expected to work; if you find otherwise, the
right move is a failing test in `tests/`.

## Deliberate gaps and constraints

- **Lazy-loaded relations.** By design: accessing `user.posts` without
  `with("posts")` is a compile-time error in typed code and never triggers a
  query. `RelationNotLoadedError` exists for dynamic access paths.
- **Relation paths deeper than 4 levels.** `AllRelationPaths` walks relations
  up to depth 4; deeper chains must be loaded step by step.
- **Relation-manager names are runtime strings at the instance level.** A base
  model instance cannot see its subclass's static relation map, so
  `user.relation("…")` and `user.load("…")` accept `string` and validate at
  runtime. Cast through `unknown` to
  `RelationManagerOf<typeof User, "posts">` when the compile-time manager
  surface matters; `User.query().with("posts")` remains fully typed.
- **Loaded extras are typed from the literal reference.** `loadCount`,
  `loadSum`, `loadAvg`, `loadMin`, `loadMax` and `loadAggregate` return
  `this & { postsCount: number }` (or `postsSumViews: number | null`), and
  `withCount`/`withSum`/… widen the query's `Loaded` type the same way. Pass the
  alias form (`loadCount("posts as pinned")` → `pinnedCount`) to name the
  property. The reference itself is a runtime-validated string at the instance
  level, exactly like `user.load("…")`.
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
  `instanceof Collection` / `String(...)` when needed. The same is true for
  Priority-2 names: `int`/`float` coerce at runtime, `decimal:<n>` returns a
  fixed-scale string and `date:<fmt>`/`datetime:<fmt>` return formatted
  strings, while the static return type stays the schema type. Custom casts
  that declare `set` still narrow write payloads through `CastedValues`.
- **Cursor pagination is key-set based.** `cursorPaginate` orders by one column
  (`column`/`direction`, the primary key by default) or several (`order`), and
  returns `nextCursor`, `prevCursor`, `hasMore` and `hasPrevious`. Cursors are
  opaque and only valid for the same ordering and query filters — mixing them
  throws `InvalidQueryError` when the value count does not match. There is no
  total count (`total()`, `simplePaginate(…)` and `chunkById` remain
  offset-based), and cursor values travel through JSON, so `bigint` keys are
  tagged and restored exactly while `Date` keys are restored as `Date`.
- **JSON overlap is one semantic everywhere.** `whereJsonOverlaps` follows
  MySQL's `JSON_OVERLAPS` on every dialect: scalars compare by equality, arrays
  by shared elements, objects by shared key/value pairs (values compare
  structurally). MySQL uses the native operator; PostgreSQL compiles to
  `jsonb_typeof`/`jsonb_array_elements`/`jsonb_each` subqueries and SQLite to
  `json_each`, so a partial array overlap matches on all three. JSON paths
  accept the subset `$.a.b` / `a.b` (letters, digits, `_`, `$`); array indexes
  and quoted keys are rejected with `InvalidQueryError`.
- **`Stringable` covers the common surface.** Case conversion
  (`upper`/`lower`/`title`/`camel`/`studly`/`snake`/`kebab`/`ucfirst`/`lcfirst`),
  trimming, padding (`padLeft`/`padRight`), truncation (`limit`/`words`),
  search (`contains`/`startsWith`/`endsWith`/`is`/`test`), slicing
  (`substr`/`before`/`after`/`between`/`reverse`), mutation
  (`append`/`prepend`/`repeat`/`replace`/`replaceFirst`/`replaceLast`), `slug`,
  `length`, `wordCount`, `value`, `toString` and `toJSON` — not Laravel's entire
  string API.
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
- **Custom pivot models cover hydration, writes and casts.** `using`
  instantiates the pivot class during eager loading and applies its casts in
  `attach`/`updateExistingPivot`. Pivot events fire on the *parent* model class
  (`User.onPivot("pivotAttached", payload)`), matching Eloquent, not on the
  pivot class. Extra columns still need `withPivot` (and `timestamps` for pivot
  timestamps) to be selected, and relation-manager queries still return plain
  related models without pivot objects.
- **One-of-many selects exactly one row everywhere.** Eager loading, `whereHas`
  and `withCount`/`withSum`/`withAvg`/`withMin`/`withMax` compare the related
  primary key against an ordered `limit 1` subquery, so tied extremes still
  match exactly one row (the predicate and eager loading share the
  primary-key tie-break in the aggregate's direction). A related table without
  a primary key raises `InvalidQueryError`; pass the `primaryKey` option when
  the key lives outside the schema. The extreme subquery always applies the
  model's default soft-delete scope, even when the surrounding constraint
  callback calls `withTrashed()`.
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
- **Self-referential nested paths are aliased, not ambiguous.** A path such as
  `whereHas("parent.parent")` on a self-referencing relation aliases each inner
  table that would shadow its owner (`<table>__rel_<depth>`), so every `EXISTS`
  correlates against the enclosing row. The same aliasing applies to
  self-referential `withCount`/`withSum` and `withExists`; `wherePivot`-style
  through-relation joins are not aliased.
- **`increment` / `decrement` on non-numeric columns.** Only declared
  `integer`, `bigint`, `float`, `double` and `decimal` columns are accepted;
  runtime validation rejects everything else instead of corrupting values.
- **SQLite constraint drops rebuild the table.** `dropUnique`/`dropForeign` on
  SQLite drop a named unique index directly (`drop index`); a named
  table-level constraint (every foreign key) is removed with SQLite's
  documented rebuild: a scratch table is created from the original
  `sqlite_master` statement minus that clause, rows are copied, the old table
  is dropped and the new one renamed, and the remaining indexes are recreated.
  `foreign_keys` is toggled off for the swap, so a rebuild inside an
  application transaction runs with foreign keys enabled — keep it in a
  migration. Constraints SQLite auto-names (`sqlite_autoindex_…`, e.g. an
  unnamed inline `unique`) cannot be addressed by name and raise `SchemaError`.
  MySQL tries `drop foreign key` then `drop index`; PostgreSQL tries
  `drop constraint` then `drop index`.
- **`migrator.fresh()` is destructive.** It calls `dropAllTables()` (which
  returns the dropped names) and re-runs all migrations, dropping *every* table
  in the connected database (schema-introspected). Point it at a scratch
  database; `reset()`/`refresh()` only reverse recorded batches. Use
  `dropAllTables()` directly when a test fixture needs the same behaviour
  without re-running migrations.
- **Connection-scoped transactions.** `orm.connection(name)` returns a cached
  child `Orm` sharing the schema, listeners, morph map and macros, but each
  connection has its own `AsyncLocalStorage` transaction context. A transaction
  opened on the default connection does not cover queries sent through a child
  connection (and vice versa).
- **`whereAttachedTo` uses the related model's real primary key.** For
  has-one/has-many/pivot/through relations the predicate is
  `whereHas(relation, q => q.where("<related primary key>", target.get("<pk>")))`
  (a table without a primary key raises `InvalidQueryError`). `belongsTo` uses
  the configured owner key (defaulting to the related model's primary key) and
  `morphTo` uses the morph columns and the target's primary key.
- **Pruning fires model events.** `static prunable` narrows the query, then
  each chunk is loaded and deleted per instance, so `deleting`/`deleted` (and
  `trashed` for soft-deleting models) run and a `deleting` listener can cancel
  individual rows. For very large tables, delete in bulk yourself when the
  events are not needed.
- **Factories and seeders are plain helpers.** Factory definitions go through
  `prepareAssignment` (fillable/guarded apply); `runSeeders(orm, seeders, {
  transaction: true })` wraps the whole list in one `orm.transaction()`, while
  the default keeps Eloquent's un-transactional behaviour.
- **MySQL foreign keys are table-level.** `references()`/`constrained()`
  compile to named table-level constraints on every dialect because MySQL
  parses but ignores inline `references`; columns added with `alter()` get a
  follow-up `alter table … add constraint`.

## Behavioral notes / sharp edges

- **Soft deletes are opt-in.** `static softDeletes = true` uses `deletedAt`;
  `static softDeletes = { column: "removedAt" }` overrides it. The column must
  exist in the schema. `withTrashed()`, `onlyTrashed()`, `restore()` and
  `forceDelete()` throw `InvalidQueryError` on models without soft deletes.
- **Model events are in-process listeners.** They run synchronously in the
  operation's async flow (notification listeners are awaited). There is no
  queue, retry or cross-process delivery. `withoutModelEvents()` suppresses
  them through `AsyncLocalStorage`, so concurrent scopes stay isolated. Pivot
  writes (`attach`/`detach`/`updateExistingPivot`, and the `sync`/`toggle`
  helpers built on them) fire `pivotAttaching`/`pivotAttached`,
  `pivotDetaching`/`pivotDetached` and `pivotUpdating`/`pivotUpdated` on the
  parent model class; the `…ing` gates cancel the write when a listener returns
  `false`.
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
  `bun test`, including DDL, CRUD, relations, aggregates, soft deletes, events
  (model and pivot), polymorphic/through relations, transactions, savepoints,
  migrations (including `dropAllTables` and the SQLite constraint rebuild),
  collections, relation managers, scopes, cursor/lazy pagination, lifecycle
  helpers and advanced casts. The Node `node:sqlite` path is covered by
  `tests/node/smoke.mjs`, which runs the built and the packed package under
  Node 24 (CI job `node-runtime`) against SQLite, MySQL and PostgreSQL.
- **BigInt mode**: covered on live SQLite (full signed range, filters,
  updates, insert IDs, models, relations and relation aggregates) and by the
  shared live suite on MySQL/PostgreSQL, including a MySQL insert id beyond
  `Number.MAX_SAFE_INTEGER`. Type-level tests assert `bigint` row, insert,
  aggregate and relation-aggregate types.
- **MySQL / PostgreSQL**: verified live against local MySQL 8.4.11 and
  PostgreSQL 18.6, and Podman MySQL 8.4.11 / PostgreSQL 16.15 scratch
  databases, including DDL, auto-increment identity, CRUD, relations/eager
  loading, polymorphic and pivot relations (`morphedByMany`, pivot
  extras/timestamps, `wherePivot`/`wherePivotIn`/`orderByPivot`, pivot events),
  one-of-many extremes (tie-exact predicates), default owners, aggregates,
  upserts, soft deletes, transactions and migrations, plus the Priority-2,
  Priority-3 and Priority-4 blocks (cast write/read coercion, `char`/sized-int/
  `jsonb`/`unsigned` DDL, `dropUnique`/`dropForeign` incl. the SQLite rebuild,
  migrator `pretend`/`reset`/`refresh`/`fresh`/`dropAllTables`, pruning with
  events, factories/seeders (transactional and not), JSON
  paths/keys/length/overlaps, `whereMorphedTo`/`whereAttachedTo`, custom pivot
  casts, pivot events, self-referential nested aliasing and bidirectional
  multi-column cursor pagination). SQL generation is also asserted
  statement-by-statement via `@barqel/barq-orm/testing` (`compileOnlyOrm`).
  The entry points stay env-gated and skip cleanly unless
  `BARQ_ORM_MYSQL_URL` / `BARQ_ORM_PG_URL` are set; `.github/workflows/orm.yml`
  supplies both as service containers and runs the entire suite.
- **Node.js < 24**: `node:sqlite` is unstable/flagged below Node 24; use Bun or
  Node ≥ 24 for SQLite. The MySQL/PG drivers are plain `mysql2`/`pg` and work on
  older Node versions.
- **npm publish is the one gap that cannot be closed here.** The package is
  built, packed (`bun pm pack`) and installed from the tarball in CI, but no
  registry credentials exist in this environment, so `@barqel/barq-orm` has not
  been published.
