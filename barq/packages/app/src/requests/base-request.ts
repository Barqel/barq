// Base class for request validators — extend it, declare `rules()`, and the
// controller calls `await request.validated()` to get typed, validated data.
//
//   export class CreateUserRequest extends BaseRequest {
//     rules() {
//       return { name: r.string().trim().min(2) };
//     }
//   }
//
// Data comes from the JSON body by default. Extend `ParamsRequest`,
// `QueryRequest` or `HeadersRequest` to validate another part of the request
// with the exact same engine (localized messages, field-level 400s):
//
//   export class ShowUserRequest extends ParamsRequest {
//     rules() {
//       return { id: r.string().min(1).max(36) };
//     }
//   }
//
// Override `authorize(ctx)` to add permission checks (return `false` → 403).
import type { Context } from "@barqel/barq";
import { ForbiddenException } from "../http/exceptions";
import { requireCtx } from "../http/request-context";
import type { RequestData, Rules } from "../vendor";
import { defineRequest, type RequestSource } from "./request";

export abstract class BaseRequest {
	abstract rules(): Rules;

	/** The request part `rules()` validates (default: the JSON body). */
	source(): RequestSource {
		return "body";
	}

	authorize(_ctx: Context): boolean | Promise<boolean> {
		return true;
	}

	// `ctx` is optional: when omitted it falls back to the request scope
	// (`requireCtx()`), so controllers call `validated()` with no arguments.
	// Passing it explicitly still works (tests, scripts, edge cases).
	async validated<T extends this>(
		this: T,
		ctx: Context = requireCtx(),
	): Promise<RequestData<T>> {
		if (!(await this.authorize(ctx))) {
			throw new ForbiddenException(ctx.t("errors.forbidden"));
		}

		return defineRequest(this.rules(), this.source())(ctx) as Promise<
			RequestData<T>
		>;
	}
}

/** Validates path params (`/:id`) — `validated()` returns the parsed map. */
export abstract class ParamsRequest extends BaseRequest {
	override source(): RequestSource {
		return "params";
	}
}

/** Validates the query string — `validated()` returns typed, coerced values. */
export abstract class QueryRequest extends BaseRequest {
	override source(): RequestSource {
		return "query";
	}
}

/** Validates request headers — names arrive lowercased. */
export abstract class HeadersRequest extends BaseRequest {
	override source(): RequestSource {
		return "headers";
	}
}
