import { createFromSource } from "fumadocs-core/search/server";
import { source } from "@/lib/source";

export const dynamic = "force-static";

/**
 * `output: 'export'` has no server to run a search endpoint, so the index is
 * prerendered once and fetched as a plain asset by the client.
 */
export async function GET() {
	return new Response(JSON.stringify(await createFromSource(source).export()), {
		headers: { "content-type": "application/json" },
	});
}
