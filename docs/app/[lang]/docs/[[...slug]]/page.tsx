import { docs, source } from "@/lib/source";
import {
	DocsBody,
	DocsDescription,
	DocsPage,
	DocsTitle,
	MarkdownCopyButton,
	ViewOptionsPopover,
} from "fumadocs-ui/layouts/docs/page";
import { notFound } from "next/navigation";
import { getMDXComponents } from "@/components/mdx";
import type { Metadata } from "next";
import { createRelativeLink } from "fumadocs-ui/mdx";
import { getPageMarkdownUrl, gitConfig } from "@/lib/shared";

export default async function Page(
	props: PageProps<"/[lang]/docs/[[...slug]]">,
) {
	const params = await props.params;
	const page = source.getPage(params.slug, params.lang);
	if (!page) notFound();
	const document = docs.getPage(page.path);
	if (!document) notFound();

	const MDX = document.body;
	const markdownUrl = getPageMarkdownUrl(page).url;

	return (
		<DocsPage toc={document.toc} full={document.full}>
			<DocsTitle>{document.title}</DocsTitle>
			<DocsDescription className="mb-0">{document.description}</DocsDescription>
			<div className="flex flex-row gap-2 items-center border-b pb-6">
				<MarkdownCopyButton markdownUrl={markdownUrl} />
				<ViewOptionsPopover
					markdownUrl={markdownUrl}
					githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/content/docs/${page.path}`}
				/>
			</div>
			<DocsBody>
				<MDX
					components={getMDXComponents({
						// this allows you to link to other pages with relative file paths
						a: createRelativeLink(source, page),
					})}
				/>
			</DocsBody>
		</DocsPage>
	);
}

export const dynamicParams = false;

export function generateStaticParams() {
	return source.generateParams("slug", "lang");
}

export async function generateMetadata(
	props: PageProps<"/[lang]/docs/[[...slug]]">,
): Promise<Metadata> {
	const params = await props.params;
	const page = source.getPage(params.slug, params.lang);
	const document = page && docs.getPage(page.path);

	if (!document) return {};

	return {
		title: document.title,
		description: document.description,
	};
}
