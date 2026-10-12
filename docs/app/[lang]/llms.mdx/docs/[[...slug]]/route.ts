import { notFound } from "next/navigation";
import { getPageMarkdownUrl } from "@/lib/shared";
import { docsLlms, source } from "@/lib/source";

export const revalidate = false;

export async function GET(
	_req: Request,
	{ params }: RouteContext<"/[lang]/llms.mdx/docs/[[...slug]]">,
) {
	const { lang, slug } = await params;
	const page = source
		.getPages(lang)
		.find(
			(item) => getPageMarkdownUrl(item).segments.join("/") === slug?.join("/"),
		);
	if (!page) notFound();

	return new Response(await docsLlms.page(page), {
		headers: {
			"Content-Type": "text/markdown",
		},
	});
}

export function generateStaticParams() {
	return source.getPages().map((page) => ({
		lang: page.locale,
		slug: getPageMarkdownUrl(page).segments,
	}));
}
