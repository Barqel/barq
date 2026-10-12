import type { SseMessage } from "./types";

const ENCODER = new TextEncoder();

export function formatSseChunk(msg: SseMessage): Uint8Array {
	let out = "";

	if (msg.comment !== undefined) {
		out += `: ${msg.comment}\n`;
	}

	if (msg.id !== undefined) {
		out += `id: ${msg.id}\n`;
	}

	if (msg.event !== undefined) {
		out += `event: ${msg.event}\n`;
	}

	if (msg.retry !== undefined) {
		out += `retry: ${msg.retry}\n`;
	}

	if (msg.data !== undefined) {
		const raw =
			typeof msg.data === "object" && msg.data !== null
				? JSON.stringify(msg.data)
				: String(msg.data);

		const lines = raw.split("\n");
		for (const line of lines) {
			out += `data: ${line}\n`;
		}
	}

	out += "\n";
	return ENCODER.encode(out);
}

export function formatCommentChunk(comment: string): Uint8Array {
	return ENCODER.encode(`: ${comment}\n\n`);
}
