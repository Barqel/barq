import { i18n } from "@/lib/i18n";

export const dynamicParams = false;

export function generateStaticParams() {
	return i18n.languages.map((lang) => ({ lang }));
}

export default async function HomePage(props: PageProps<"/[lang]">) {
	const { lang } = await props.params;
	const href = `/${lang}/docs/`;

	// a meta refresh, because `redirect()` only resolves on the client and there
	// is no server left to redirect on once this is exported as static files
	return (
		<main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
			<meta httpEquiv="refresh" content={`0; url=${href}`} />
			<link rel="canonical" href={href} />
			<p>
				<a href={href}>Barq documentation</a>
			</p>
		</main>
	);
}
