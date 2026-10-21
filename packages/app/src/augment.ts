// Module augmentations applied to the underlying framework packages.
//
// These declarations are part of this package's published types
// (`dist/index.d.ts` references this file), so every application importing
// `@barq` gets the extra properties typed automatically:
//
// - `app.cron` / `app.schedule` / `app.events` / `app.openapi` — installed
//   at runtime by the plugins `createApp()` wires.
// - `ctx.t(...)` — installed at runtime by `i18nPlugin()`.
import type { Params } from "@barqel/barq";
import type { CronScheduler } from "@barqel/barq-cron";
import type { Mailer } from "@barqel/barq-email";
import type { EventBus } from "@barqel/barq-events";
import type { TranslateFunction } from "@barqel/barq-i18n";
import type { OpenAPIRegistry } from "@barqel/barq-openapi";

declare module "@barqel/barq" {
	interface App<TState extends object = Record<string, unknown>> {
		cron: CronScheduler;
		schedule: CronScheduler["add"];
		events: EventBus;
		openapi: OpenAPIRegistry;
		/** The mailer — installed at runtime by `emailPlugin()`. */
		mail: Mailer;
	}

	// Added by `i18nPlugin()` — the active translator for the request locale.
	interface Context<
		TParams extends object = Params,
		TState extends object = Record<string, unknown>,
	> {
		t: TranslateFunction;
	}
}

/** Marker used by `index.ts` so declaration emit keeps this file loaded. */
export type AugmentMarker = true;
