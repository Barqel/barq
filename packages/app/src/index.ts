// @barqel/barq-app — the Barq application framework.
//
// One dependency for the whole stack: the kernel (`createApp`, `start`,
// `shutdown`), base classes (`Job`, `Listener`, `Command`, `BaseRequest`),
// HTTP helpers, exceptions, the `*:make` generators, testing helpers and
// re-exports of every underlying primitive (HTTP core, plugins, DI,
// validation). Applications import from this package only.
import "reflect-metadata";

// Pull in the module augmentations (app.cron, app.events, app.openapi,
// ctx.t, …) for this package's own compilation; the emitted
// `dist/index.d.ts` references `./augment`, so applications importing this
// package get them automatically.
import type { AugmentMarker } from "./augment";

export type { HandlerDocs } from "@barqel/barq-openapi";

// --- CLI ---------------------------------------------------------------------
export { loadAppConfig, runCli } from "./cli";
export {
	IDEMPOTENCY_HEADER,
	idempotencyMiddleware,
	requireIdempotencyKey,
} from "./config/idempotency";
export type {
	LocalesConfig,
	ResolvedLocales,
	ResolveLocalesInput,
} from "./config/locales";
export { FRAMEWORK_MESSAGES, resolveLocales } from "./config/locales";
export type { AppOpenApiConfig, ResolvedOpenApiConfig } from "./config/openapi";
export { DEFAULT_OPENAPI, resolveOpenApi } from "./config/openapi";
// --- Framework middleware & config resolvers ---------------------------------
export { globalRateLimiter, strictRateLimiter } from "./config/rate-limit";
export type { AppStaticConfig, ResolvedStaticConfig } from "./config/storage";
export { resolveStatic } from "./config/storage";
export type { CommandClass } from "./console/command";
export { Command, registerCommands } from "./console/command";
export type { RegistryTarget } from "./console/generator";
export {
	camelCase,
	GeneratorCommand,
	kebabCase,
	pascalCase,
} from "./console/generator";
export type {
	BoundListener,
	ListenerClass,
	ListenerFactory,
	PayloadOf,
} from "./events/listener";
export { Listener, registerListeners } from "./events/listener";
export { ctxEvents, eventBus } from "./events/registry";
export type { ValidationErrorItem } from "./http/exceptions";
export {
	AppException,
	BadRequestException,
	ConflictException,
	ForbiddenException,
	NotFoundException,
	UnauthorizedException,
	ValidationException,
} from "./http/exceptions";
// --- HTTP helpers ------------------------------------------------------------
export {
	__,
	ctx,
	requestContextMiddleware,
	requireCtx,
	runWithCtx,
	t,
} from "./http/request-context";
export type { SseEmitter, SseHandler, SseMessage } from "./http/sse";
export { sse, sseStream } from "./http/sse";
export type { JobClass, RegisterJobsOptions } from "./jobs/job";
// --- App primitives ---------------------------------------------------------
export { Job, registerJobs } from "./jobs/job";
export type {
	BarqConfig,
	BarqServer,
	CreateAppOptions,
	StartOptions,
} from "./kernel/app";
// --- Kernel ---------------------------------------------------------------
export { createApp, defineConfig, shutdown, start } from "./kernel/app";
export type { BannerInfo } from "./kernel/banner";
export { printBanner } from "./kernel/banner";
export type { AppEnv, AppEnvName } from "./kernel/env";
export { ENV, env, isProduction } from "./kernel/env";
export { PROJECT_ROOT, PUBLIC_DIR } from "./kernel/paths";
export {
	BaseRequest,
	HeadersRequest,
	ParamsRequest,
	QueryRequest,
} from "./requests/base-request";
export {
	action,
	type RequestConstructor,
	validatedBy,
} from "./requests/handler";
export { defineRequest, type RequestSource } from "./requests/request";
export type { TestAppOptions, TestServer } from "./testing";

// --- Testing -------------------------------------------------------------------
export { createTestApp } from "./testing";
// --- Vendor primitives (HTTP core, plugins, DI, validation) --------------------
export * from "./vendor";
export type { AugmentMarker };
