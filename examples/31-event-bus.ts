import { App, json } from "../src";
import { eventsPlugin, EventBus } from "../packages/events/src";

interface AppEvents {
  "user.registered": { id: string; email: string; timestamp: string };
  "email.sent": { to: string; subject: string };
  "audit.log": { action: string; details: any };
}

const app = new App();
app.plugin(eventsPlugin<AppEvents>());

const events = (app as any).events as EventBus<AppEvents>;

// Asynchronous listeners
events.on("user.registered", async (payload) => {
  console.log(`[Event: user.registered] Welcome email queueing for ${payload.email}`);
  await Bun.sleep(100);
  await events.emit("email.sent", { to: payload.email, subject: "Welcome to Barq!" });
});

events.on("email.sent", (payload) => {
  console.log(`[Event: email.sent] Sent to ${payload.to}: "${payload.subject}"`);
});

// Wildcard listener
events.on("user.*", (_, event) => {
  console.log(`[Audit Wildcard] Event triggered: ${event}`);
});

app.post("/api/users", async (ctx) => {
  const body = (await ctx.json()) as { email: string };
  const userId = `usr_${Date.now()}`;

  // Emit event inside route handler
  await (ctx.state as any).events.emit("user.registered", {
    id: userId,
    email: body.email,
    timestamp: new Date().toISOString(),
  });

  return json({ success: true, userId }, 201);
});

const server = app.listen(3000);
console.log(`EventBus demo running at http://localhost:${server.port}`);
console.log(`Test: curl -X POST -H "Content-Type: application/json" -d '{"email":"dev@barq.io"}' http://localhost:${server.port}/api/users`);
