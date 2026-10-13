import { source } from "@/lib/source";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { baseOptions } from "@/lib/layout.shared";

export default async function Layout(props: LayoutProps<"/[lang]/docs">) {
	const { lang } = await props.params;

	return (
		<DocsLayout tree={source.getPageTree(lang)} {...baseOptions(lang)}>
			{props.children}
		</DocsLayout>
	);
}
