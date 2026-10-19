// @barqel/barq-orm — public surface.
//
// Everything documented in the README is exported here. Kysely types never
// leak: the only Kysely-derived public type is `Dialect` accepted by the
// dialect helpers (`@barqel/barq-orm/sqlite` etc.).

// --- collections ------------------------------------------------------------
export { Collection, collect } from "./collection";
export type { DialectKind } from "./errors";
// --- errors -----------------------------------------------------------------
export {
	CastError,
	ConnectionError,
	ForeignKeyConstraintError,
	InvalidIdentifierError,
	InvalidModelUsageError,
	InvalidQueryError,
	MigrationError,
	ModelNotFoundError,
	NotNullConstraintError,
	OrmError,
	QueryError,
	RelationNotLoadedError,
	SchemaError,
	TransactionError,
	UniqueConstraintError,
} from "./errors";
export type {
	MigrateResult,
	Migration,
	MigrationContext,
	MigrationStatus,
	MigratorOptions,
	PretendMigration,
} from "./migrations/runner";
// --- migrations -------------------------------------------------------------
export { loadMigrations, Migrator } from "./migrations/runner";
export type {
	CastClass,
	CastContext,
	CastName,
	CastSpec,
	CustomCast,
	EnumCast,
	ResolvedCast,
} from "./model/casts";
export {
	isCastName,
	KNOWN_CASTS,
	parseCastName,
	verifyHashedValue,
} from "./model/casts";
export type {
	ModelEventListener,
	ModelEventName,
	ModelObserver,
	PivotEventListener,
	PivotEventName,
	PivotEventPayload,
} from "./model/events";
export type {
	FactoryDefinition,
	FactoryHandlers,
	FactoryValue,
	Seeder,
	SeederLike,
	SeederOptions,
} from "./model/factory";
export { defineSeeder, Factory, runSeeders } from "./model/factory";
export type {
	AnyModel,
	GlobalScope,
	LocalScope,
	ModelClass,
	ModelInternals,
	ModelMeta,
	ModelStatics,
	ScopeQueryOf,
} from "./model/model";
// --- models -----------------------------------------------------------------
export { defineGlobalScopes, defineScopes, Model } from "./model/model";
export type {
	IsolationLevel,
	MorphMapModel,
	OrmConfig,
	QueryEvent,
	QueryListener,
	TableMeta,
	TransactionOptions,
	TransactionScope,
} from "./orm";
// --- kernel -----------------------------------------------------------------
export { Orm } from "./orm";
export type {
	QueryBuilderMacros,
	WhereHasCallback,
	WithConstraints,
} from "./query/builder";
export { QueryBuilder } from "./query/builder";
export type { RawExpression } from "./query/raw";
// --- query builder ----------------------------------------------------------
export { isRawExpression, raw } from "./query/raw";
export type {
	AccessorNamesOf,
	AccessorValueOf,
	AggregateKeyOf,
	AggregateKind,
	AggregateValueOf,
	AllRelationPaths,
	AverageValueOf,
	ColumnRef,
	ColumnsOfModel,
	ComparisonOperator,
	CreateValues,
	CursorPaginated,
	FinalRelatedOf,
	InsertResult,
	InstanceOf,
	LoadedFor,
	NumericColumnOf,
	Paginated,
	RelationAggregateResult,
	RelationNamesOf,
	RelationsOf,
	ResultOf,
	RowValueOf,
	SimplePaginated,
	SoftDeleteMode,
	TableOfModel,
	WhereGroup,
	WithAccessors,
} from "./query/types";
export type {
	AnyRelationDescriptor,
	AnyRelations,
	BelongsTo,
	BelongsToMany,
	BelongsToManyOptions,
	HasMany,
	HasManyThrough,
	HasOne,
	HasOneThrough,
	MorphMany,
	MorphOne,
	MorphTo,
	MorphToMany,
	MorphToManyOptions,
	MorphToOptions,
	OfManyClause,
	RelationKind,
	ThroughOptions,
} from "./relations/descriptors";
// --- relations --------------------------------------------------------------
export {
	belongsTo,
	belongsToMany,
	hasMany,
	hasManyThrough,
	hasOne,
	hasOneThrough,
	latestOfMany,
	morphAliasOf,
	morphColumns,
	morphedByMany,
	morphMany,
	morphOne,
	morphTo,
	morphToMany,
	ofMany,
	oldestOfMany,
	relationAt,
	splitRelationPath,
	withDefault,
	withDefaultFor,
} from "./relations/descriptors";
export type {
	RelatedPkOf,
	RelatedRecord,
	RelatedTableOf,
	RelationManagerOf,
	RelationManagerRelationNames,
} from "./relations/manager";
export type {
	PivotBase,
	PivotClass,
	PivotClassLike,
	PivotLike,
} from "./relations/pivot";
// --- custom pivot models ----------------------------------------------------
export { Pivot } from "./relations/pivot";
export type {
	ColumnSpec,
	IndexSpec,
	ReferentialAction,
} from "./schema/builder";
// --- ddl --------------------------------------------------------------------
export {
	AlterTableBuilder,
	ColumnBuilder,
	SchemaBuilder,
	TableBuilder,
} from "./schema/builder";
export type {
	BaseType,
	BigIntSchema,
	ColumnDefinition,
	ColumnInput,
	ColumnMap,
	ColumnNameOf,
	ColumnsOf,
	ColumnType,
	ColumnValueOf,
	InsertOf,
	PrimaryKeyOf,
	PrimaryKeyValueOf,
	RowOf,
	Schema,
	SchemaOptions,
	TableName,
	UpdateOf,
} from "./schema/define";
// --- schema -----------------------------------------------------------------
export { defineSchema } from "./schema/define";
export { Stringable } from "./support/stringable";
