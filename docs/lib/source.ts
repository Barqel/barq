import { llms, loader } from "fumadocs-core/source";
import { lucideIconsPlugin } from "fumadocs-core/source/lucide-icons";
import { metaSchema, pageSchema } from "fumadocs-core/source/schema";
import { defineDocs } from "fumadocs-mdx/macro";
import { i18n } from "./i18n";
import { docsRoute } from "./shared";

const docs = defineDocs({
	dir: "content/docs",
	docs: {
		schema: pageSchema,
		postprocess: {
			includeProcessedMarkdown: true,
		},
	},
	meta: {
		schema: metaSchema,
	},
});

// See https://fumadocs.dev/docs/headless/source-api for more info
export const source = loader({
	baseUrl: docsRoute,
	i18n,
	source: docs.toFumadocsSource(),
	plugins: [lucideIconsPlugin()],
});

export const docsLlms = llms(source, {
	renderPage: async (page) => {
		const document = docs.getPage(page.path);
		if (!document) throw new Error(`Missing MDX document for ${page.path}`);

		return `# ${document.title} (${page.url})

${await document.getText("processed")}`;
	},
});

export { docs };
