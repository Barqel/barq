import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
	output: "export",
	// every route is prerendered, so URLs are directory style (`/en/docs/`), which
	// static hosts serve from `out/<route>/index.html` without any rewrite rules
	trailingSlash: true,
	reactStrictMode: true,
	turbopack: {
		root: process.cwd(),
	},
};

export default withMDX(config);
