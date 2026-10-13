import { App, json, type Middleware } from "../src";

const requestIdentityAndResponseHeaders = {
	before(ctx) {
		const authorization = ctx.req.headers.get("authorization");
		if (!authorization) {
			return new Response("Send an Authorization header", { status: 401 });
		}
		return { user: { id: authorization.replace(/^Bearer\s+/i, "") } };
	},
	after(_ctx, response) {
		const headers = new Headers(response.headers);
		headers.set("x-after-hook", "completed");
		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers,
		});
	},
} satisfies Middleware<Record<string, unknown>, { user: { id: string } }>;

const app = new App().use(requestIdentityAndResponseHeaders);

app.get("/me", (ctx) => json({ id: ctx.state.user.id }));

const requireAdmin = {
	before(ctx) {
		if (ctx.req.headers.get("x-role") !== "admin") {
			return new Response("Forbidden", { status: 403 });
		}
	},
} satisfies Middleware<Record<string, unknown>, {}>;

// Route-local middleware runs only for this route.
app.get("/admin", requireAdmin, () => json({ secret: "visible to admin" }));

const server = app.listen(Number(Bun.env.PORT ?? 3000));
console.log(
	`Try: curl -H "Authorization: Bearer user-1" http://localhost:${server.port}/me`,
);
