import { App, HttpError, json, validateJson, type Validator } from "../src";

type CreateUser = { name: string; age: number };

const createUserValidator: Validator<CreateUser> = {
  parse(value) {
    if (typeof value !== "object" || value === null) {
      throw new HttpError(400, { error: "Expected a JSON object" });
    }

    const input = value as Record<string, unknown>;
    if (typeof input.name !== "string" || input.name.trim().length === 0) {
      throw new HttpError(422, { error: "name must be a non-empty string" });
    }
    if (typeof input.age !== "number" || !Number.isInteger(input.age)) {
      throw new HttpError(422, { error: "age must be an integer" });
    }

    return { name: input.name.trim(), age: input.age };
  },
};

const app = new App();

app.post(
  "/users",
  validateJson(createUserValidator, (_ctx, user) =>
    json({ created: true, user }, 201),
  ),
);

const server = app.listen(Number(Bun.env.PORT ?? 3000));
console.log(`POST JSON to http://localhost:${server.port}/users`);
