import { join } from "node:path";
import { App, json } from "../src";
import { staticFiles } from "../packages/static/src";

const app = new App();
const publicDir = join(import.meta.dir, "public");

app.plugin(
  staticFiles({
    root: publicDir,
    maxAge: 3600,
    spa: true,
  })
);

app.get("/api/health", () => json({ status: "healthy" }));

const server = app.listen(3000);
console.log(`Static file demo server running at http://localhost:${server.port}`);
console.log(`Try opening http://localhost:${server.port}/ in your browser`);
