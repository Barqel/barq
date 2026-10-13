import type { ServerWebSocket } from "bun";

export interface PubSubInterface<TData = unknown> {
	subscribe(ws: ServerWebSocket<TData>, room: string): void;
	unsubscribe(ws: ServerWebSocket<TData>, room: string): void;
	unsubscribeAll(ws: ServerWebSocket<TData>): void;
	publish(
		room: string,
		message: string | Buffer | Uint8Array,
		compress?: boolean,
	): void;
	publishToAll(message: string | Buffer | Uint8Array, compress?: boolean): void;
	getRoomSize(room: string): number;
	getRooms(ws: ServerWebSocket<TData>): string[];
}
