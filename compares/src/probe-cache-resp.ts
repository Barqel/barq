// Can Bun re-send a cached Response object for a DYNAMIC route?
const json = '{"id":"42","name":"Ada"}';
const HDRS = new Headers({ "content-type": "application/json; charset=utf-8" });
const cache = new Map<string, Response>();

const server = Bun.serve({
  port: 0,
  routes: {
    "/cached/:id": (req: Request) => {
      const id = (req as Record<string, unknown>).params?.id as string;
      let res = cache.get(id);
      if (!res) {
        res = new Response(json, { headers: HDRS });
        cache.set(id, res);
      }
      return res;
    },
  },
  fetch: () => new Response("miss"),
});

const url = `http://localhost:${server.port}/cached/42`;
for (let i = 0; i < 3; i++) {
  try {
    const r = await fetch(url);
    console.log(`attempt ${i}: ${r.status} ${JSON.stringify(await r.text())}`);
  } catch (e) {
    console.log(`attempt ${i}: FAILED ${(e as Error).message.slice(0, 80)}`);
  }
}
server.stop();
