// Start barq + elysia, dump raw wire bytes with a raw TCP client.

import { connect } from "node:net";
import { spawn } from "bun";

const barq = spawn(["bun", "run", "src/barq.ts"], {
  env: { ...process.env, PORT: "3410" },
  stdout: "pipe",
  stderr: "pipe",
});
const elysia = spawn(["bun", "run", "src/elysia.ts"], {
  env: { ...process.env, PORT: "3411" },
  stdout: "pipe",
  stderr: "pipe",
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
await wait(2500);

function rawRequest(port: number, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = connect(port, "127.0.0.1", () => {
      sock.write(
        `GET ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`,
      );
    });
    let buf = "";
    sock.on("data", (d) => (buf += d.toString("latin1")));
    sock.on("end", () => resolve(buf));
    sock.on("error", reject);
    setTimeout(() => {
      sock.destroy();
      resolve(buf);
    }, 3000);
  });
}

for (const [name, port] of [
  ["barq", 3410],
  ["elysia", 3411],
] as const) {
  const raw = await rawRequest(port, "/users/42");
  console.log(`\n########## ${name} ##########`);
  console.log(JSON.stringify(raw));
  console.log(`--- wire bytes: ${Buffer.byteLength(raw, "latin1")}`);
}

barq.kill();
elysia.kill();
await wait(300);
process.exit(0);
