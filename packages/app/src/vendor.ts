// Vendor barrel — the single import point for every primitive the
// application needs: HTTP core, plugins, DI, validation and shared helpers.
//
// Application code imports from "@barq", never directly from
// `@barqel/*`, `tsyringe` or `zod`. Upgrades (and even swaps — e.g. a DI or
// validation library change) stay confined to this package.

import type { RouteGroup } from "@barqel/barq";
import collectJs, { type Collection } from "collect.js";
import { container, type InjectionToken } from "tsyringe";
import type { z } from "zod";
import arZodLocale from "zod/v4/locales/ar.js";
import enZodLocale from "zod/v4/locales/en.js";
import { attachRequestClass, readRequestClass } from "./requests/request-meta";

export type {
	CorsOptions,
	ErrorHandler,
	Handler,
	Middleware,
	NotFoundHandler,
	Params,
	RouteParams,
} from "@barqel/barq";
// --- HTTP core (@barqel/barq) ---
export {
	App,
	Context,
	cors,
	empty,
	HttpError,
	json,
	RouteGroup,
	redirect,
	text,
} from "@barqel/barq";
export type {
	CliOptions,
	CommandAction,
	CommandContext,
	CommandDefinition,
	CommandFlag,
} from "@barqel/barq-cli";
export { Cli, createCli, parseArgv } from "@barqel/barq-cli";
export type { CompressOptions } from "@barqel/barq-compress";
export { compressPlugin } from "@barqel/barq-compress";
export type {
	CronDay,
	CronJobInterface,
	CronJobOptions,
	CronTask,
	CronUnit,
} from "@barqel/barq-cron";
export {
	Cron,
	CronJob,
	CronScheduler,
	cron,
	getNextCronRun,
	parseCronExpression,
} from "@barqel/barq-cron";
export type {
	MailAddress,
	MailAttachment,
	MailAuth,
	MailMessage,
	MailOptions,
	MailSendResult,
	MailTemplate,
	MailTlsOptions,
	MailTransport,
} from "@barqel/barq-email";
export {
	createMailer,
	emailPlugin,
	flattenAddresses,
	hasMailer,
	MailConfigurationError,
	MailDeliveryError,
	Mailer,
	MailTemplateError,
	MailValidationError,
	mailer,
	renderTemplate,
	renderTemplateMessage,
	setMailer,
} from "@barqel/barq-email";
export type {
	CreateEnvOptions,
	EnvSchema,
	InferEnv,
} from "@barqel/barq-env";
// --- Environment authoring (validate your own APP variables) ---
// The framework's validated instance is exported as `env`; `envRules`
// builds schemas for application-specific variables:
//
//   import { createEnv, envRules } from "@barq";
//   export const appEnv = createEnv({ DATABASE_URL: envRules.string() });
export { createEnv, env as envRules } from "@barqel/barq-env";
export type {
	EventBusOptions,
	EventDefinition,
	EventListener,
	EventPayload,
} from "@barqel/barq-events";
export { defineEvent, EventBus, eventsPlugin } from "@barqel/barq-events";
export type { HelmetOptions } from "@barqel/barq-helmet";
export { helmetPlugin } from "@barqel/barq-helmet";
export type {
	I18nOptions,
	TranslateFunction,
	TranslationDictionary,
	TranslationsRecord,
} from "@barqel/barq-i18n";
// --- Plugins ---
export { i18nPlugin } from "@barqel/barq-i18n";
export type {
	IdempotencyOptions,
	IdempotencyRecord,
	IdempotencyResponse,
	IdempotencyStore,
} from "@barqel/barq-idempotency";
export {
	idempotency,
	idempotencyPlugin,
	MemoryIdempotencyStore,
} from "@barqel/barq-idempotency";
export type { LoggerOptions, LogLevel } from "@barqel/barq-logger";
export { loggerPlugin } from "@barqel/barq-logger";
export type {
	OpenAPIOptions,
	RouteConfig,
	RouteSchema,
} from "@barqel/barq-openapi";
export {
	OpenAPIRegistry,
	openapi as openapiPlugin,
	toJsonSchema,
} from "@barqel/barq-openapi";
export type {
	RateLimitInfo,
	RateLimitOptions,
	RateLimitStore,
} from "@barqel/barq-rate-limit";
export { MemoryStore, rateLimit, rateLimiter } from "@barqel/barq-rate-limit";
export type { StaticOptions } from "@barqel/barq-static";
export { staticFiles } from "@barqel/barq-static";
export type { DependencyContainer, InjectionToken } from "tsyringe";
// --- Dependency injection (tsyringe) ---
export {
	autoInjectable,
	container,
	inject,
	injectable,
	singleton,
} from "tsyringe";
export type { ZodIssue, ZodRawShape, ZodType } from "zod";
// --- Validation (zod v4, exposed as `r`) ---
export { z, z as r } from "zod";

// --- Collections (collect.js) --------------------------------------------------
// Laravel-style pipelines over arrays and objects:
//   collect(users).filter((user) => user.role === "admin").count()
// `slice(offset, length)` takes a length (not an end index) and chains end
// with `all()` / `count()`.
export type { Collection };
export function collect<T>(items?: T[] | Record<string, T>): Collection<T> {
	return collectJs<T>(items);
}

// Zod built-in locale error maps, built once. The request validator picks
// one per request from `ctx.state.locale` (set by the i18n middleware),
// so no global `z.config(...)` mutation and no cross-request language clash.
export const zodErrorMaps = {
	ar: arZodLocale().localeError,
	en: enZodLocale().localeError,
} as const;

// Shape returned directly by `BaseRequest.rules()` — the framework wraps
// it with `r.object(...)` automatically, so request classes never call
// `.object()` themselves.
export type Rules = z.ZodRawShape;

// --- DI conveniences ---
export function resolve<T>(token: InjectionToken<T>): T {
	return container.resolve(token);
}

// Controllers are commonly passed straight into `action`
// (`action(Request, userController.show)`), so prototype methods are bound
// to the instance when it is resolved — extracting a method can never lose
// `this`. Own properties (class fields, incl. arrow functions) are left as
// they are.
function bindMethods(instance: object): void {
	for (
		let proto = Object.getPrototypeOf(instance) as object | null;
		proto !== null && proto !== Object.prototype;
		proto = Object.getPrototypeOf(proto) as object | null
	) {
		for (const key of Object.getOwnPropertyNames(proto)) {
			if (key === "constructor" || Object.hasOwn(instance, key)) {
				continue;
			}

			const fn = Object.getOwnPropertyDescriptor(proto, key)?.value;

			if (typeof fn !== "function") {
				continue;
			}

			const bound = fn.bind(instance);

			// Carry the `@validatedBy(Request)` stamp over to the bound copy.
			const Request = readRequestClass(fn);

			if (Request) {
				attachRequestClass(bound, Request);
			}

			Object.defineProperty(instance, key, {
				value: bound,
				configurable: true,
				writable: true,
			});
		}
	}
}

export function controller<T>(token: InjectionToken<T>): T {
	const instance = resolve(token);

	if (typeof instance === "object" && instance !== null) {
		bindMethods(instance);
	}

	return instance;
}

// --- Shared type aliases ---
export type Route = RouteGroup<"", Record<string, unknown>>;

// Infers the validated output of a `BaseRequest` subclass:
//   class CreateUserRequest extends BaseRequest { rules() { return { name: r.string() } } }
//   RequestData<CreateUserRequest> => { name: string; ... }
export type RequestData<T extends { rules: (...args: never[]) => Rules }> =
	z.output<z.ZodObject<ReturnType<T["rules"]>>>;

export type {
	AutoRegisterConfig,
	AutoRegisterKind,
	AutoRegisterResult,
	AutoRegisterWarning,
	AutoRegisterWarningCode,
} from "./auto-register";
// --- Auto-register ---
export { defineConfigAsync } from "./auto-register";
