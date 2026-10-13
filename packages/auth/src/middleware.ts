import { type Context, HttpError, type Middleware } from "@barqel/barq";
import { AuthError, verifyJwt } from "./jwt";
import type { BearerAuthOptions, JwtPayload } from "./types";

export function bearerAuth<TUser = JwtPayload>(
	options: BearerAuthOptions<TUser>,
): Middleware {
	const headerName = options.headerName?.toLowerCase() ?? "authorization";
	const cookieName = options.cookieName;

	return {
		async before(ctx: Context) {
			let token: string | undefined;

			const authHeader = ctx.req.headers.get(headerName);
			if (authHeader) {
				const parts = authHeader.trim().split(" ");
				if (parts.length === 2 && /^bearer$/i.test(parts[0]!)) {
					token = parts[1];
				}
			}

			if (!token && cookieName) {
				token = ctx.cookies.get(cookieName);
			}

			if (!token) {
				if (options.optional) return;
				throw new HttpError(401, {
					error: "Unauthorized",
					code: "MISSING_TOKEN",
					message: "Authorization token required",
				});
			}

			const secret =
				typeof options.secret === "function"
					? await options.secret(ctx)
					: options.secret;

			try {
				const payload = verifyJwt(token, secret, options.verifyOptions);
				const user = options.resolveUser
					? await options.resolveUser(payload, ctx)
					: (payload as unknown as TUser);

				const state = ctx.state as Record<string, unknown>;
				state.user = user;
				state.token = token;
			} catch (err) {
				if (options.optional) return;
				const message =
					err instanceof AuthError ? err.message : "Invalid or expired token";
				const code = err instanceof AuthError ? err.code : "INVALID_TOKEN";
				throw new HttpError(401, { error: "Unauthorized", code, message });
			}
		},
	};
}

export function requireRoles(...allowedRoles: string[]): Middleware {
	return {
		before(ctx: Context) {
			const user = (ctx.state as Record<string, unknown>).user as
				| Record<string, unknown>
				| undefined;
			if (!user) {
				throw new HttpError(401, {
					error: "Unauthorized",
					code: "UNAUTHENTICATED",
				});
			}

			const userRole = (user.role ?? user.roles) as
				| string
				| string[]
				| undefined;
			const roles = Array.isArray(userRole)
				? userRole
				: userRole
					? [userRole]
					: [];

			const hasRole = allowedRoles.some((r) => roles.includes(r));
			if (!hasRole) {
				throw new HttpError(403, {
					error: "Forbidden",
					code: "INSUFFICIENT_PERMISSIONS",
					message: `Requires one of roles: ${allowedRoles.join(", ")}`,
				});
			}
		},
	};
}
