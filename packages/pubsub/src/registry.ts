import type { ServerWebSocket } from "bun";
import type { PubSubInterface } from "./types";

export class PubSubRegistry<TData = unknown> implements PubSubInterface<TData> {
	private rooms = new Map<string, Set<ServerWebSocket<TData>>>();
	private socketRooms = new Map<ServerWebSocket<TData>, Set<string>>();
	private allSockets = new Set<ServerWebSocket<TData>>();

	subscribe(ws: ServerWebSocket<TData>, room: string): void {
		if (typeof ws.subscribe === "function") {
			ws.subscribe(room);
		}

		let roomSockets = this.rooms.get(room);
		if (!roomSockets) {
			roomSockets = new Set();
			this.rooms.set(room, roomSockets);
		}
		roomSockets.add(ws);

		let sRooms = this.socketRooms.get(ws);
		if (!sRooms) {
			sRooms = new Set();
			this.socketRooms.set(ws, sRooms);
		}
		sRooms.add(room);
		this.allSockets.add(ws);
	}

	unsubscribe(ws: ServerWebSocket<TData>, room: string): void {
		if (typeof ws.unsubscribe === "function") {
			ws.unsubscribe(room);
		}

		const roomSockets = this.rooms.get(room);
		if (roomSockets) {
			roomSockets.delete(ws);
			if (roomSockets.size === 0) this.rooms.delete(room);
		}

		const sRooms = this.socketRooms.get(ws);
		if (sRooms) {
			sRooms.delete(room);
			if (sRooms.size === 0) this.socketRooms.delete(ws);
		}
	}

	unsubscribeAll(ws: ServerWebSocket<TData>): void {
		const sRooms = this.socketRooms.get(ws);
		if (sRooms) {
			for (const room of sRooms) {
				if (typeof ws.unsubscribe === "function") {
					ws.unsubscribe(room);
				}
				const roomSockets = this.rooms.get(room);
				if (roomSockets) {
					roomSockets.delete(ws);
					if (roomSockets.size === 0) this.rooms.delete(room);
				}
			}
			this.socketRooms.delete(ws);
		}
		this.allSockets.delete(ws);
	}

	publish(
		room: string,
		message: string | Buffer | Uint8Array,
		compress?: boolean,
	): void {
		const roomSockets = this.rooms.get(room);
		if (!roomSockets || roomSockets.size === 0) return;

		const firstSocket = roomSockets.values().next().value;
		if (firstSocket && typeof firstSocket.publish === "function") {
			firstSocket.publish(room, message, compress);
			return;
		}

		for (const ws of roomSockets) {
			if (ws.readyState === 1) {
				ws.send(message, compress);
			}
		}
	}

	publishToAll(
		message: string | Buffer | Uint8Array,
		compress?: boolean,
	): void {
		for (const ws of this.allSockets) {
			if (ws.readyState === 1) {
				ws.send(message, compress);
			}
		}
	}

	getRoomSize(room: string): number {
		return this.rooms.get(room)?.size ?? 0;
	}

	getRooms(ws: ServerWebSocket<TData>): string[] {
		const sRooms = this.socketRooms.get(ws);
		return sRooms ? Array.from(sRooms) : [];
	}
}
