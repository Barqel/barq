import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	action,
	BaseRequest,
	type Context,
	controller,
	createTestApp,
	defineConfig,
	HeadersRequest,
	json,
	NotFoundException,
	ParamsRequest,
	QueryRequest,
	r,
	type TestServer,
	validatedBy,
} from "../src/index";

class SignupRequest extends BaseRequest {
	rules() {
		return {
			email: r.string().trim().email(),
			age: r.number().int().min(18).default(21),
		};
	}
}

class ShowUserRequest extends ParamsRequest {
	rules() {
		return {
			id: r.string().regex(/^\d+$/, "digits only"),
		};
	}
}

class PageRequest extends QueryRequest {
	rules() {
		return {
			page: r.coerce.number().int().min(1).default(1),
			search: r.string().trim().min(2).optional(),
		};
	}
}

class ApiKeyRequest extends HeadersRequest {
	rules() {
		return {
			"x-api-key": r.string().min(8),
		};
	}
}

// A controller-style class: `controller()` binds prototype methods (and
// carries the `@validatedBy` stamp over) so `usersController.show` can be
// handed to `action` as-is.
class UsersController {
	private readonly prefix = "user";

	@validatedBy(ShowUserRequest)
	async show(ctx: Context, data: { id: string }) {
		return json({ id: `${this.prefix}-${data.id}`, path: ctx.params.id });
	}

	// No request class: `data` receives the raw `ctx.params` — no rules, no
	// coercion (and `this` must stay bound).
	raw(ctx: Context, data: { id: string }) {
		return json({ prefix: this.prefix, id: data.id, path: ctx.params.id });
	}

	// A `ctx`-only method works too — the raw params are still passed, it
	// just ignores them.
	me(_ctx: Context) {
		return json({ prefix: this.prefix });
	}
}

const usersController = controller(UsersController);

const config = defineConfig({
	name: "Requests App",
	routes: (app) => {
		app.post("/signup", async (_ctx) => {
			const data = await new SignupRequest().validated();
			return json({ success: true, data }, 201);
		});

		app.get("/users/:id", async () => {
			const params = await new ShowUserRequest().validated();
			const query = await new PageRequest().validated();
			return json({ params, query });
		});

		app.get("/secure", async () => {
			const headers = await new ApiKeyRequest().validated();
			return json({ headers });
		});

		app.get("/gone", () => {
			throw new NotFoundException("gone");
		});

		// `action` binds the validator to the route: `run` follows the
		// framework's `(ctx, data)` convention and gets typed,
		// already-validated data.
		app.get(
			"/typed/:id",
			action(ShowUserRequest, (ctx, data) =>
				json({ data, path: ctx.params.id }),
			),
		);

		app.post(
			"/typed",
			action(SignupRequest, (_ctx, data) => json({ success: true, data }, 201)),
		);

		// A controller method passed directly — the request class comes from
		// its `@validatedBy` stamp, and `this` must stay bound.
		app.get("/controller/:id", action(usersController.show));

		// No request class → no validation: `data` is the raw `ctx.params`.
		app.get("/plain/:id", action(usersController.raw));
		app.get("/me", action(usersController.me));
	},
});

describe("BaseRequest validation", () => {
	let server: TestServer;

	beforeAll(() => {
		server = createTestApp(config);
	});

	afterAll(async () => {
		await server.close();
	});

	function post(body: unknown, headers: Record<string, string> = {}) {
		return fetch(`${server.baseUrl}/signup`, {
			method: "POST",
			headers: { "content-type": "application/json", ...headers },
			body: JSON.stringify(body),
		});
	}

	it("returns typed, defaulted data on success", async () => {
		const response = await post({ email: "  a@b.co  " });
		expect(response.status).toBe(201);

		const body = (await response.json()) as {
			data: { email: string; age: number };
		};
		expect(body.data.email).toBe("a@b.co");
		expect(body.data.age).toBe(21);
	});

	it("returns structured field errors", async () => {
		const response = await post({ email: "nope" });
		expect(response.status).toBe(400);

		const body = (await response.json()) as {
			success: boolean;
			errors: Array<{ field: string; code: string; message: string }>;
		};
		expect(body.success).toBe(false);
		expect(body.errors.map((error) => error.field)).toContain("email");
	});

	it("localizes the envelope message with Accept-Language: ar", async () => {
		const response = await post({ email: "nope" }, { "accept-language": "ar" });

		expect(response.status).toBe(400);

		const body = (await response.json()) as { message: string };
		expect(body.message).toBe("فشل التحقق من البيانات المدخلة");
	});

	it("renders the AppException family through onError", async () => {
		const response = await fetch(`${server.baseUrl}/gone`);

		expect(response.status).toBe(404);

		const body = (await response.json()) as Record<string, unknown>;
		expect(body.success).toBe(false);
		expect(body.message).toBe("gone");
	});

	it("validates params and coerces query through the same engine", async () => {
		const response = await fetch(
			`${server.baseUrl}/users/42?page=3&search=%20ali%20`,
		);

		expect(response.status).toBe(200);

		const body = (await response.json()) as {
			params: { id: string };
			query: { page: number; search: string };
		};

		expect(body.params.id).toBe("42");
		expect(body.query.page).toBe(3);
		expect(typeof body.query.page).toBe("number");
		expect(body.query.search).toBe("ali");
	});

	it("applies query defaults when the key is absent", async () => {
		const response = await fetch(`${server.baseUrl}/users/42`);

		expect(response.status).toBe(200);

		const body = (await response.json()) as { query: { page: number } };
		expect(body.query.page).toBe(1);
	});

	it("returns field-level 400s for params, query and headers", async () => {
		const badParam = await fetch(`${server.baseUrl}/users/abc`);
		expect(badParam.status).toBe(400);
		expect(
			(
				(await badParam.json()) as { errors: Array<{ field: string }> }
			).errors.map((error) => error.field),
		).toContain("id");

		const badQuery = await fetch(`${server.baseUrl}/users/42?page=0`);
		expect(badQuery.status).toBe(400);
		expect(
			(
				(await badQuery.json()) as { errors: Array<{ field: string }> }
			).errors.map((error) => error.field),
		).toContain("page");

		const noKey = await fetch(`${server.baseUrl}/secure`);
		expect(noKey.status).toBe(400);
		expect(
			((await noKey.json()) as { errors: Array<{ field: string }> }).errors.map(
				(error) => error.field,
			),
		).toContain("x-api-key");

		const withKey = await fetch(`${server.baseUrl}/secure`, {
			headers: { "x-api-key": "secret-key-1" },
		});
		expect(withKey.status).toBe(200);
	});

	it("action passes typed data and forwards ctx", async () => {
		const response = await fetch(`${server.baseUrl}/typed/42`);
		expect(response.status).toBe(200);

		const body = (await response.json()) as {
			data: { id: string };
			path: string;
		};
		expect(body.data.id).toBe("42");
		expect(body.path).toBe("42");
	});

	it("action applies defaults and returns typed bodies", async () => {
		const response = await fetch(`${server.baseUrl}/typed`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: "  a@b.co  " }),
		});
		expect(response.status).toBe(201);

		const body = (await response.json()) as {
			data: { email: string; age: number };
		};
		expect(body.data.email).toBe("a@b.co");
		expect(body.data.age).toBe(21);
	});

	it("action short-circuits with the localized 400 before run()", async () => {
		const response = await fetch(`${server.baseUrl}/typed/abc`, {
			headers: { "accept-language": "ar" },
		});
		expect(response.status).toBe(400);

		const body = (await response.json()) as {
			message: string;
			errors: Array<{ field: string }>;
		};
		expect(body.message).toBe("فشل التحقق من البيانات المدخلة");
		expect(body.errors.map((error) => error.field)).toContain("id");
	});

	it("action accepts a controller method directly (this stays bound)", async () => {
		const response = await fetch(`${server.baseUrl}/controller/42`);
		expect(response.status).toBe(200);

		const body = (await response.json()) as { id: string; path: string };
		expect(body.id).toBe("user-42");
		expect(body.path).toBe("42");
	});

	it("action(run) validates through the @validatedBy stamp", async () => {
		const response = await fetch(`${server.baseUrl}/controller/abc`, {
			headers: { "accept-language": "ar" },
		});
		expect(response.status).toBe(400);

		const body = (await response.json()) as {
			message: string;
			errors: Array<{ field: string }>;
		};
		expect(body.message).toBe("فشل التحقق من البيانات المدخلة");
		expect(body.errors.map((error) => error.field)).toContain("id");
	});

	it("action(run) without a request class forwards raw params as data", async () => {
		const response = await fetch(`${server.baseUrl}/plain/anything`);
		expect(response.status).toBe(200);

		const body = (await response.json()) as {
			prefix: string;
			id: string;
			path: string;
		};
		expect(body.prefix).toBe("user");
		// Raw — the validated `/controller/:id` regex would reject this value.
		expect(body.id).toBe("anything");
		expect(body.path).toBe("anything");
	});

	it("action(run) without a request class works for ctx-only methods", async () => {
		const response = await fetch(`${server.baseUrl}/me`);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ prefix: "user" });
	});
});
