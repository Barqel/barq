import cluster from "node:cluster";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import type { AddressInfo, Socket } from "node:net";
import { cpus } from "node:os";
import { type Duplex, Readable } from "node:stream";
import type { Server, ServerWebSocket } from "bun";
import { App, type WebSocketOptions } from "../app";
import type { WebSocketHandlers } from "../types";
import { scanPathname } from "./pathname";
import type { ShutdownResult } from "./shutdown";

const isNode = typeof Bun === "undefined";
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

interface InternalWsSession {
	handlers?: WebSocketHandlers;
	_barqInternal?: boolean;
	data?: unknown;
}

const nodeTopics = new Map<string, Set<NodeServerWebSocket<unknown>>>();

class NodeServerWebSocket<TData = unknown> {
	readonly socket: Duplex;
	data: TData;
	readyState = 1;
	readonly remoteAddress: string;
	readonly topics = new Set<string>();
	private buffer: Buffer = Buffer.alloc(0);
	private fragments: Buffer[] = [];
	private fragmentOpcode = 0;
	private readonly maxPayloadLength: number;
	private readonly handlers?: WebSocketHandlers;
	private readonly appHandlers?: WebSocketHandlers;

	constructor(socket: Duplex, data: TData, wsOptions?: WebSocketOptions) {
		this.socket = socket;
		this.data = data;
		this.remoteAddress =
			("remoteAddress" in socket ? (socket as Socket).remoteAddress : "") || "";
		this.maxPayloadLength = wsOptions?.maxPayloadLength ?? 16 * 1024 * 1024;
		this.appHandlers = wsOptions;

		const internal = (data as InternalWsSession)?._barqInternal
			? (data as InternalWsSession).handlers
			: undefined;
		this.handlers = internal;

		socket.on("data", (chunk: Buffer) => this.onData(chunk));
		socket.on("close", () => this.onClose(1006, ""));
		socket.on("error", (err: Error) => this.onError(err));
		socket.on("drain", () => this.onDrain());
	}

	send(data: string | Buffer | Uint8Array | ArrayBufferView | unknown): number {
		if (this.readyState !== 1) return -1;
		let payload: Buffer;
		let isText = true;

		if (typeof data === "string") {
			payload = Buffer.from(data, "utf8");
			isText = true;
		} else if (Buffer.isBuffer(data)) {
			payload = data;
			isText = false;
		} else if (ArrayBuffer.isView(data)) {
			payload = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
			isText = false;
		} else {
			payload = Buffer.from(String(data), "utf8");
			isText = true;
		}

		this.sendFrame(isText ? 0x01 : 0x02, payload);
		return payload.length;
	}

	subscribe(room: string): void {
		let set = nodeTopics.get(room);
		if (!set) {
			set = new Set();
			nodeTopics.set(room, set);
		}
		set.add(this as unknown as NodeServerWebSocket<unknown>);
		this.topics.add(room);
	}

	unsubscribe(room: string): void {
		const set = nodeTopics.get(room);
		if (set) {
			set.delete(this as unknown as NodeServerWebSocket<unknown>);
			if (set.size === 0) nodeTopics.delete(room);
		}
		this.topics.delete(room);
	}

	isSubscribed(room: string): boolean {
		return this.topics.has(room);
	}

	publish(
		room: string,
		message: string | Buffer | Uint8Array,
		_compress?: boolean,
	): number {
		const set = nodeTopics.get(room);
		if (!set || set.size === 0) return 0;
		let sent = 0;
		for (const client of set) {
			if (client !== (this as unknown) && client.readyState === 1) {
				client.send(message);
				sent++;
			}
		}
		return sent;
	}

	ping(data: string | Buffer = ""): void {
		if (this.readyState !== 1) return;
		const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
		this.sendFrame(0x09, buf);
	}

	pong(data: string | Buffer = ""): void {
		if (this.readyState !== 1) return;
		const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
		this.sendFrame(0x0a, buf);
	}

	cork<T>(callback: (ws: this) => T): T {
		return callback(this);
	}

	close(code = 1000, reason = ""): void {
		if (this.readyState >= 2) return;
		this.readyState = 2;
		const reasonBuf = Buffer.from(reason, "utf8");
		const payload = Buffer.allocUnsafe(2 + reasonBuf.length);
		payload.writeUInt16BE(code, 0);
		reasonBuf.copy(payload, 2);
		this.sendFrame(0x08, payload);
		this.socket.end();
	}

	terminate(): void {
		this.readyState = 3;
		this.socket.destroy();
	}

	private sendFrame(opcode: number, payload: Buffer): void {
		if (this.socket.destroyed) return;
		const len = payload.length;
		let header: Buffer;

		if (len <= 125) {
			header = Buffer.allocUnsafe(2);
			header[0] = 0x80 | (opcode & 0x0f);
			header[1] = len;
		} else if (len <= 65535) {
			header = Buffer.allocUnsafe(4);
			header[0] = 0x80 | (opcode & 0x0f);
			header[1] = 126;
			header.writeUInt16BE(len, 2);
		} else {
			header = Buffer.allocUnsafe(10);
			header[0] = 0x80 | (opcode & 0x0f);
			header[1] = 127;
			header.writeBigUInt64BE(BigInt(len), 2);
		}

		this.socket.write(Buffer.concat([header, payload]));
	}

	private onData(chunk: Buffer): void {
		this.buffer =
			this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);

		while (this.buffer.length >= 2) {
			const byte0 = this.buffer[0]!;
			const byte1 = this.buffer[1]!;
			const fin = (byte0 & 0x80) !== 0;
			const opcode = byte0 & 0x0f;
			const masked = (byte1 & 0x80) !== 0;

			if (!masked) {
				this.close(1002, "Protocol error: unmasked client frame");
				this.onClose(1002, "Protocol error: unmasked client frame");
				return;
			}

			let payloadLen = byte1 & 0x7f;
			let offset = 2;

			if (payloadLen === 126) {
				if (this.buffer.length < 4) return;
				payloadLen = this.buffer.readUInt16BE(2);
				offset = 4;
			} else if (payloadLen === 127) {
				if (this.buffer.length < 10) return;
				const high = this.buffer.readUInt32BE(2);
				const low = this.buffer.readUInt32BE(6);
				payloadLen = high * 0x100000000 + low;
				offset = 10;
			}

			if (payloadLen > this.maxPayloadLength) {
				this.close(1009, "Message Too Big");
				return;
			}

			const maskLen = 4;
			const totalLen = offset + maskLen + payloadLen;
			if (this.buffer.length < totalLen) return;

			const maskKey = this.buffer.subarray(offset, offset + 4);
			const rawPayload = this.buffer.subarray(offset + maskLen, totalLen);
			const payload = Buffer.allocUnsafe(payloadLen);

			for (let i = 0; i < payloadLen; i++) {
				payload[i] = rawPayload[i]! ^ maskKey[i & 3]!;
			}

			this.buffer = this.buffer.subarray(totalLen);

			if (opcode === 0x08) {
				let code = 1000;
				let reason = "";
				if (payload.length >= 2) {
					code = payload.readUInt16BE(0);
					if (payload.length > 2) {
						reason = payload.subarray(2).toString("utf8");
					}
				}
				if (this.readyState === 1) {
					this.close(code, reason);
				}
				this.onClose(code, reason);
				return;
			}

			if (opcode === 0x09) {
				this.sendFrame(0x0a, payload);
				continue;
			}

			if (opcode === 0x0a) {
				continue;
			}

			if (!fin) {
				if (opcode !== 0x00) {
					this.fragmentOpcode = opcode;
					this.fragments = [payload];
				} else {
					this.fragments.push(payload);
				}
				continue;
			}

			let fullPayload = payload;
			let effectiveOpcode = opcode;
			if (opcode === 0x00) {
				this.fragments.push(payload);
				fullPayload = Buffer.concat(this.fragments);
				effectiveOpcode = this.fragmentOpcode;
				this.fragments = [];
				this.fragmentOpcode = 0;
			}

			const message =
				effectiveOpcode === 0x01 ? fullPayload.toString("utf8") : fullPayload;

			this.onMessage(message);
		}
	}

	dispatchOpen(): void {
		try {
			this.handlers?.open?.(this as unknown as ServerWebSocket<TData>);
			this.appHandlers?.open?.(this as unknown as ServerWebSocket<TData>);
		} catch (err) {
			this.onError(err);
		}
	}

	private onMessage(msg: string | Buffer): void {
		try {
			this.handlers?.message?.(this as unknown as ServerWebSocket<TData>, msg);
			this.appHandlers?.message?.(
				this as unknown as ServerWebSocket<TData>,
				msg,
			);
		} catch (err) {
			this.onError(err);
		}
	}

	private onClose(code: number, reason: string): void {
		if (this.readyState === 3) return;
		this.readyState = 3;

		for (const room of this.topics) {
			const set = nodeTopics.get(room);
			if (set) {
				set.delete(this as unknown as NodeServerWebSocket<unknown>);
				if (set.size === 0) nodeTopics.delete(room);
			}
		}
		this.topics.clear();

		try {
			this.handlers?.close?.(
				this as unknown as ServerWebSocket<TData>,
				code,
				reason,
			);
			this.appHandlers?.close?.(
				this as unknown as ServerWebSocket<TData>,
				code,
				reason,
			);
		} catch (err) {
			this.onError(err);
		}
	}

	private onError(err: unknown): void {
		try {
			if (this.handlers?.error) {
				this.handlers.error(this as unknown as ServerWebSocket<TData>, err);
			} else if (this.appHandlers?.error) {
				this.appHandlers.error(this as unknown as ServerWebSocket<TData>, err);
			}
		} catch (e) {
			console.error("Unhandled WebSocket error:", e);
		}
	}

	private onDrain(): void {
		try {
			this.handlers?.drain?.(this as unknown as ServerWebSocket<TData>);
			this.appHandlers?.drain?.(this as unknown as ServerWebSocket<TData>);
		} catch (err) {
			this.onError(err);
		}
	}
}

interface AppInternal {
	_options?: {
		port?: number;
		hostname?: string;
		websocket?: WebSocketOptions;
		tls?: {
			key?: unknown;
			cert?: unknown;
			ca?: unknown;
			passphrase?: string;
		};
	};
	nativeRoutes?: Array<{
		method: string;
		pattern: string;
		isDynamic: boolean;
		isContextFree: boolean;
		rawHandler?: () => unknown;
	}>;
	hasMiddlewares?: boolean;
	errorResolver?: unknown;
	handle: (req: Request, srv: Server<unknown>) => Promise<Response>;
}

function resolveTlsData(input: unknown): Buffer | string | undefined {
	if (!input) return undefined;
	if (Buffer.isBuffer(input) || typeof input === "string") {
		if (
			typeof input === "string" &&
			!input.includes("\n") &&
			(input.startsWith("./") || input.startsWith("/") || input.includes("."))
		) {
			try {
				if (fs.existsSync(input)) {
					return fs.readFileSync(input);
				}
			} catch {}
		}
		return input;
	}
	return undefined;
}

if (isNode) {
	if (typeof (globalThis as Record<string, unknown>).Bun === "undefined") {
		Object.defineProperty(globalThis, "Bun", {
			configurable: true,
			value: {
				env: process.env,
				CryptoHasher: class {
					private hmac: crypto.Hmac;
					constructor(_algo: string, secret: string) {
						this.hmac = crypto.createHmac("sha256", secret);
					}
					update(data: string) {
						this.hmac.update(data);
						return this;
					}
					digest(encoding: crypto.BinaryToTextEncoding) {
						return this.hmac.digest(encoding);
					}
				},
			},
		});
	}

	App.prototype.listen = function (this: unknown, port?: number) {
		const app = this as unknown as AppInternal;
		const rawPort = port ?? app._options?.port ?? 3000;
		const hostname = app._options?.hostname ?? "0.0.0.0";

		const activeSockets = new Set<Socket | Duplex>();
		let inFlightRequests = 0;
		let isDraining = false;
		const fastRoutes = new Map<string, () => unknown>();

		if (
			app.nativeRoutes &&
			!app.hasMiddlewares &&
			app.errorResolver === undefined
		) {
			for (const nr of app.nativeRoutes) {
				if (!nr.isDynamic && nr.isContextFree && nr.rawHandler) {
					fastRoutes.set(`${nr.method}:${nr.pattern}`, nr.rawHandler);
				}
			}
		}

		const requestListener = async (
			req: http.IncomingMessage,
			res: http.ServerResponse,
		) => {
			inFlightRequests++;
			if (isDraining) {
				res.setHeader("Connection", "close");
			}

			const onFinished = () => {
				inFlightRequests--;
				res.removeListener("finish", onFinished);
				res.removeListener("close", onFinished);
			};
			res.on("finish", onFinished);
			res.on("close", onFinished);

			const method = req.method || "GET";
			const rawUrl = req.url || "/";
			const pathname = scanPathname(rawUrl);

			const fastHandler = fastRoutes.get(`${method}:${pathname}`);
			if (fastHandler) {
				try {
					const val = fastHandler();
					if (typeof val === "string") {
						res.writeHead(200, {
							"content-type": "text/plain; charset=utf-8",
						});
						res.end(val);
						return;
					}
					if (
						typeof val === "object" &&
						val !== null &&
						!(val instanceof Response)
					) {
						res.writeHead(200, {
							"content-type": "application/json; charset=utf-8",
						});
						res.end(JSON.stringify(val));
						return;
					}
				} catch {}
			}

			try {
				const protocol = (req.socket as { encrypted?: boolean })?.encrypted
					? "https"
					: "http";
				const host = req.headers.host || "localhost";
				const url = `${protocol}://${host}${rawUrl}`;

				let reqBody: unknown;
				if (method !== "GET" && method !== "HEAD") {
					reqBody = Readable.toWeb(req);
				}

				const webReq = new Request(url, {
					method,
					headers: req.headers as never,
					body: reqBody as never,
					duplex: "half",
				} as never);

				const remoteIp = req.socket.remoteAddress || "";
				let upgraded = false;

				const serverShim = {
					requestIP: () => (remoteIp ? { address: remoteIp } : null),
					upgrade: (_request: Request, options?: { data?: unknown }) => {
						const secKey = req.headers["sec-websocket-key"];
						if (!secKey || typeof secKey !== "string") return false;

						const acceptKey = crypto
							.createHash("sha1")
							.update(secKey + WS_GUID)
							.digest("base64");

						req.socket.write(
							"HTTP/1.1 101 Switching Protocols\r\n" +
								"Upgrade: websocket\r\n" +
								"Connection: Upgrade\r\n" +
								`Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`,
						);

						const ws = new NodeServerWebSocket(
							req.socket,
							options?.data,
							app._options?.websocket,
						);

						upgraded = true;
						ws.dispatchOpen();
						return true;
					},
				};

				const webRes = await app.handle(
					webReq,
					serverShim as unknown as Server<unknown>,
				);

				if (upgraded) return;

				const resHeaders: Record<string, string | string[]> = {};
				webRes.headers.forEach((val, key) => {
					resHeaders[key] = val;
				});

				const getSetCookie = (
					webRes.headers as unknown as { getSetCookie?: () => string[] }
				).getSetCookie;
				if (typeof getSetCookie === "function") {
					const cookies = getSetCookie.call(webRes.headers);
					if (cookies && cookies.length > 0) {
						resHeaders["set-cookie"] = cookies;
					}
				}

				res.writeHead(
					webRes.status,
					webRes.statusText || undefined,
					resHeaders,
				);

				if (webRes.body) {
					const nodeStream = Readable.fromWeb(webRes.body as never);
					nodeStream.pipe(res);
				} else {
					res.end();
				}
			} catch (err) {
				console.error("Barq Node Adapter Error:", err);
				if (!res.headersSent) {
					res.writeHead(500, {
						"content-type": "application/json; charset=utf-8",
					});
					res.end('{"error":"Internal Server Error"}');
				}
			}
		};

		const tlsConfig = app._options?.tls;
		const hasTls = Boolean(tlsConfig && (tlsConfig.key || tlsConfig.cert));

		const server = hasTls
			? https.createServer(
					{
						key: resolveTlsData(tlsConfig?.key),
						cert: resolveTlsData(tlsConfig?.cert),
						ca: resolveTlsData(tlsConfig?.ca),
						passphrase: tlsConfig?.passphrase,
					},
					requestListener,
				)
			: http.createServer(requestListener);

		server.on("connection", (socket: Socket) => {
			activeSockets.add(socket);
			socket.on("close", () => activeSockets.delete(socket));
		});

		server.on(
			"upgrade",
			async (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
				activeSockets.add(socket);
				socket.on("close", () => activeSockets.delete(socket));

				const protocol = (socket as { encrypted?: boolean })?.encrypted
					? "https"
					: "http";
				const host = req.headers.host || "localhost";
				const fullUrl = `${protocol}://${host}${req.url || "/"}`;

				let upgradedSocket: NodeServerWebSocket | null = null;

				const serverShim = {
					requestIP: () => ({
						address:
							("remoteAddress" in socket
								? (socket as Socket).remoteAddress
								: "") || "",
					}),
					upgrade: (_request: Request, options?: { data?: unknown }) => {
						const secKey = req.headers["sec-websocket-key"];
						if (!secKey || typeof secKey !== "string") return false;

						const acceptKey = crypto
							.createHash("sha1")
							.update(secKey + WS_GUID)
							.digest("base64");

						socket.write(
							"HTTP/1.1 101 Switching Protocols\r\n" +
								"Upgrade: websocket\r\n" +
								"Connection: Upgrade\r\n" +
								`Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`,
						);

						const ws = new NodeServerWebSocket(
							socket,
							options?.data,
							app._options?.websocket,
						);
						upgradedSocket = ws;

						if (head && head.length > 0) {
							socket.unshift(head);
						}

						ws.dispatchOpen();
						return true;
					},
				};

				const webReq = new Request(fullUrl, {
					method: "GET",
					headers: req.headers as never,
				});

				try {
					const webRes = await app.handle(
						webReq,
						serverShim as unknown as Server<unknown>,
					);

					if (!upgradedSocket) {
						const status = webRes.status || 400;
						const statusText = webRes.statusText || "Bad Request";
						socket.write(
							`HTTP/1.1 ${status} ${statusText}\r\nConnection: close\r\n\r\n`,
						);
						socket.destroy();
					}
				} catch {
					if (!upgradedSocket) {
						socket.write(
							"HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n",
						);
						socket.destroy();
					}
				}
			},
		);

		server.listen(rawPort, hostname);

		const serverHandle = {
			get port() {
				const addr = server.address() as AddressInfo | null;
				return addr && typeof addr === "object" ? addr.port : rawPort;
			},
			hostname,
			stop: (hardTimeoutMs?: number | boolean): Promise<ShutdownResult> =>
				new Promise<ShutdownResult>((resolve) => {
					if (hardTimeoutMs === true) {
						for (const socket of activeSockets) {
							socket.destroy();
						}
						activeSockets.clear();
						server.close(() => resolve({ forced: true, pending: 0 }));
						return;
					}

					isDraining = true;
					const timeout =
						typeof hardTimeoutMs === "number" ? hardTimeoutMs : 5000;
					let timer: ReturnType<typeof setTimeout> | undefined;
					let resolved = false;

					const done = (forced: boolean) => {
						if (resolved) return;
						resolved = true;
						if (timer !== undefined) clearTimeout(timer);
						const pending = activeSockets.size;
						if (forced) {
							for (const socket of activeSockets) {
								socket.destroy();
							}
							activeSockets.clear();
						}
						server.close(() =>
							resolve({ forced, pending: forced ? pending : 0 }),
						);
					};

					timer = setTimeout(() => done(true), timeout);
					if (typeof timer.unref === "function") timer.unref();

					server.close(() => {
						if (!resolved) {
							resolved = true;
							if (timer !== undefined) clearTimeout(timer);
							resolve({ forced: false, pending: 0 });
						}
					});

					if (inFlightRequests === 0) {
						done(false);
					}
				}),
		};

		return serverHandle as unknown as Server<unknown>;
	};

	App.prototype.cluster = function (this: unknown, port?: number) {
		const app = this as unknown as AppInternal;
		const rawPort = port ?? app._options?.port ?? 3000;
		const hostname = app._options?.hostname ?? "0.0.0.0";
		const listenPort = rawPort === 0 ? 3000 : rawPort;

		if (cluster.isPrimary) {
			const numCPUs = cpus().length;
			const workers: ReturnType<typeof cluster.fork>[] = [];
			let crashCount = 0;
			let lastReset = Date.now();

			const spawnWorker = () => {
				const worker = cluster.fork({
					...process.env,
					PORT: String(listenPort),
				});

				worker.on("exit", () => {
					const now = Date.now();
					if (now - lastReset > 5000) {
						crashCount = 0;
						lastReset = now;
					}
					crashCount++;

					const idx = workers.indexOf(worker);
					if (idx !== -1) workers.splice(idx, 1);

					if (crashCount > 15) {
						console.error(
							"[Barq Cluster] Node workers restarting too fast. Throttling respawn.",
						);
						setTimeout(() => {
							workers.push(spawnWorker());
						}, 2000);
						return;
					}

					workers.push(spawnWorker());
				});

				return worker;
			};

			for (let i = 0; i < numCPUs; i++) {
				workers.push(spawnWorker());
			}

			return {
				port: listenPort,
				hostname,
				stop: async () => {
					for (const w of workers) {
						w.kill("SIGTERM");
					}
				},
			} as unknown as Server<unknown>;
		}

		return (
			this as unknown as { listen: (p?: number) => Server<unknown> }
		).listen(listenPort);
	};
}
