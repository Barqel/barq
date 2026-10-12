import { describe, expect, it } from "bun:test";
import { App, json } from "@barqel/barq";
import { z } from "zod";
import { validateZod, zValidator } from "../src/index";

describe("@barqel/barq-zod", () => {
	it("validates json body and sets ctx.valid", async () => {
		const app = new App();
		const UserSchema = z.object({
			name: z.string().min(3),
			age: z.number().int().min(18),
		});

		app.post("/users", zValidator("json", UserSchema), (ctx) => {
			const { body } = ctx.valid as { body: z.infer<typeof UserSchema> };
			return json({ created: true, user: body }, 201);
		});

		const server = app.listen(0);

		try {
			const validRes = await fetch(`http://localhost:${server.port}/users`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ name: "Ada Lovelace", age: 36 }),
			});
			expect(validRes.status).toBe(201);
			const validData = await validRes.json();
			expect(validData.user.name).toBe("Ada Lovelace");

			const invalidRes = await fetch(`http://localhost:${server.port}/users`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ name: "A", age: 16 }),
			});
			expect(invalidRes.status).toBe(422);
			const errData = await invalidRes.json();
			expect(errData.error).toBe("Validation Failed");
			expect(errData.issues.length).toBe(2);
		} finally {
			await app.stop();
		}
	});

	it("validates query and params concurrently with validateZod", async () => {
		const app = new App();

		app.get(
			"/items/:id",
			validateZod({
				params: z.object({ id: z.string().regex(/^\d+$/) }),
				query: z.object({ limit: z.string().transform(Number) }),
			}),
			(ctx) => {
				const valid = ctx.valid as { params: { id: string }; query: { limit: number } };
				return json({ id: Number(valid.params.id), limit: valid.query.limit });
			},
		);

		const server = app.listen(0);

		try {
			const res = await fetch(`http://localhost:${server.port}/items/42?limit=10`);
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ id: 42, limit: 10 });

			const invalidRes = await fetch(`http://localhost:${server.port}/items/not-a-number?limit=10`);
			expect(invalidRes.status).toBe(422);
		} finally {
			await app.stop();
		}
	});
});
