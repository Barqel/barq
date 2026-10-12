import type { App } from "@barqel/barq";
import { TestClient } from "./client";
import type { TestClientOptions } from "./types";

export * from "./types";
export * from "./cookies";
export * from "./client";

export function testClient(app: App<any>, options?: TestClientOptions): TestClient {
	return new TestClient(app, options);
}

export function createTestClient(app: App<any>, options?: TestClientOptions): TestClient {
	return new TestClient(app, options);
}
