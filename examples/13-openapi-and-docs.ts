import { App, json } from "../src";
import { openapi } from "../packages/openapi/src";

const app = new App();

app.plugin(
  openapi({
    title: "Barq Store API",
    version: "1.0.0",
    description: "High-performance API documented with Scalar and OpenAPI 3.1",
    docsPath: "/docs",
    specPath: "/openapi.json",
    ui: "scalar",
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
  })
);

app.get(
  "/products/:id",
  {
    schema: {
      tags: ["Products"],
      summary: "Get product by ID",
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      responses: {
        200: { description: "Product details returned" },
      },
    },
  },
  (ctx) => {
    const valid = ctx.valid as { params: { id: string } };
    return json({ id: valid.params.id, name: "MacBook Pro M-Series" });
  }
);

app.post(
  "/products",
  {
    schema: {
      tags: ["Products"],
      summary: "Create product",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        properties: {
          name: { type: "string" },
          price: { type: "number" },
        },
        required: ["name", "price"],
      },
      responses: {
        201: { description: "Product created" },
      },
    },
  },
  (ctx) => {
    const valid = ctx.valid as { body: { name: string; price: number } };
    return json({ created: true, item: valid.body }, 201);
  }
);

const server = app.listen(3000);
console.log(`\n🚀 Server listening at http://localhost:${server.port}`);
console.log(`📖 Interactive Docs at: http://localhost:${server.port}/docs`);
console.log(`📄 OpenAPI Spec at: http://localhost:${server.port}/openapi.json\n`);
