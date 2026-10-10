import { Elysia } from "elysia";

const app = new Elysia().get("/users/:id", ({ params }) => ({
  id: params.id,
  name: "Ada",
}));
const anyApp = app as Record<string, unknown>;
console.log("keys:", Object.keys(anyApp).join(", "));
const table = anyApp.routes;
const entries =
  table instanceof Map ? [...table.entries()] : Object.entries(table);
for (const [k, v] of entries) {
  if (typeof k !== "string") continue;
  console.log("=== route:", k);
  const entry = Array.isArray(v) ? v[0] : v;
  const h = entry?.handler;
  console.log("handler fn:", h?.toString?.()?.slice(0, 2000));
}
