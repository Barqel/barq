import type { Server } from "bun";

export interface ShutdownResult {
	forced: boolean;
	pending: number;
}

export async function stopServer(
	server: Server<unknown>,
	hardTimeoutMs: number,
): Promise<ShutdownResult> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let forced = false;
	let stopPromise: Promise<void> | null = null;

	try {
		stopPromise = Promise.resolve(server.stop()).then(() => {});
		await Promise.race([
			stopPromise,
			new Promise<void>((resolve) => {
				timer = setTimeout(() => {
					forced = true;
					stopPromise = Promise.resolve(server.stop(true)).then(() => {});
					resolve();
				}, hardTimeoutMs);
				timer?.unref?.();
			}),
		]);
	} finally {
		if (timer !== undefined) {
			clearTimeout(timer);
		}
	}

	await stopPromise;

	return {
		forced,
		pending: 0,
	};
}
