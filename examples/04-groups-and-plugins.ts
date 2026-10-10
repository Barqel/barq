import { App, json, type RouteGroup } from "../src";

function addServiceMetadata<Prefix extends string, State extends object>(
  group: RouteGroup<Prefix, State>,
  options?: { serviceName: string },
): void {
  group.get("/meta", () =>
    json({ service: options?.serviceName ?? "catalog" }),
  );
}

const requireApiKey = {
  before(ctx: { req: Request }) {
    if (ctx.req.headers.get("x-api-key") !== Bun.env.API_KEY) {
      return new Response("Unauthorized", { status: 401 });
    }
  },
};

const app = new App();
app.plugin(
  (application, options?: { serviceName: string }) => {
    application.get("/service-name", () =>
      json({ service: options?.serviceName ?? "catalog" }),
    );
  },
  { serviceName: "catalog" },
);

app.group("/api/v1", requireApiKey, (api) => {
  api.plugin(addServiceMetadata, { serviceName: "catalog" });

  api.get("/products/:productId", (ctx) =>
    json({ productId: ctx.params.productId }),
  );

  api.group("/admin", (admin) => {
    admin.get("/summary", () => json({ activeProducts: 12 }));
  });
});

const server = app.listen(Number(Bun.env.PORT ?? 3000));
console.log(`API listening at http://localhost:${server.port}/api/v1/meta`);
