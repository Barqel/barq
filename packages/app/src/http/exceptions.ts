// HTTP exception family — throw these anywhere a handler runs and the
// error pipeline turns them into the standard JSON envelope:
//
//   throw new NotFoundException(ctx.t("users.notFound"));
//   → 404 { "success": false, "message": "…" }
//
// They build on Barq's `HttpError`, which both the global `onError`
// resolver and the default route error handler understand.
import { HttpError } from "@barqel/barq";

/** Base class: any HTTP error with the app's `{ success, message }` body. */
export class AppException extends HttpError {
	constructor(
		status: number,
		message: string,
		extra: Record<string, unknown> = {},
	) {
		super(status, { success: false, message, ...extra });
	}
}

export class BadRequestException extends AppException {
	constructor(message: string, extra: Record<string, unknown> = {}) {
		super(400, message, extra);
	}
}

export class UnauthorizedException extends AppException {
	constructor(message: string, extra: Record<string, unknown> = {}) {
		super(401, message, extra);
	}
}

export class ForbiddenException extends AppException {
	constructor(message: string, extra: Record<string, unknown> = {}) {
		super(403, message, extra);
	}
}

export class NotFoundException extends AppException {
	constructor(message: string, extra: Record<string, unknown> = {}) {
		super(404, message, extra);
	}
}

export class ConflictException extends AppException {
	constructor(message: string, extra: Record<string, unknown> = {}) {
		super(409, message, extra);
	}
}

export interface ValidationErrorItem {
	field: string;
	code: string;
	message: string;
}

export class ValidationException extends HttpError {
	constructor(errors: ValidationErrorItem[], message: string) {
		super(400, {
			success: false,
			message,
			errors,
		});
	}
}
