# @barqel/barq-orm

A typed, Laravel-inspired ORM for **Bun** and **Node.js**.

Eloquent-style models, a composable query builder, explicit batched relations,
real transactions with savepoints, a schema DSL, reversible migrations — built
on [Kysely](https://kysely.dev) as an internal SQL engine that never leaks into
the public API.

```ts
const user = await User.query()
	.with("posts.comments")
	.withCount("posts")
	.where("active", true)
	.orderBy("id", "desc")
	.firstOrFail();

console.log(user.postsCount, user.posts[0]?.comments[0]?.get("body"));
```

- **Two execution paths** — typed rows (`orm.table("users")`) for raw speed,
  full models (`User.query()`) for behavior. No hidden queries: relations are
  never lazy-loaded; every relation is loaded explicitly with `with()` and
  batched without N+1.
- **Eloquent parity where it matters** — collect.js-backed `Collection`s for
  query results, pagination and relations; soft deletes; relation write
  managers; instance loaders; global/local scopes; model events and observers;
  accessors/mutators/casts/appends; polymorphic and through relations
  (`morphToMany`/`morphedByMany` with an optional global morph map); pivot
  extras (`withPivot`, `timestamps`, `as`) with
  `wherePivot`/`wherePivotIn`/`orderByPivot`; one-of-many
  (`latestOfMany`/`oldestOfMany`/`ofMany`) and `withDefault`/`withDefaultFor`;
  lifecycle helpers; `firstOrCreate`/`updateOrCreate`/`createOrFirst`; atomic
  `increment`/`decrement`; `withSum`/`withAvg`/`withMin`/`withMax` with
  constraint callbacks and a generic `withAggregate`;
  `whereHas`/`whereDoesntHave`; and opt-in exact 64-bit `BigInt` mode.
- **Types are the source of truth** — the schema drives row types, insert and
  update payloads, filter value types, relation paths and migration context.
  Unknown tables, columns and relations are compile-time errors, and every
  boundary is asserted by the type-test suite.
- **No `any` in the public API** — the only erased boundaries are documented,
  single-spot assertions around Kysely inside the package.

## Requirements

| Runtime / engine | Support |
| --- | --- |
| Bun | `bun:sqlite` built in (zero extra deps) |
| Node.js ≥ 24 | `node:sqlite` built in (zero extra deps) |
| MySQL 8.x (verified 8.4.11) | `mysql2` (optional peer dependency) |
| PostgreSQL 14+ (verified 16.15 and 18.6) | `pg` (optional peer dependency) |

```sh
bun add @barqel/barq-orm
# pick what you use:
bun add mysql2
bun add pg
```

`kysely` and `collect.js` are runtime dependencies. `mysql2` and `pg` are
optional peer dependencies, imported lazily — applications that only use
SQLite never load them.

### Database support honesty

| Dialect | SQL generation | Live integration tests |
| --- | --- | --- |
| SQLite | tested | ✅ full live suite on every `bun test` (Bun driver); the Node `node:sqlite` path is covered by the built + packed smoke test |
| MySQL | tested | ✅ 33-test live suite against MySQL 8.4.11 |
| PostgreSQL | tested | ✅ 33-test live suite against PostgreSQL 16.15 and 18.6 |

MySQL and PostgreSQL are verified against live servers. The shared conformance
suite stays env-gated so the default `bun test` never needs infrastructure.
The [ORM CI workflow](https://github.com/Barqel/barq/blob/main/.github/workflows/orm.yml)
provisions both engines as service containers and runs the full suite
(including every live test) on each push and pull request that touches this
package, plus a Node job that smokes the built and packed artifact against all
three engines:

```sh
BARQ_ORM_MYSQL_URL=mysql://root:secret@127.0.0.1:3306/barq_test bun test tests/integration/mysql.test.ts
BARQ_ORM_PG_URL=postgres://postgres:secret@127.0.0.1:5432/barq_test bun test tests/integration/postgres.test.ts
node tests/node/smoke.mjs   # Node runtime, built dist (or `bun run smoke`; add the URLs for live engines)
```

## Quickstart

```ts
import { Orm, defineSchema } from "@barqel/barq-orm";
import { sqlite } from "@barqel/barq-orm/sqlite";

const schema = defineSchema({
	users: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		name: "string",
		email: "string",
		age: { type: "integer", nullable: true },
		active: { type: "boolean", default: true },
	},
	posts: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		userId: "integer",
		title: "string",
		views: { type: "integer", default: 0 },
	},
});

const orm = new Orm({ schema, dialect: sqlite("app.db") });
```

Create the tables with the schema DSL (or a migration — see below):

```ts
await orm.schemaBuilder().create("users", (t) => {
	t.id();
	t.string("name", 120);
	t.string("email", 190).unique();
	t.boolean("active").default(true);
});
```

### Typed rows

```ts
const inserted = await orm.table("users").insert({ name: "Ada", email: "a@b.c" });
// inserted.id: number | undefined

const adults = await orm
	.table("users")
	.where("age", ">=", 18)
	.orderBy("name")
	.limit(20)
	.get();
// adults[number].name: string — fully typed
```

### 64-bit integers (BigInt mode)

`bigint` columns are typed as `number` by default. JavaScript cannot represent
every signed 64-bit integer exactly, so opt into `bigint` when a column may
cross `±(2^53 - 1)` — IDs, ledgers, counters, external IDs or timestamps:

```ts
// Every bigint column in the schema becomes bigint.
const schema = defineSchema(
	{
		ledger: {
			id: { type: "bigint", primaryKey: true, autoIncrement: true },
			amount: "bigint",
			note: "string",
		},
	},
	{ bigInt: true },
);
const bigIntOrm = new Orm({ schema, dialect: sqlite("app.db") });

// Or opt in per column.
const mixed = defineSchema({
	metrics: {
		total: "bigint", // number
		huge: { type: "bigint", bigInt: true }, // bigint
	},
});
```

The schema drives the complete path:

```ts
const maximum = 9223372036854775807n;
const inserted = await bigIntOrm.table("ledger").insert({ amount: maximum });
// inserted.id: bigint | undefined

const exact = await bigIntOrm
	.table("ledger")
	.where("amount", maximum)
	.firstOrFail();
// exact.amount: bigint — all 64 bits preserved

const totals = await bigIntOrm.table("ledger").sum("amount"); // bigint
const mean = await bigIntOrm.table("ledger").avg("amount"); // number (fractional)
```

- Typed rows, `where`/`whereIn`/`update` bindings, primary keys, insert IDs,
  model `create`/`find`/`save`, `pluck`, eager relations (including pivot keys)
  and `min`/`max`/`sum` all preserve `bigint`.
- Relation aggregates follow the same rule: `withSum`, `withMin` and `withMax`
  return `bigint`; `withAvg` returns `number`.
- SQLite enables its safe-integer mode automatically when the schema contains
  a BigInt column. MySQL enables `supportBigNumbers`/`bigNumberStrings`, and
  PostgreSQL keeps `int8` as an exact decimal string internally. The row plan
  converts those driver values to the type promised by the schema.
- `orm.bigIntMode` reports whether the schema enabled the mode.
- `bigInt: true` is rejected at definition time on non-`bigint` columns.

**Raw SQL bypasses the schema.** `orm.raw(...)` returns driver-native values:
decimal strings for MySQL `BIGINT` and PostgreSQL `int8`, and `bigint` for
SQLite when BigInt mode is active. Convert explicitly with `BigInt(value)` when
needed.

**JSON:** `JSON.stringify` throws on `bigint`. Serialize through a replacer:

```ts
const json = JSON.stringify(rows, (_key, value) =>
	typeof value === "bigint" ? value.toString() : value,
);
```

### Models

```ts
import { belongsTo, hasMany } from "@barqel/barq-orm";

class User extends orm.model("users") {
	static relations = {
		posts: hasMany(() => Post, "userId"),
	};
	static casts = { active: "boolean" } as const;
	static mutators = {
		email: (value: unknown) => String(value).trim().toLowerCase(),
	};
	static accessors = {
		displayName: (user: User) => `${user.get("name")} (${user.get("id")})`,
	};
	static appends = ["displayName"] as const;
	static hidden = ["email"] as const;
}

class Post extends orm.model("posts") {
	static relations = {
		author: belongsTo(() => User, "userId"),
	};
}

const user = await User.create({ name: "Ada", email: "ADA@Example.com" });
user.displayName;       // computed on access
user.toJSON().displayName; // only because it is in `appends`
user.set("name", "Ada Lovelace");
user.getDirty();        // { name: "Ada Lovelace" }
await user.save();
```

Instances carry dirty tracking, typed accessors/mutators, casts, timestamps,
mass-assignment protection (`fillable` allow-list / `guarded` deny-list —
unknown keys throw), `getOriginal()`, `replicate()` and `toJSON()` with
`hidden`/`visible` rules, accessors listed in `appends`, and any loaded
relations.

The Eloquent metadata surface is available on every instance —
`getTable()`, `getKeyName()`, `getKeyType()`, `getIncrementing()`,
`getQualifiedKeyName()`, `getForeignKey()`, `getRouteKeyName()`,
`getMorphClass()`, `getCasts()`, `getFillable()`, `getGuarded()`,
`getHidden()`, `getVisible()`, `getAppends()`, `getAttributes()`,
`getRelations()`, `relationLoaded()`, `wasChanged()`, `getAttribute()`,
`getAttributeValue()`, `setAttribute()`, `unsetRelation()` and
`unsetRelations()`.

Accessors and mutators may also be `Attribute` objects (Eloquent's
`Attribute` class), which bundle a getter and a setter:

```ts
import { Attribute } from "@barqel/barq-orm";

class User extends orm.model("users") {
	static accessors = {
		displayName: new Attribute({
			get: (user: User) => `${user.get("name")} (${user.get("id")})`,
		}),
	};
	static mutators = {
		email: new Attribute({ set: (value: string) => value.trim().toLowerCase() }),
	};
}
```

### Strict mode, unique ids and suspended behaviour

```ts
// Fail loudly instead of passing silently.
Model.shouldBeStrict();               // every check below
User.preventAccessingMissingAttributes();
User.preventSilentlyDiscardingAttributes();
User.preventLazyLoading();
User.handleLazyLoadingViolationUsing((model, relation) => report(model, relation));

// Suspend behaviour for a block (an async callback stays suspended until it settles).
await User.withoutCasting(async () => { /* raw values */ });
await Post.withoutTouching(async () => { /* owners are not touched */ });

// Generated primary keys (ULIDs are sortable and monotonic per millisecond).
class Ticket extends orm.model("tickets") {
	static usesUniqueIds = "ulid";   // or "uuid"
}
```

Casts include `boolean`, `json`/`array`, `object`, `collection`, `stringable`,
`int`/`integer`, `float`/`double`/`real`, `decimal`/`decimal:<scale>`,
`date`/`datetime`, parameterized `date:<format>`/`datetime:<format>` (the
PHP-style tokens `Y y m n d j H G i s u`), `immutable_date`/
`immutable_datetime`, `number`, `string`, `encrypted`, `encrypted:array`,
`encrypted:collection`, `hashed`, enum validation and class-based
`static get` / `static set` custom casts.

Integer casts truncate on write (`41.9 → 41`), float casts coerce numeric
strings, `decimal:<n>` returns fixed-scale strings, formatted date casts read
and write strings in the requested format, and `immutable_*` hands out a
defensive `Date` copy on every read. Casts are runtime behavior: the static
`get()` type stays schema-derived (see the limitations).

```ts
const encryptedOrm = new Orm({
	schema,
	dialect: sqlite("app.db"),
	encryptionKey: "…",
});
class Secret extends encryptedOrm.model("users") {
	static casts = { token: "encrypted", password: "hashed" } as const;
}

const secret = await Secret.findOrFail(1);
verifyHashedValue("hunter2", secret.get("password")); // boolean
```

`encrypted` requires `Orm({ encryptionKey })`; `hashed` is one-way and pairs
with `verifyHashedValue()`. Assignment applies the mutator, then the cast's
`set` + `get` round-trip; hydration applies `get`; writes apply `set`.

Casts may also be declared through a method (Eloquent's `Castable` shape), and
one query may override them:

```ts
class Account extends orm.model("users") {
	static casts() {
		return { settings: "collection" as const };
	}
}

// Only the rows of this query use the override.
await Account.query().withCasts({ settings: "json" }).get();
```

```ts
class MoneyCast {
	static get(value: unknown) {
		return Number(value) / 100;
	}
	static set(value: unknown) {
		return Math.round(Number(value) * 100);
	}
}

class Account extends orm.model("users") {
	static casts = {
		settings: "collection",       // -> Collection at runtime
		nickname: "stringable",       // -> Stringable at runtime
		status: { enum: { Active: "active", Banned: "banned" } },
		balance: MoneyCast,
		privateNotes: "encrypted:collection",
	} as const;
}
```

`get()` stays typed from the schema; cast read values such as `Collection` and
`Stringable` are runtime values, so narrow with `instanceof` / `String(...)`
when the schema type is broader (for example `json`).


### Collections

Reads return `Collection<T>`: an `Array<T>` subclass powered by
[collect.js](https://collect.js.org). Index access, `length`, spread, `for…of`
and `JSON.stringify` keep working, while the Eloquent helpers return typed
collections.

```ts
const users = await User.query().with("posts").get(); // Collection<User>
users.pluck("name").all();
users.where("active", true).count();
users.groupBy("countryId");
loadedUser.posts.sum("views"); // model attributes read through get()

const names = await User.query().pluck("name"); // Collection<string>
const page = await User.query().paginate(20);   // page.data: Collection<User>
```

Collections are returned by `get()`, `pluck()`, `chunk()`/`chunkById()`
callbacks, `paginate`/`simplePaginate`/`cursorPaginate` data, model
`all`/`findMany`/`createMany`, eager-loaded to-many relations and relation
managers. Helpers include `all`/`toArray`/`toJSON`, `first`/`last`, `map`,
`filter`/`reject`, `flatMap`/`flatten`/`collapse`, `each`/`tap`/`pipe`,
`when`/`unless`, `contains`, `pluck`, `groupBy`/`keyBy`, `sortBy`/`reverse`,
`slice`/`merge`/`take`/`skip`/`chunk`, `unique`, `sum`/`avg`/`min`/`max`,
`where`/`whereIn`/`whereNotIn`/`whereNull`/`whereBetween`, and more. Model
attributes are resolved through `Model.get()`, so these helpers work on
hydrated models as well as plain rows.

### Soft deletes

```ts
class Post extends orm.model("posts") {
	static softDeletes = true; // "deletedAt"; or { column: "removedAt" }
}

await post.delete();       // UPDATE ... SET deletedAt = now()
post.trashed();            // true
await post.restore();      // clears deletedAt
await post.forceDelete();  // physical DELETE

Post.withTrashed().where("id", 1).first();
Post.onlyTrashed().count();
Post.query().where("id", 1).delete();      // soft delete
Post.query().where("id", 1).forceDelete(); // hard delete
```

The default scope hides trashed rows from reads, counts, pagination and eager
loading. `with({ posts: (q) => q.withTrashed() })` opts back in per relation.
Using soft-delete helpers on a model without `softDeletes` throws
`InvalidQueryError`.

### Model events and observers

```ts
const off = User.on("creating", (user) => {
	if (user.get("email").endsWith("@blocked.test")) return false; // cancel
});
User.observe({
	created: (user) => audit("created", user.get("id")),
	updated: (user) => audit("updated", user.get("id")),
});
off(); // unsubscribe

await User.withoutEvents(async () => {
	await User.create({ name: "Seed", email: "seed@example.com" });
});
```

Lifecycle events: `retrieved`, `creating`/`created`, `saving`/`saved`,
`updating`/`updated`, `deleting`/`deleted`, `trashed`, `restoring`/`restored`,
`forceDeleting`/`forceDeleted`, `replicating`. Returning `false` from
`creating`, `saving`, `updating`, `deleting`, `restoring` or `forceDeleting`
cancels the operation. Listeners are per model class and process-local;
`withoutEvents()` uses `AsyncLocalStorage`, so concurrent scopes do not leak.

Pivot writes on the parent model fire `pivotAttaching`/`pivotAttached`,
`pivotDetaching`/`pivotDetached` and `pivotUpdating`/`pivotUpdated`, carrying a
typed `{ model, relation, ids, attributes }` payload:

```ts
const offPivot = User.onPivot("pivotAttaching", ({ relation, ids }) => {
	if (relation === "roles" && ids?.length === 0) return false; // cancel
});
await user.relation("roles").attach(roleId, { note: "primary" });
offPivot();
```


### Scopes and lifecycle helpers

Global scopes apply to every query for a model; local scopes are named query
fragments with typed arguments. `defineGlobalScopes` / `defineScopes` preserve
the literal scope names without a circular static-field annotation.

```ts
import { defineGlobalScopes, defineScopes } from "@barqel/barq-orm";

class User extends orm.model("users") {
	static globalScopes = defineGlobalScopes(schema, "users", {
		active: (query) => query.where("active", true),
	});
	static scopes = defineScopes(schema, "users", {
		named: (query, name: string) => query.where("name", name),
		verified: (query) => query.whereNotNull("email"),
	});
}

User.query().scope("named", "Ada").scope("verified").get();
User.withoutGlobalScopes("active").get(); // leave one scope out
User.withoutGlobalScopes().get();        // leave all out
```

Lifecycle helpers cover the common Eloquent instance operations:

```ts
await user.touch();                 // update updatedAt only
await user.fresh();                 // fresh instance or null
await user.push();                  // save the model and loaded relations
user.wasRecentlyCreated();
user.getChanges(); user.getPrevious(); user.getOriginal("name");
user.isDirty("name"); user.isClean("email");
user.is(other); user.isNot(other);
user.only("id", "name"); user.except("createdAt");
await user.saveQuietly();           // fire no model events
```

`static touches = ["author"]` touches the `belongsTo` owner's `updatedAt`
whenever the model is saved (including creates and updates). Touches are
direct owner-table updates and do not fire owner model events.

### Relations and eager loading

```ts
const users = await User.query()
	.with("posts.comments")   // nested paths are typed
	.withCount("posts")        // -> users[i].postsCount: number
	.withSum("posts", "views") // -> users[i].postsSumViews: number | null
	.whereHas("posts", (posts) => posts.where("title", "like", "%ORM%"))
	.get();
```

Every relation level costs one batched statement (`where in (...)`), never one
query per row. Morph-to batches one statement per concrete type, and constrained
through relations add one statement. Accessing a relation that was not loaded is
an error, not a hidden query.

Supported relations: `hasMany`, `hasOne`, `belongsTo`, `belongsToMany`,
`hasManyThrough`, `hasOneThrough`, `morphMany`, `morphOne`, `morphTo`,
`morphToMany` and `morphedByMany` — with typed keys derived from the related
model's columns and a typed union result for `morphTo`. `latestOfMany` /
`oldestOfMany` / `ofMany` build a one-of-many `hasOne` that selects the extreme
row per parent; `withDefault` / `withDefaultFor` attach a placeholder owner to
dangling `belongsTo` keys. One-of-many selects exactly one row everywhere —
eager loading, `whereHas` and the aggregates compare the related primary key
against an ordered `limit 1` subquery, so tied extremes never match twice.

```ts
class User extends orm.model("users") {
	static relations = {
		posts: hasMany(() => Post, "userId"),
		latestPost: latestOfMany(() => Post, "userId", "views"),
		oldestPost: oldestOfMany(() => Post, "userId", "views"),
		topPost: ofMany(() => Post, "userId", "views", "max"),
		roles: belongsToMany(() => Role, {
			through: "role_user",
			foreignPivotKey: "userId",
			relatedPivotKey: "roleId",
			withPivot: ["note"], // hydrated as role.membership.note
			timestamps: true, // createdAt/updatedAt written on attach
			as: "membership", // rename the pivot object
		}),
	};
}

class Tag extends orm.model("tags") {
	static relations = {
		// Inverse of morphToMany: the pivot's type column stores Post's alias.
		posts: morphedByMany(() => Post, "taggable", {
			through: "taggables",
			foreignPivotKey: "tagId",
			relatedPivotKey: "taggableId",
		}),
	};
}
```

Polymorphic type columns store `static morphAlias` when present, otherwise the
global `orm.morphMap({ posts: Post, videos: Video })` alias, otherwise the
table name. `morphTo` eager loading and bare `whereHas("commentable")` fall
back to the global map for type strings missing from the relation's own
`types` map.

```ts
// Constrained eager loading (per path).
User.query().with({
	posts: (posts) => posts.where("published", true).orderBy("id", "desc"),
	"posts.comments": (comments) => comments.limit(5),
});

// Existence filters, including nested paths and negation.
User.query()
	.whereHas("posts.author", (author) => author.where("name", "Ada"))
	.orWhereHas("profile")
	.whereDoesntHave("posts")
	.orWhereDoesntHave("profile")
	.get();

// Aggregates over relations, with optional aliases and constraints.
User.query()
	.withSum("posts", "views")
	.withAvg("posts", "views")
	.withMin("posts", "views")
	.withMax("posts", "views")
	.withCount("posts as pendingCount")
	.withCount({ posts: (posts) => posts.where("published", false) })
	.withSum("posts", "views", (posts) => posts.where("published", true))
	.withAggregate("posts", { function: "max", column: "views" })
	.get();
```


### Relation write managers and instance loading

`user.relation(name)` returns a manager bound to that parent row. Related
queries are scoped automatically; writes fill foreign/pivot keys for you.

```ts
import type { RelationManagerOf } from "@barqel/barq-orm";

const tags = post.relation("tags") as unknown as RelationManagerOf<
	typeof Post,
	"tags"
>;
await tags.attach([1, 2], { note: "initial" });
await tags.sync([2, 3]);
await tags.syncWithoutDetaching([3, 4]);
await tags.toggle([1, 2]);
await tags.updateExistingPivot(3, { note: "updated" });
await tags.syncWithPivotValues([2, 3], { note: "bulk" });
await tags.detach();

await user.relation("posts").create({ title: "Hello" });
await user.relation("posts").createMany([{ title: "A" }, { title: "B" }]);
await user.relation("country").associate(country);
await user.relation("country").dissociate();

await user.load("posts", "country");
await user.loadMissing("posts.comments");
await user.loadCount("posts as pendingCount");
await user.loadSum("posts", "views");
await user.loadAvg("posts", "views");
await user.loadMin("posts", "views");
await user.loadMax("posts", "views");
await user.loadAggregate("sum", "posts", "views");
```

Manager query helpers: `query()`, `get()`, `first()`, `count()`, `find()`,
`findOrFail()` and `has()`. `hasMany`/`hasOne` managers add
`create`/`createMany`/`save`/`saveMany`; `belongsTo` adds
`associate`/`dissociate`; `belongsToMany`/`morphToMany` add the pivot methods
above. Calling a method on the wrong relation kind throws `InvalidQueryError`.
Through-relation managers (`hasManyThrough`/`hasOneThrough`) support reads and
writes: `create`/`save` fill the related row's foreign key with the key of the
through row that already points at the parent.

Pivot managers also filter and order through the pivot table:
`wherePivot(column, value)`, `wherePivot(column, operator, value)`,
`wherePivotIn(column, values)` and `orderByPivot(column, direction?)` — all
chainable before `query()`/`get()`/`first()`/`count()`. Pivot objects are
hydrated by eager loading (`with("roles")`) and by manager queries, so
`user.relation("roles").get().first()?.membership` carries the same pivot
shape as the eager-loaded relation.

Because an instance cannot see its subclass's static relation map, the
instance-level `relation("…")` and `load("…")` names are validated at runtime.
Cast a manager to `RelationManagerOf<typeof Model, "name">` to recover the
compile-time surface; eager loading through `Model.query().with("…")` is fully
typed. `loadCount`/`loadSum`/… return the instance widened with the extras
(`postsCount`, `postsSumViews`), matching `withCount`/`withSum` on the query
builder.

`morphTo` relations are fully supported: they can be constrained
(`whereHas("commentable", cb)` applies the constraint to every declared type),
nested (`whereHas("commentable.author")` resolves the rest of the path per
target model), aggregated (`withCount("commentable")`, `withSum("commentable",
"views")`) and constrained eagerly (`with({ commentable: cb })` or per type with
`withMorph("commentable", { posts: cb, videos: cb })`).
`whereHasMorph("commentable", ["posts"], cb)` filters by alias and also accepts
a per-type constraint map; `orWhereHasMorph`, `whereDoesntHaveMorph` and
`orWhereDoesntHaveMorph` complete the family.
`whereMorphRelation("commentable", "title", "=", "Hello")` constrains a
polymorphic relation by a column of its target.

### Query builder

Filters (`where`, `orWhere`, callbacks, `whereIn`, `whereNull`, `whereBetween`,
`whereNotBetween`/`orWhereNotBetween`, `when`, `unless`, `whereColumn`,
`whereAny`/`whereAll`/`whereNone`, `orWhereNot`), integer literal lists
(`whereIntegerInRaw`/`whereIntegerNotInRaw`, no bindings), correlated
subqueries (`whereExists`/`whereNotExists`/`orWhereExists`,
`orWhereNotExists`, `selectSub`), date/time parts (`whereDate`, `whereTime`,
`whereDay`, `whereMonth`, `whereYear`), JSON predicates (`whereJsonContains` with deep paths,
`whereJsonContainsKey`/`whereJsonDoesntContainKey`, `whereJsonOverlaps`,
`whereJsonLength` with paths), morph/attachment constraints
(`whereMorphedTo`/`whereNotMorphedTo`, `whereAttachedTo`/
`whereNotAttachedTo`), joins (`join`, `leftJoin` — joined columns become
filterable), grouping (`groupBy`, `groupByRaw`, `having`/`havingRaw`),
ordering (`orderBy`, `orderByRaw`, `latest`, `oldest`, `inRandomOrder`,
`reorder`), `limit`/`offset`, set operations (`union`/`unionAll`), row locks
(`lockForUpdate`/`sharedLock` on MySQL/PostgreSQL; no-ops on SQLite),
aggregates (`count`, `sum`, `avg`, `min`, `max`, `exists`), and terminals
(`first`, `firstOrFail`, `firstWhere`, `value`, `sole`, `soleValue`,
`doesntExist`, `find`, `findOrFail`, `pluck`, `chunk`, `chunkById`,
`lazyById`, `cursor`, `toSQL`).

Existence helpers include `whereHas`/`whereDoesntHave` (nested), `whereRelation`,
`whereBelongsTo`, `whereHasMorph`, `withExists`, and `withWhereHas` (filters
parents and applies the same constraint to the eager load). Opt into
first-or-new/create variants with `firstOr`/`findOr`/`firstOrNew`/`findOrNew`
and `firstOrCreate`/`updateOrCreate`.

Writes include `insert`, `insertMany`, `insertOrIgnore`, `update`,
`updateOrInsert`, `delete`, `upsert`, `truncate`, `incrementEach`/
`decrementEach` and per-dialect conflict handling. Numeric columns also support
atomic `increment(column, by, extra?)` / `decrement(column, by, extra?)`.

Pagination returns collections: `paginate` (with total), `simplePaginate` (no
count), and `cursorPaginate` (key-set). Cursor pagination takes one column
(`column`/`direction`) or several (`order`), and returns `nextCursor`,
`prevCursor`, `hasMore` and `hasPrevious` — feed either cursor back in to walk
forwards or backwards:

```ts
const page = await Post.query().cursorPaginate(20, {
	order: [{ column: "views", direction: "desc" }, { column: "id" }],
});
const next = page.nextCursor
	? await Post.query().cursorPaginate(20, {
			order: [{ column: "views", direction: "desc" }, { column: "id" }],
			cursor: page.nextCursor,
		})
	: null;
const previous = page.prevCursor; // null on the first page
```

```ts
const compiled = orm.table("users").where("id", 1).toSQL();
// { sql: 'select * from "users" where ("id" = ?)', parameters: [1] }

await orm.table("posts").where("userId", 1).increment("views", 2);
```

Model statics add `firstOrCreate(attributes, values?)`,
`updateOrCreate(attributes, values?)` and `createOrFirst(attributes, values?)`
(insert-first for unique-key races), all returning the model instance, plus
`Model.destroy(ids)` returning the deleted count. Instances add
`increment`/`decrement` (and their `*Quietly` variants), `toArray()` (identical
to `toJSON()`) and `append(...names)` for extra serialized attributes.

Raw SQL stays raw: `orm.raw("select count(*) ...", [binding])`.

### Transactions

```ts
await orm.transaction(async (tx) => {
	await tx.table("users").insert({ name: "A", email: "a@b.c" });
	// A nested orm.transaction() call becomes a savepoint automatically.
	await orm.transaction(async () => {
		await orm.table("users").insert({ name: "B", email: "b@b.c" });
	});
});
```

`orm.transaction(callback, { isolation?, retries? })` runs on one connection
through `AsyncLocalStorage`; nested calls become savepoints; retryable errors
(`SQLITE_BUSY`, MySQL 1213/1205, PostgreSQL 40001/40P01) are retried with
bounded attempts.

### Migrations

```ts
const migrator = new Migrator(orm, { migrations: [{
	name: "001_create_users",
	async up({ schema }) {
		await schema.create("users", (t) => {
			t.id();
			t.string("name", 120);
		});
	},
	async down({ schema }) {
		await schema.drop("users");
	},
}]});

await migrator.migrate();   // books one batch
await migrator.rollback();  // reverses the last batch
await migrator.status();
```

Migrations run inside a transaction on PostgreSQL and SQLite; MySQL DDL
auto-commits, so the bookkeeping stays atomic there but DDL does not roll back
(engine behavior). Concurrent migrators are serialized with
`pg_advisory_lock` / `GET_LOCK`.

`reset()` reverses every recorded batch, `refresh()` is `reset()` + `migrate()`,
`fresh()` drops every table in the connected database and re-runs all
migrations (destructive — use a scratch database), and `pretend()` compiles
pending migrations without executing them:

```ts
await migrator.pretend(); // [{ migration, direction: "up", statements }]
await migrator.refresh();
const dropped = await migrator.dropAllTables(); // ["users", "posts", …]
```

### Schema extras

Table builders cover `char`, `tinyInteger`, `smallInteger`, `mediumInteger`,
`jsonb`, `unsigned()`, `useCurrent()`, `constrained()`, `foreignIdFor(Model)`
and variadic `dropColumn([...])`. Existing tables can
`dropUnique(name)` / `dropForeign(name)` on every dialect: MySQL tries
`drop foreign key` then `drop index`, PostgreSQL tries `drop constraint` then
`drop index`, and SQLite drops a named unique index directly or rebuilds the
table (copy, drop, rename, recreate indexes) for a named constraint. Foreign
keys are emitted as named table-level constraints on every dialect, including
MySQL where inline `references` is parsed but ignored.

### Factories and seeders

```ts
const users = await User.factory()
	.define({ email: (i) => `user${i}@example.com`, name: (i) => `User ${i}` })
	.state({ age: 30 })
	.count(2)
	.create({ active: true });

User.factory().define({ name: "Unsaved" }).makeOne(); // no database write
await runSeeders(orm, [
	async (db) => { await db.table("countries").insert({ name: "Seeded" }); },
	{ run: async () => { /* … */ } },
]);
// All-or-nothing:
await runSeeders(orm, seeders, { transaction: true });
```

Factory values go through the same mass-assignment rules as `create()`
(`fillable`/`guarded`), and definitions may be functions of the row index.
`runSeeders` runs the list sequentially; pass `{ transaction: true }`
(Eloquent's `--isolated`) to wrap the whole list in one transaction.

### Pruning

```ts
class ExpiredSession extends orm.model("sessions") {
	static prunable = (query: unknown) =>
		(query as { where(column: string, op: string, value: unknown): unknown })
			.where("expiresAt", "<", new Date());
}

await ExpiredSession.prune(500); // default chunk size: 1000
```

Pruning honors the model's soft-delete scope (rows are trashed, not destroyed)
and returns the affected count. Each chunk is deleted per instance, so
`deleting`/`deleted` (and `trashed`) fire and a `deleting` listener can cancel
individual rows.

### Multiple connections

```ts
const orm = new Orm({
	schema,
	dialect: mysql({ uri: "mysql://app@db/app" }),
	connections: { audit: postgres({ uri: "postgres://app@db/audit" }) },
});

class AuditEvent extends orm.model("audit_events") {
	static connection = "audit";
}

await orm.connection("audit").table("audit_events").insert({ action: "login" });
```

Child connections share the schema, query listeners, morph map and macros;
each connection owns its transaction context.

### Builder and model macros

```ts
orm.macro("whereActive", function (this: ReturnType<typeof orm.table>) {
	return this.where("active", "=", true);
});
await User.query().whereActive().get();

User.macro("isAdult", function (this: User) {
	return Number(this.get("age")) >= 18;
});
```

Augment `QueryBuilderMacros` to type macro chains; model macros install
prototype methods and refuse to overwrite existing ones.

### Custom pivot models

```ts
class Membership extends orm.pivot("role_user") {
	static override casts = { grantedAt: "date:Y-m-d" } as const;
}

class User extends orm.model("users") {
	static relations = {
		roles: belongsToMany(() => Role, {
			through: "role_user",
			foreignPivotKey: "userId",
			relatedPivotKey: "roleId",
			withPivot: ["note", "grantedAt"],
			using: Membership,
		}),
	};
}
```

`using` hydrates eager-loaded pivots as the custom class and applies its casts
in `attach`/`updateExistingPivot`. Pivot events are not emitted.

### Raw SQL helpers and errors

All errors extend `BarqError`: `QueryError` (with per-dialect translation),
`UniqueConstraintError`, `ForeignKeyConstraintError`, `NotNullConstraintError`,
`InvalidQueryError`, `ModelNotFoundError`, `RelationNotLoadedError`,
`SchemaError`, `CastError`, `MigrationError`, `TransactionError`,
`ConnectionError`. Retryable-transaction classification is exposed as
`isRetryableTransactionError(error, dialectKind)`.

### Testing your SQL against every dialect

```ts
import { compileOnlyOrm } from "@barqel/barq-orm/testing";

const orm = compileOnlyOrm(schema, "postgres");
orm.table("users").where("id", 1).toSQL();
// 'select * from "users" where ("id" = $1)'
```

`compileOnlyOrm(schema, dialect)` swaps in the real Kysely compilers with a
driver that executes nothing — assertions on generated SQL and bindings run
without a database.

## Scripts

| Command | What it does |
| --- | --- |
| `bun test` | Unit + integration suites (SQLite runs live, MySQL/PG skip unless configured) |
| `bun run typecheck` | `tsc --noEmit` over `src` |
| `bun run typecheck:tests` | `tsc --noEmit` over tests, type tests, benchmarks, examples |
| `bun run check` | Biome format + lint |
| `bun run build` | ESM build + `.d.ts` to `dist/` |
| `bun run smoke` | Runs the built package under Node against SQLite (add the live URLs for MySQL/PostgreSQL) |
| `bun run bench` | Benchmark suite vs raw driver, Kysely and Drizzle |
| `bun run examples/blog.ts` | Runnable end-to-end walkthrough |

## Verification

`bun test` runs the full SQLite integration suite live, plus compile-time type
contracts and per-dialect SQL assertions. `tests/node/smoke.mjs` exercises the
built and the packed (`bun pm pack`) package under Node 24 against SQLite,
MySQL and PostgreSQL — the `node-runtime` job in `.github/workflows/orm.yml`
runs it on every push (green in run `39216418150`). With both live URLs
configured the full gate is
**328 pass, 0 fail** (1593 assertions across 12 files); without them the same
command is **262 pass, 2 skip, 0 fail** (264 tests), skipping only the two
env-gated dialect entry points. Full evidence, methodology and honest
verification status: [REPORT.md](REPORT.md).

## Benchmarks

See [docs/benchmarks.md](docs/benchmarks.md) for methodology and this
machine's results (median of 5 rounds, in-memory SQLite):

| Workload | raw `bun:sqlite` | Kysely | Drizzle | Barq ORM |
| --- | ---: | ---: | ---: | ---: |
| selectByPk | 866,170 ops/s | 89,571 | 25,199 | 32,165 |
| selectMany50 | 40,607 | 25,477 | 10,887 | 16,907 |
| countPosts | 1,614,763 | 88,537 | 55,102 | 71,056 |
| insertOne | 416,270 | 65,711 | 34,287 | 44,991 |
| updateOne | 1,036,127 | 111,441 | 36,784 | 52,322 |
| eager10 (10 users + 100 posts) | 14,794 | 11,773 | 5,060 | 3,013 |
| hydrate100 | 22,837 | 15,628 | 7,085 | 10,698 |
| modelFind (Barq models) | — | — | — | 31,115 |
| modelEager10 (Barq models) | — | — | — | 3,242 |

The model path costs more than the row path by design (hydration, casts,
dirty tracking) and is still the same order of magnitude as Kysely.

## Known limitations

See [docs/limitations.md](docs/limitations.md). Highlights: instance-level
relation/load names are runtime-validated (use `RelationManagerOf` for the
compile-time manager surface); relation paths are checked at compile time up to
5 levels and validated at runtime beyond that; self-referential nested
`whereHas` aliases each shadowed
step; cursor pagination is bidirectional and multi-column but has no total;
SQLite constraint drops rebuild the table; cast read values (including
`decimal:<n>` and `date:<fmt>` strings) need narrowing; `migrator.fresh()` and
`dropAllTables()` drop every table; transactions are scoped per connection;
64-bit precision requires the documented BigInt mode, and raw SQL/JSON need the
documented conversions; live MySQL/PostgreSQL suites are env-gated and skip
cleanly unless `BARQ_ORM_MYSQL_URL` / `BARQ_ORM_PG_URL` point at scratch servers
(CI sets
both).

## License

[MIT](LICENSE) © Barq contributors.
