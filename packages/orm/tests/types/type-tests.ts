// Compile-time API contract tests.
//
// Checked by `bunx tsc --noEmit -p tsconfig.test.json`, never executed (the
// file is not named `*.test.ts`, so `bun test` ignores it).
//
// Positive cases must compile. Negative cases must FAIL to compile — that is
// what `@ts-expect-error` asserts. If a boundary stops being enforced, the
// directive becomes unused and this file stops compiling, exactly like a
// failing test.

import type {
	CastClass,
	Collection,
	EnumCast,
	InsertResult,
	InstanceOf,
	RelatedPkOf,
	RelationManagerOf,
	RelationsOf,
	RowOf,
	SchemaOptions,
} from "../../src/index";
import {
	belongsTo,
	belongsToMany,
	defineGlobalScopes,
	defineSchema,
	defineScopes,
	hasMany,
	hasManyThrough,
	hasOne,
	Migrator,
	morphedByMany,
	morphMany,
	morphTo,
	morphToMany,
	Orm,
	Stringable,
} from "../../src/index";
import { sqlite } from "../../src/sqlite";

// ---------------------------------------------------------------------------
// Tiny type-level assertion helpers
// ---------------------------------------------------------------------------

type Expect<T extends true> = T;

/**
 * Mutual assignability — the strongest structural check that survives
 * mapped-type wrappers such as `Pick<TableRow<...>, ...>`. The tuple wrappers
 * stop conditional types from distributing over unions.
 */
type SameShape<A, B> = [A] extends [B]
	? [B] extends [A]
		? true
		: false
	: false;

// ---------------------------------------------------------------------------
// Schema + models
// ---------------------------------------------------------------------------

const schema = defineSchema({
	users: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		name: "string",
		email: "string",
		age: { type: "integer", nullable: true },
		active: { type: "boolean", default: true },
		countryId: { type: "integer", nullable: true },
		deletedAt: { type: "datetime", nullable: true },
	},
	posts: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		userId: "integer",
		title: "string",
		views: { type: "integer", default: 0 },
		deletedAt: { type: "datetime", nullable: true },
	},
	comments: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		body: "string",
		commentableId: "integer",
		commentableType: "string",
	},
	videos: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		title: "string",
	},
	countries: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		name: "string",
	},
	taggables: {
		taggableId: "integer",
		taggableType: "string",
		tagId: "integer",
	},
	role_user: {
		userId: "integer",
		roleId: "integer",
	},
	profiles: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		userId: "integer",
		bio: { type: "text", nullable: true },
	},
	roles: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		name: "string",
	},
	tags: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		name: "string",
	},
});

const orm = new Orm({ schema, dialect: sqlite(":memory:") });

class User extends orm.model("users") {
	static softDeletes = true;
	static relations = {
		posts: hasMany(() => Post, "userId"),
		profile: hasOne(() => Profile, "userId"),
		country: belongsTo(() => Country, "countryId"),
		roles: belongsToMany(() => Role, {
			through: "role_user",
			foreignPivotKey: "userId",
			relatedPivotKey: "roleId",
			withPivot: ["note"],
			timestamps: true,
			as: "membership",
		}),
		tags: morphToMany(() => Tag, "taggable", {
			through: "taggables",
			foreignPivotKey: "taggableId",
			relatedPivotKey: "tagId",
		}),
	};
	static fillable = ["name", "email", "age", "active", "countryId"] as const;
	static casts = { active: "boolean" } as const;
	static accessors = {
		displayName: (user: User) => `${user.get("name")} <${user.get("email")}>`,
	};
	static appends = ["displayName"] as const;
	static scopes = defineScopes(schema, "users", {
		named: (query, name: string) => {
			query.where("name", name);
		},
		activeOnly: (query) => {
			query.where("active", true);
		},
	});
	static globalScopes = defineGlobalScopes(schema, "users", {
		active: (query) => {
			query.where("active", true);
		},
	});
	static mutators = {
		email: (value: unknown) => String(value).toLowerCase(),
	};
}

class Post extends orm.model("posts") {
	static relations = {
		author: belongsTo(() => User, "userId"),
		comments: morphMany(() => Comment, "commentable"),
		tags: morphToMany(() => Tag, "taggable", {
			through: "taggables",
			foreignPivotKey: "taggableId",
			relatedPivotKey: "tagId",
		}),
	};
}

class Comment extends orm.model("comments") {
	static relations = {
		commentable: morphTo("commentable", () => ({
			posts: Post,
			videos: Video,
		})),
	};
}

class Video extends orm.model("videos") {}
class Country extends orm.model("countries") {
	static relations = {
		posts: hasManyThrough(
			() => Post,
			() => User,
			"countryId",
			"userId",
		),
	};
}
class Tag extends orm.model("tags") {
	static relations = {
		posts: morphedByMany(() => Post, "taggable", {
			through: "taggables",
			foreignPivotKey: "tagId",
			relatedPivotKey: "taggableId",
		}),
	};
}
class Profile extends orm.model("profiles") {}
class Role extends orm.model("roles") {}

// Global morph map (Eloquent `Relation::morphMap`).
orm.morphMap({ articles: Post });
const morphAliasContract: string = orm.morphAlias(Post);
const morphClassContract: { readonly __table: string } | undefined =
	orm.morphClass("articles");
const morphEntriesContract: ReadonlyArray<
	readonly [string, { readonly __table: string }]
> = orm.morphMapEntries();
// @ts-expect-error — morph aliases must map to a model class
orm.morphMap({ broken: {} });
void [morphAliasContract, morphClassContract, morphEntriesContract];

// @ts-expect-error — unknown column type must not be accepted by defineSchema
defineSchema({ things: { size: "gigantic" } });

// ---------------------------------------------------------------------------
// Row path
// ---------------------------------------------------------------------------

// Positive: chained filters, ordering and pagination compile.
const rowQuery = orm
	.table("users")
	.where("age", ">", 21)
	.where("name", "like", "A%")
	.whereNull("age")
	.orderBy("name", "desc")
	.limit(10)
	.offset(20);
const rowQueryIsBuilder: Promise<Array<{ id: number; name: string }>> = orm
	.table("users")
	.select("id", "name")
	.get();
void rowQuery;
void rowQueryIsBuilder;

// Positive: callbacks produce nested groups; qualified refs need a join.
orm
	.table("users")
	.where((group) => group.where("age", ">", 18).orWhere("name", "like", "A%"))
	.get();

// @ts-expect-error — unknown table
orm.table("nope");
// @ts-expect-error — unknown column
orm.table("users").where("nope", 1);
// @ts-expect-error — value type follows the column type (age is a number)
orm.table("users").where("age", ">", "old");
// @ts-expect-error — whereIn element type follows the column type
orm.table("users").whereIn("id", ["a"]);
// @ts-expect-error — qualified column of a table that was not joined
orm.table("users").where("posts.title", "x");
// @ts-expect-error — unknown orderBy column
orm.table("users").orderBy("nope");
// @ts-expect-error — unknown groupBy column
orm.table("users").groupBy("nope");
// @ts-expect-error — unknown selected column
orm.table("users").select("id", "nope");

// Positive: joins add the joined table's qualified columns.
orm
	.table("posts")
	.join("users", "posts.userId", "=", "users.id")
	.where("users.active", true)
	.orderBy("posts.title")
	.get();
// @ts-expect-error — unknown left-hand join column
orm.table("posts").join("users", "posts.nope", "=", "users.id");
// @ts-expect-error — unknown right-hand join column
orm.table("posts").join("users", "posts.userId", "=", "users.nope");

// Positive: generated and defaulted columns are optional on insert.
orm.table("users").insert({ name: "Ada", email: "ada@example.com" });
// @ts-expect-error — required column missing
orm.table("users").insert({ name: "Ada" });
// @ts-expect-error — unknown insert column
orm.table("users").insert({ name: "Ada", email: "a@b.c", nope: 1 });
// @ts-expect-error — wrong column type
orm.table("users").insert({ name: 42, email: "a@b.c" });

// Positive: update/delete/upsert accept the declared columns.
orm.table("users").where("id", 1).update({ age: 30 });
orm.table("users").where("id", 1).delete();
orm
	.table("users")
	.upsert(
		{ name: "Ada", email: "a@b.c" },
		{ conflictOn: "email", update: ["name"] },
	);
// @ts-expect-error — unknown update column
orm.table("users").where("id", 1).update({ nope: 1 });
const unknownConflict = "nope";
const upsertOptions = { conflictOn: unknownConflict };
// @ts-expect-error — unknown conflict target
orm.table("users").upsert({ name: "Ada", email: "a@b.c" }, upsertOptions);

// Positive: selecting narrows the row type.
const selected = orm.table("users").select("id", "name");
type SelectedRow = Awaited<ReturnType<typeof selected.get>>[number];
type _SelectedRowIsNarrow = Expect<
	SameShape<SelectedRow, { id: number; name: string }>
>;

// @ts-expect-error — row mode has no relations: `with()` requires a model
orm.table("users").with("posts");

// ---------------------------------------------------------------------------
// Model path
// ---------------------------------------------------------------------------

// Positive: `with` types the loaded relation property.
const loaded = User.query().with("posts");
type LoadedRow = Awaited<ReturnType<typeof loaded.get>>[number];
type _LoadedPosts = Expect<
	SameShape<LoadedRow["posts"], Collection<InstanceOf<typeof Post>>>
>;

// `withCount` adds a typed counter.
const counted = User.query().withCount("posts");
type CountedRow = Awaited<ReturnType<typeof counted.get>>[number];
type _CountedPosts = Expect<SameShape<CountedRow["postsCount"], number>>;

// Nested paths must chain declared relations; combined paths merge into one
// relation shape (no intersecting array types).
User.query().with("posts.author");
const combined = User.query().with("posts", "posts.author", "profile");
type CombinedRow = Awaited<ReturnType<typeof combined.get>>[number];
type _CombinedAuthor = Expect<
	SameShape<
		CombinedRow["posts"][number]["author"],
		InstanceOf<typeof User> | null
	>
>;
type _CombinedProfile = Expect<
	SameShape<CombinedRow["profile"], InstanceOf<typeof Profile> | null>
>;
User.query()
	.whereHas("posts", (group) => group.where("title", "Hello"))
	.get();
User.query().withCount("posts").whereHas("profile").get();

// Relation factories type their keys from the related model's columns.
hasMany(() => Post, "userId");
belongsTo(() => User, "userId");
belongsTo(() => User, "userId", "id");
// @ts-expect-error — foreign key must be a column of the related model
hasMany(() => Post, "nope");
// @ts-expect-error — owner key must be a column of the related model
belongsTo(() => User, "userId", "nope");

declare const plainUser: InstanceOf<typeof User>;
// @ts-expect-error — relations are never lazy-loaded; access requires `with`
void plainUser.posts;
// @ts-expect-error — unknown relation
User.query().with("nope");
// @ts-expect-error — nested path continues from an unknown relation
User.query().with("posts.nope");
// @ts-expect-error — unknown relation in whereHas
User.query().whereHas("nope").get();
const badTitle = 1;
// @ts-expect-error — whereHas callback is typed by the related model
User.query().whereHas("posts", (group) => group.where("title", badTitle));
// @ts-expect-error — unknown relation in withCount
User.query().withCount("nope").get();

// Positive: static helpers take the primary key type and fillable values.
const found: Promise<InstanceOf<typeof User> | null> = User.find(1);
void found;
User.findOrFail(1);
User.create({ name: "Ada", email: "ada@example.com", age: 30 });
User.createMany([{ name: "A", email: "a@b.c" }]);
// @ts-expect-error — primary key type follows the schema (integer, not string)
User.find("1");
// @ts-expect-error — required create values missing
User.create({ name: "Ada" });
// @ts-expect-error — `fillable` is an allow-list: unknown keys are rejected
User.create({ name: "Ada", email: "a@b.c", role: "admin" });

// @ts-expect-error — unknown model table
orm.model("nope");

// ---------------------------------------------------------------------------
// BigInt mode — schema-level and per-column types
// ---------------------------------------------------------------------------

const bigIntSchema = defineSchema(
	{
		ledger: {
			id: { type: "bigint", primaryKey: true, autoIncrement: true },
			total: { type: "bigint", nullable: true },
			label: "string",
		},
		scores: {
			id: { type: "integer", primaryKey: true, autoIncrement: true },
			ledgerId: "bigint",
			amount: "bigint",
		},
	},
	{ bigInt: true },
);
const bigIntOrm = new Orm({
	schema: bigIntSchema,
	dialect: sqlite(":memory:"),
});
type LedgerRow = RowOf<typeof bigIntSchema, "ledger">;
type _LedgerId = Expect<SameShape<LedgerRow["id"], bigint>>;
type _LedgerTotal = Expect<SameShape<LedgerRow["total"], bigint | null>>;
const bigIntInsert: Promise<InsertResult<bigint>> = bigIntOrm
	.table("ledger")
	.insert({ total: 2n, label: "opening" });
void bigIntInsert;
bigIntOrm.table("ledger").where("id", 1n);
// @ts-expect-error — BigInt mode rejects a number for a bigint column
bigIntOrm.table("ledger").where("id", 1);
// @ts-expect-error — BigInt mode rejects a number in insert payloads
bigIntOrm.table("ledger").insert({ total: 2, label: "bad" });
const bigIntMax: Promise<bigint | null> = bigIntOrm.table("ledger").max("id");
const bigIntAverage: Promise<number | null> = bigIntOrm
	.table("ledger")
	.avg("id");
void [bigIntMax, bigIntAverage];

class Ledger extends bigIntOrm.model("ledger") {
	static relations = {
		scores: hasMany(() => Score, "ledgerId"),
	};
}

class Score extends bigIntOrm.model("scores") {}

const bigAggregated = Ledger.query()
	.withSum("scores", "amount")
	.withAvg("scores", "amount")
	.withMin("scores", "amount")
	.withMax("scores", "amount");
type BigAggregateRow = Awaited<ReturnType<typeof bigAggregated.get>>[number];
type _BigSum = Expect<
	SameShape<BigAggregateRow["scoresSumAmount"], bigint | null>
>;
type _BigAvg = Expect<
	SameShape<BigAggregateRow["scoresAvgAmount"], number | null>
>;
type _BigMin = Expect<
	SameShape<BigAggregateRow["scoresMinAmount"], bigint | null>
>;
type _BigMax = Expect<
	SameShape<BigAggregateRow["scoresMaxAmount"], bigint | null>
>;

const mixedBigIntSchema = defineSchema({
	metrics: {
		id: "bigint",
		total: "bigint",
		huge: { type: "bigint", bigInt: true },
	},
});
type MetricsRow = RowOf<typeof mixedBigIntSchema, "metrics">;
type _DefaultBigInt = Expect<SameShape<MetricsRow["total"], number>>;
type _ExplicitBigInt = Expect<SameShape<MetricsRow["huge"], bigint>>;

declare const runtimeBigIntOptions: SchemaOptions;
const dynamicBigIntSchema = defineSchema(
	{ dynamic: { value: "bigint" } },
	runtimeBigIntOptions,
);
type DynamicBigIntRow = RowOf<typeof dynamicBigIntSchema, "dynamic">;
type _DynamicBigInt = Expect<
	SameShape<DynamicBigIntRow["value"], bigint | number>
>;

// ---------------------------------------------------------------------------
// Eloquent parity — compile-time contract
// ---------------------------------------------------------------------------

// increment/decrement accept only numeric columns and typed extras.
orm.table("users").where("id", 1).increment("age", 2, { name: "Ada" });
orm.table("users").where("id", 1).decrement("age");
// @ts-expect-error — "name" is not a numeric column
orm.table("users").where("id", 1).increment("name");
// @ts-expect-error — the extra update may not repeat the incremented column
orm.table("users").where("id", 1).increment("age", 1, { age: 2 });
// @ts-expect-error — unknown extra update column
orm.table("users").where("id", 1).increment("age", 1, { nope: 2 });
// @ts-expect-error — the amount must be a number
orm.table("users").where("id", 1).increment("age", "2");

// firstOrCreate / updateOrCreate keep the lookup and value types.
const firstOrCreated: Promise<InstanceOf<typeof User>> = User.firstOrCreate(
	{ email: "a@b.c" },
	{ name: "Ada" },
);
void firstOrCreated;
User.updateOrCreate({ email: "a@b.c" }, { age: 30 });
// @ts-expect-error — unknown lookup column
User.firstOrCreate({ nope: 1 });
// @ts-expect-error — lookup values are typed by the schema
User.firstOrCreate({ age: "old" });

// Soft-delete statics stay fully typed.
const trashedUsers = User.withTrashed().where("name", "Ada");
type TrashedUserRow = Awaited<ReturnType<typeof trashedUsers.get>>[number];
type _TrashedUser = Expect<
	SameShape<
		TrashedUserRow,
		InstanceOf<typeof User> & { readonly displayName: string }
	>
>;
User.onlyTrashed().where("email", "a@b.c").restore();
User.query().where("id", 1).forceDelete();
void User.find(1).then((user) => user?.trashed());

// Relation aggregates gain typed, nullable result keys.
const aggregated = User.query()
	.withSum("posts", "views")
	.withAvg("posts", "views")
	.withMin("posts", "views")
	.withMax("posts", "views")
	.withCount("posts as pendingCount");
type AggregateRow = Awaited<ReturnType<typeof aggregated.get>>[number];
type _Sum = Expect<SameShape<AggregateRow["postsSumViews"], number | null>>;
type _Avg = Expect<SameShape<AggregateRow["postsAvgViews"], number | null>>;
type _Min = Expect<SameShape<AggregateRow["postsMinViews"], number | null>>;
type _Max = Expect<SameShape<AggregateRow["postsMaxViews"], number | null>>;
type _AliasedCount = Expect<SameShape<AggregateRow["pendingCount"], number>>;
// @ts-expect-error — unknown relation
User.query().withSum("nope", "views");
// @ts-expect-error — unknown column on the related model
User.query().withSum("posts", "nope");

// Nested whereHas paths chain declared relations.
User.query()
	.whereHas("posts.author", (group) => group.where("name", "Ada"))
	.orWhereHas("profile")
	.whereDoesntHave("posts")
	.orWhereDoesntHave("profile")
	.get();
// @ts-expect-error — unknown nested relation
User.query().whereDoesntHave("posts.nope");

// Constrained eager loading is typed per relation.
User.query().with({ posts: (query) => query.where("title", "Hello") });
User.query().with({ "posts.author": (query) => query.where("name", "Ada") });
// @ts-expect-error — unknown relation path
User.query().with({ nope: (query) => query });
// @ts-expect-error — constrained columns follow the related model
User.query().with({ posts: (query) => query.where("nope", 1) });

// Events and observers are typed.
User.on("created", (user) => {
	const name: string = user.get("name");
	const displayed: string = user.displayName;
	void [name, displayed];
});
User.on("creating", () => false);
User.on("saving", () => {});
User.observe({
	creating: (user) => {
		user.get("email");
	},
	updated: () => {},
});
// @ts-expect-error — unknown event name
User.on("nope", () => {});
// @ts-expect-error — unknown observer event
User.observe({ nope: () => {} });
// @ts-expect-error — the listener receives the model instance
User.on("created", (user: { nope: true }) => user);

// Accessors flow into every model query result.
const fetchedQuery = User.query();
type FetchedUser = NonNullable<Awaited<ReturnType<typeof fetchedQuery.first>>>;
type _DisplayName = Expect<SameShape<FetchedUser["displayName"], string>>;
// @ts-expect-error — accessors are not database columns
User.query().where("displayName", "x");

// Morph relations type their union and forbid unsupported operations.
const morphComments = Comment.query().with("commentable");
type MorphRow = Awaited<ReturnType<typeof morphComments.get>>[number];
type _MorphUnion = Expect<
	SameShape<
		MorphRow["commentable"],
		InstanceOf<typeof Post> | InstanceOf<typeof Video> | null
	>
>;
Comment.query().whereHas("commentable").get();
// @ts-expect-error — morphTo relations cannot be constrained
Comment.query().whereHas("commentable", (group) => group);
// @ts-expect-error — morphTo relations cannot be nested
Comment.query().whereHas("commentable.nope");
// @ts-expect-error — morphTo relations cannot be aggregated
Comment.query().withCount("commentable");
// @ts-expect-error — morphTo relations cannot be constrained eagerly
Comment.query().with({ commentable: (query) => query });

// Polymorphic and through relations expose typed eager loading.
const userTags = User.query().with("tags").withCount("tags");
type UserTagRow = Awaited<ReturnType<typeof userTags.get>>[number];
type _UserTags = Expect<
	SameShape<
		UserTagRow["tags"],
		Collection<InstanceOf<typeof Tag> & { pivot: Record<string, unknown> }>
	>
>;
type _UserTagCount = Expect<SameShape<UserTagRow["tagsCount"], number>>;

// Pivot relations attach the pivot object under the name from `as`
// (`"pivot"` by default) — typed, never a hidden query.
const userRoles = User.query().with("roles");
type UserRoleRow = Awaited<ReturnType<typeof userRoles.get>>[number];
type _UserRolePivot = Expect<
	SameShape<UserRoleRow["roles"][number]["membership"], Record<string, unknown>>
>;
type _RoleHasNoDefaultPivot = Expect<
	SameShape<Extract<keyof UserRoleRow["roles"][number], "pivot">, never>
>;

// `morphedByMany` carries the same typed surface as `morphToMany`.
const tagPosts = Tag.query().with("posts");
type TagPostRow = Awaited<ReturnType<typeof tagPosts.get>>[number];
type _TagPosts = Expect<
	SameShape<
		TagPostRow["posts"],
		Collection<InstanceOf<typeof Post> & { pivot: Record<string, unknown> }>
	>
>;
async function tagManagerContract(): Promise<void> {
	const tag = await Tag.findOrFail(1);
	const posts = tag.relation("posts") as unknown as RelationManagerOf<
		typeof Tag,
		"posts"
	>;
	await posts.attach([1]);
	posts.wherePivot("note", "x").orderByPivot("note", "desc");
	await posts.wherePivotIn("note", ["a"]).query().get();
	// @ts-expect-error — pivot ids must be primary-key values
	posts.attach([{ nope: true }]);
}
void tagManagerContract;
const countryPosts = Country.query().with("posts").withCount("posts");
type CountryPostRow = Awaited<ReturnType<typeof countryPosts.get>>[number];
type _CountryPosts = Expect<
	SameShape<CountryPostRow["posts"], Collection<InstanceOf<typeof Post>>>
>;
Country.query().whereHas("posts", (group) => group.where("views", ">", 1));

// Instance soft-delete helpers are typed.
async function softDeleteContract(): Promise<void> {
	const user = await User.findOrFail(1);
	const trashed: boolean = user.trashed();
	const restored: boolean = await user.restore();
	const deleted: boolean = await user.delete();
	const forced: boolean = await user.forceDelete();
	const copy: typeof user = await user.replicate();
	const originalName: string | undefined = user.getOriginal("name");
	void [trashed, restored, deleted, forced, copy, originalName];
}
void softDeleteContract;

// ---------------------------------------------------------------------------
// Collections, scopes, managers, loaders and the extended builder
// ---------------------------------------------------------------------------

const collectionQuery = User.query();
type CollectionRows = Awaited<ReturnType<typeof collectionQuery.get>>;
type FirstUser = Awaited<ReturnType<typeof collectionQuery.firstOrFail>>;
type _CollectionResult = Expect<
	SameShape<CollectionRows, Collection<FirstUser>>
>;
async function pluckContract(): Promise<void> {
	const names: Collection<string> = await collectionQuery.pluck("name");
	void names;
}
void pluckContract;
type UserPage = Awaited<ReturnType<typeof collectionQuery.paginate>>;
type _PageData = Expect<SameShape<UserPage["data"], Collection<FirstUser>>>;
type _CursorData = Expect<
	SameShape<
		Awaited<ReturnType<typeof collectionQuery.cursorPaginate>>["data"],
		Collection<FirstUser>
	>
>;

// Model collections dispatch attribute reads through Model.get().
collectionQuery.get().then((rows) => {
	const names: Collection<unknown> = rows.pluck("name");
	const published: Collection<FirstUser> = rows.where("active", true);
	const sum: number = rows.sum("age");
	void [names, published, sum];
});

// Local and global scopes are name- and argument-checked.
User.query().scope("named", "Ada");
User.query().scope("activeOnly");
// @ts-expect-error — "named" requires the name argument
User.query().scope("named");
// @ts-expect-error — unknown local scope
User.query().scope("nope");
User.withoutGlobalScopes("active");
User.withoutGlobalScopes();
// @ts-expect-error — unknown global scope
User.withoutGlobalScopes("nope");

// Relation managers can be recovered from a class when the runtime method is
// intentionally broad (relations are validated at runtime).
async function relationManagerContract(): Promise<void> {
	const user = await User.findOrFail(1);
	const posts = user.relation("posts") as unknown as RelationManagerOf<
		typeof User,
		"posts"
	>;
	const created = await posts.create({ title: "Hello" });
	const createdTitle: string = created.get("title");
	const allPosts: Collection<Post> = await posts.get();
	const firstPost: Post | null = await posts.first();
	const postCount: number = await posts.count();
	void [createdTitle, allPosts, firstPost, postCount];
	await posts.query().where("views", ">", 1).get();
	// @ts-expect-error — hasMany managers have no pivot attach()
	posts.attach([1]);

	type RoleDescriptor = RelationsOf<typeof User>["roles"];
	type RolePk = RelatedPkOf<RoleDescriptor>;
	type _RolePk = Expect<SameShape<RolePk, number>>;
	const roles = user.relation("roles") as unknown as RelationManagerOf<
		typeof User,
		"roles"
	>;
	await roles.attach([1]);
	// @ts-expect-error — pivot ids must be primary-key values
	roles.attach([{ nope: true }]);
	// Pivot filters are typed and chainable on pivot managers only.
	roles.wherePivot("note", "x").orderByPivot("note", "desc");
	roles.wherePivot("note", "!=", "y").wherePivotIn("note", ["a"]);
	await roles.wherePivot("note", "like", "%a%").query().get();
	// @ts-expect-error — hasMany managers have no pivot filters
	posts.wherePivot("note", "x");
	// @ts-expect-error — orderByPivot direction is asc/desc only
	roles.orderByPivot("note", "sideways");
}
void relationManagerContract;

// Instance load helpers accept relation paths and remain chainable.
async function loadContract(): Promise<void> {
	const user = await User.findOrFail(1);
	const loaded: typeof user = await user.load("posts", "posts.author");
	const counted = await user.loadCount("posts", "tags as tagCount");
	const summed = await user.loadSum("posts", "views");
	const aggregated = await user.loadAggregate("sum", "posts", "views");
	void [loaded, counted, summed, aggregated];
}
void loadContract;

// Extended query-builder surface.
User.query().whereColumn("id", "=", "countryId");
User.query().whereAny(["name", "email"], "like", "%a%");
User.query().whereAll(["name", "email"], "like", "%a%");
User.query().whereNone(["name", "email"], "like", "%z%");
User.query().whereDate("deletedAt", "=", "2026-10-18");
User.query().whereTime("deletedAt", "=", "12:00:00");
User.query().whereDay("deletedAt", "=", 18);
User.query().whereMonth("deletedAt", "=", 10);
User.query().whereYear("deletedAt", "=", 2026);
User.query().whereJsonContains("name", "Ada");
User.query().whereJsonLength("name", ">", 0);
User.query().whereRelation("posts", "views", ">", 1);
Comment.query().whereHasMorph("commentable", ["posts"], (query) =>
	query.where("title", "Hello"),
);
Comment.query().whereHasMorph("commentable", "*");
Comment.query().whereHasMorph("commentable", "*", (query) =>
	query.where("id", 1),
);
const countryValue = null as unknown as InstanceOf<typeof Country>;
User.query().whereBelongsTo(countryValue);
User.query().withWhereHas("posts", (query) => query.where("views", ">", 1));
User.query().latest("id").oldest("name").reorder("id", "desc");
User.query().selectRaw<{ upperName: string }>("upper(name) as upperName");
User.query().orderByRaw("name desc").groupByRaw("id").lockForUpdate();
User.query().sharedLock();
User.query().withExists("posts");
const existsQuery = User.query().withExists("posts");
type ExistsRow = Awaited<ReturnType<typeof existsQuery.get>>[number];
type _Exists = Expect<SameShape<ExistsRow["postsExists"], boolean>>;

// Pagination/cursor/lazy helpers keep collection data.
User.query().simplePaginate(2, 1);
User.query().cursorPaginate(2, { cursor: null, direction: "asc" });
for await (const _row of User.query().lazyById(2)) {
	void _row;
}
User.query().chunkById(2, (rows) => {
	const ids: number[] = rows.pluck("id").all() as number[];
	void ids;
});

// Writes return the documented shapes.
User.query().insertOrIgnore({ name: "Ada", email: "a@b.c" });
User.query().updateOrInsert({ email: "a@b.c" }, { name: "Ada" });
User.query().incrementEach({ age: 1 });
User.query().decrementEach({ age: 1 });

// Cast specifications are public and composable.
// biome-ignore lint/complexity/noStaticOnlyClass: demonstrates class-based cast typing
class PercentageCast {
	static get(value: unknown): unknown {
		return Number(value) / 100;
	}

	static set(value: unknown): unknown {
		return Math.round(Number(value) * 100);
	}
}
const classCast: CastClass = PercentageCast;
const enumCast: EnumCast = { enum: { Active: "active", Banned: "banned" } };
void [classCast, enumCast];

// Stringable is chainable and immutable.
const stringable: Stringable = new Stringable("  Ada  ").trim().upper();
const stringValue: string = stringable.value();
void stringValue;

// ---------------------------------------------------------------------------
// Transactions, raw SQL, DDL
// ---------------------------------------------------------------------------

const txResult: Promise<number> = orm.transaction(async (trx) => {
	const users = await trx.table("users").get();
	return users.length;
});
void txResult;

// Positive: raw SQL returns untyped rows by design.
const raw = orm.raw("select 1 as one");
void raw;

// Positive: schema builder and migrator are available on the ORM.
orm.schemaBuilder();
new Migrator(orm, { migrations: [] });

// ---------------------------------------------------------------------------
// Priority 2: macros, pivot `using`, pruning, factories, new casts/types
// ---------------------------------------------------------------------------

// Query-builder macros augment the builder type and keep `this` chainable.
declare module "../../src/query/builder" {
	interface QueryBuilderMacros {
		whereFeatured(): this;
		whereOlderThan(age: number): this;
	}
}
orm.macro("whereFeatured", (_query: never) => {
	// runtime body is irrelevant to the type contract
});
orm.macro("whereOlderThan", (_query: never, _age: never) => {});
User.query().whereFeatured().where("age", ">", 18);
User.query().whereOlderThan(30).count();
// @ts-expect-error — macro arguments are typed by the augmentation
User.query().whereOlderThan("thirty");

// Model macros register `this`-typed instance methods.
User.macro("isAdult", function () {
	return Number(this.get("age")) >= 18;
});
type MacroThis = ThisParameterType<Parameters<typeof User.macro>[1]>;
type _MacroThis = Expect<MacroThis extends User ? true : false>;
const macroUser = User.query().firstOrFail();
macroUser.then((value) => {
	const adult: boolean = (value as unknown as { isAdult(): boolean }).isAdult();
	void adult;
});
// @ts-expect-error — undeclared macros are rejected
User.macro(123, () => null);

// Pruning is typed as a number-returning promise.
const pruneAll: Promise<number> = User.prune();
const pruneChunked: Promise<number> = User.prune(50);
void [pruneAll, pruneChunked];
// @ts-expect-error — the chunk size is a number
User.prune("50");

// Factories are typed from the schema (fillable filtering included).
const factory = User.factory()
	.define({
		email: (index) => `user${index}@example.com`,
		name: "Ada",
	})
	.state({ age: 30 })
	.count(2);
type WithAppends = User & { readonly displayName: string };
const factoryMade: Collection<WithAppends> = factory.make();
const factoryCreated: Promise<Collection<WithAppends>> = factory.create({
	age: 41,
});
const factoryOne: Promise<WithAppends> = User.factory()
	.define({ name: "Solo" })
	.createOne();
void [factoryMade, factoryCreated, factoryOne];
// @ts-expect-error — `define` accepts only create values
User.factory().define({ nope: true });

// Custom pivot models: `using` types the hydrated pivot accessor.
class Membership extends orm.pivot("role_user") {
	static override casts = { note: "string" } as const;
}
class Org extends orm.model("users") {
	static relations = {
		roles: belongsToMany(() => Role, {
			through: "role_user",
			foreignPivotKey: "userId",
			relatedPivotKey: "roleId",
			withPivot: ["note"],
			using: Membership,
		}),
		plainRoles: belongsToMany(() => Role, {
			through: "role_user",
			foreignPivotKey: "userId",
			relatedPivotKey: "roleId",
		}),
	};
}
const loadedOrgPromise = Org.query().with("roles").firstOrFail();
type LoadedOrg = Awaited<typeof loadedOrgPromise>;
type PivotOf<C> =
	C extends Collection<infer R>
		? R extends { pivot: infer P }
			? P
			: never
		: never;
type OrgPivot = PivotOf<LoadedOrg["roles"]>;
type _OrgPivot = Expect<SameShape<OrgPivot, Membership>>;
const loadedOrgPlainPromise = Org.query().with("plainRoles").firstOrFail();
type LoadedOrgPlain = Awaited<typeof loadedOrgPlainPromise>;
type _OrgPlainPivot = Expect<
	SameShape<PivotOf<LoadedOrgPlain["plainRoles"]>, Record<string, unknown>>
>;

// Parameterized and additional cast names typecheck.
class CastedUser extends orm.model("users") {
	static casts = {
		age: "int",
		email: "float",
		name: "decimal:2",
		deletedAt: "datetime:Y-m-d",
		countryId: "immutable_date",
		active: "object",
	} as const;
}
type _CastNames = Expect<
	SameShape<InstanceType<typeof CastedUser>, InstanceType<typeof User>>
>;
// Unknown cast names are rejected at runtime (`SchemaError`), not statically:
// cast maps intentionally stay unconstrained so custom casts keep working.

// New Blueprint column types exist on the schema surface.
const typedSchema = defineSchema({
	things: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		code: { type: "char", length: 12 },
		flags: { type: "tinyint", nullable: true },
		size: { type: "mediumint", nullable: true },
		payload: { type: "jsonb", nullable: true },
	},
});
type ThingRow = RowOf<typeof typedSchema, "things">;
const thing: ThingRow = {
	id: 1,
	code: "abc",
	flags: 1,
	size: 2,
	payload: { any: "json" },
};
void thing;
type ThingCode = ThingRow["code"];
type _ThingCode = Expect<SameShape<ThingCode, string>>;
// @ts-expect-error — `char` columns are strings
const badCode: ThingCode = 5;
void badCode;

// Named connections are typed and cache their instances.
const auditOrm: Orm<typeof schema> = orm.connection("audit");
const connectionNames: string[] = orm.connectionNames();
void [auditOrm, connectionNames];

// JSON helpers accept deep paths; overlaps is a valid builder method.
User.query().whereJsonContains("email", "x", "$.a.b");
User.query().whereJsonContainsKey("email", "$.a");
User.query().whereJsonDoesntContainKey("email", "a");
User.query().whereJsonLength("email", ">=", 1, "$.tags");
orm.table("tags").whereJsonOverlaps("name", ["a"]);
// @ts-expect-error — the JSON path must be a string
User.query().whereJsonContainsKey("email", 1);

// whereMorphedTo / whereAttachedTo accept classes and instances.
Comment.query().whereMorphedTo("commentable", Video);
Comment.query().whereMorphedTo("commentable", "videos");
Comment.query().whereNotMorphedTo("commentable", Post);
Post.query().whereAttachedTo(new User(undefined as never));
User.query().whereNotAttachedTo(Post, "posts");
