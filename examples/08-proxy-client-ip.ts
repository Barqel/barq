import { App, json } from "../src";

// List only the addresses or CIDR ranges of proxies that connect directly
// to this server. Never trust forwarded headers from arbitrary clients.
const app = new App({
  trustProxy: ["127.0.0.1", "::1", "10.20.0.0/16"],
});

app.get("/whoami", (ctx) => json({ clientIp: ctx.ip }));

const server = app.listen(Number(Bun.env.PORT ?? 3000));
console.log(`Client IP example listening at http://localhost:${server.port}/whoami`);
