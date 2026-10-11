
      import { App } from "./dist/index.js";
      
      const app = new App({ cookieSecret: "test-secret-key-at-least-32-bytes-long-123456" });
      
      app.get("/", (ctx) => "Hello from Node");
      app.get("/users/:id", (ctx) => ({ id: ctx.params.id }));
      app.post("/echo", async (ctx) => await ctx.json());
      app.get("/cookie", (ctx) => {
        ctx.cookies.setSigned("session", "user-node");
        return "cookie-set";
      });
      app.get("/get-cookie", (ctx) => {
        return ctx.cookies.getSigned("session") || "null";
      });

      const server = app.listen(0);
      console.log("PORT:" + server.port);
    