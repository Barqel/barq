// Markdown — GitHub flavored Markdown to HTML, without a dependency.
//
//   import { markdown } from "@barq";
//
//   markdown("# Title");            // → "<h1>Title</h1>"
//   markdown("**bold**");           // → "<p><strong>bold</strong></p>"
//   inlineMarkdown("**bold**");     // → "<strong>bold</strong>"
//
// Raw HTML is the usual Markdown XSS vector, so the same security options
// Laravel exposes are supported:
//
//   markdown("<script>alert(1)</script>", { html_input: "strip" });
//
// Supported syntax: ATX headings, fenced code blocks, blockquotes, ordered
// and unordered lists, thematic breaks, paragraphs, emphasis, strong
// emphasis, strikethrough, inline code, links, images, autolinks and hard
// line breaks.
export interface MarkdownOptions {
	/** What to do with raw HTML: "allow" (default), "escape" or "strip". */
	html_input?: "allow" | "escape" | "strip";
	/** Whether `javascript:` and `data:` links are allowed — default false. */
	allow_unsafe_links?: boolean;
}

const SAFE_PROTOCOLS = ["http:", "https:", "mailto:", "tel:", "ftp:"];

/** Renders a Markdown document as HTML. */
export function markdown(value: string, options: MarkdownOptions = {}): string {
	const normalized = value.replace(/\r\n?/gu, "\n");
	const blocks = splitBlocks(normalized);

	return blocks.map((block) => renderBlock(block, options)).join("\n");
}

/** Renders Markdown as inline HTML — no block-level wrapper. */
export function inlineMarkdown(
	value: string,
	options: MarkdownOptions = {},
): string {
	return renderInline(value.replace(/\r\n?/gu, "\n"), options);
}

// --- blocks --------------------------------------------------------------------

function splitBlocks(source: string): string[] {
	const blocks: string[] = [];
	const lines = source.split("\n");
	let current: string[] = [];
	let fence: string | null = null;

	for (const line of lines) {
		const fenceMatch = /^```+\s*([\w-]*)\s*$/u.exec(line);

		if (fenceMatch !== null) {
			if (fence === null) {
				fence = fenceMatch[1] ?? "";
				current.push(line);
			} else {
				current.push(line);
				blocks.push(current.join("\n"));
				current = [];
				fence = null;
			}

			continue;
		}

		if (fence === null && line.trim() === "") {
			if (current.length > 0) {
				blocks.push(current.join("\n"));
				current = [];
			}

			continue;
		}

		current.push(line);
	}

	if (current.length > 0) {
		blocks.push(current.join("\n"));
	}

	return blocks;
}

function renderBlock(block: string, options: MarkdownOptions): string {
	const trimmed = block.trim();

	// Fenced code block.
	const fence = /^```+\s*([\w-]*)\s*\n([\s\S]*?)\n?```+\s*$/u.exec(trimmed);

	if (fence !== null) {
		const language = fence[1] ?? "";
		const code = fence[2] ?? "";
		const attribute =
			language === "" ? "" : ` class="language-${escapeHtml(language)}"`;

		return `<pre><code${attribute}>${escapeHtml(code)}</code></pre>`;
	}

	// Thematic break.
	if (/^(?:\*\s*){3,}$|^(?:-\s*){3,}$|^(?:_\s*){3,}$/u.test(trimmed)) {
		return "<hr />";
	}

	// ATX heading.
	const heading = /^(#{1,6})\s+(.*?)\s*#*$/u.exec(trimmed);

	if (heading !== null) {
		const level = heading[1]!.length;

		return `<h${level}>${renderInline(heading[2]!, options)}</h${level}>`;
	}

	// Blockquote.
	if (trimmed.startsWith(">")) {
		const inner = trimmed
			.split("\n")
			.map((line) => line.replace(/^>\s?/u, ""))
			.join("\n");

		return `<blockquote>\n${markdown(inner, options)}\n</blockquote>`;
	}

	// Lists.
	const list = renderList(trimmed, options);

	if (list !== null) {
		return list;
	}

	// Paragraph.
	return `<p>${renderInline(trimmed, options)}</p>`;
}

function renderList(block: string, options: MarkdownOptions): string | null {
	const lines = block.split("\n");
	const unordered = /^\s*[-*+]\s+/u.test(lines[0] ?? "");
	const ordered = /^\s*\d+[.)]\s+/u.test(lines[0] ?? "");

	if (!unordered && !ordered) {
		return null;
	}

	const tag = unordered ? "ul" : "ol";
	const items: string[] = [];
	let current: string[] = [];

	for (const line of lines) {
		const isItem = unordered
			? /^\s*[-*+]\s+/u.test(line)
			: /^\s*\d+[.)]\s+/u.test(line);

		if (isItem) {
			if (current.length > 0) {
				items.push(current.join("\n"));
			}

			current = [line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/u, "")];
			continue;
		}

		if (current.length === 0) {
			return null;
		}

		current.push(line.replace(/^\s+/u, ""));
	}

	if (current.length > 0) {
		items.push(current.join("\n"));
	}

	const rendered = items
		.map((item) => `<li>${renderInline(item.trim(), options)}</li>`)
		.join("\n");

	return `<${tag}>\n${rendered}\n</${tag}>`;
}

// --- inline --------------------------------------------------------------------

function renderInline(value: string, options: MarkdownOptions): string {
	let result = "";
	let index = 0;

	while (index < value.length) {
		const character = value[index]!;

		// Inline code.
		if (character === "`") {
			const match = /^(`+)([\s\S]*?)\1/u.exec(value.slice(index));

			if (match !== null) {
				result += `<code>${escapeHtml(match[2]!.trim())}</code>`;
				index += match[0].length;
				continue;
			}
		}

		// Images and links.
		if (character === "!" || character === "[") {
			const match = /(!?)\[([^\]]*)\]\(([^)\s]*)(?:\s+"([^"]*)")?\)/u.exec(
				value.slice(index),
			);

			if (match !== null) {
				const isImage = match[1] === "!";
				const url = match[3] ?? "";
				const safe = safeUrl(url, options);

				if (safe === null) {
					result += escapeHtml(match[0]);
				} else if (isImage) {
					const title = match[4] ? ` title="${escapeHtml(match[4])}"` : "";
					result += `<img src="${escapeHtml(safe)}" alt="${escapeHtml(match[2] ?? "")}"${title} />`;
				} else {
					const title = match[4] ? ` title="${escapeHtml(match[4])}"` : "";
					result += `<a href="${escapeHtml(safe)}"${title}>${renderInline(match[2] ?? "", options)}</a>`;
				}

				index += match[0].length;
				continue;
			}
		}

		// Strong emphasis.
		if (character === "*" || character === "_") {
			const double = value.slice(index, index + 2);

			if (double === "**" || double === "__") {
				const end = value.indexOf(double, index + 2);

				if (end !== -1) {
					const inner = value.slice(index + 2, end);

					result += `<strong>${renderInline(inner, options)}</strong>`;
					index = end + 2;
					continue;
				}
			}

			const end = findClosing(value, index, character);

			if (end !== -1) {
				const inner = value.slice(index + 1, end);

				result += `<em>${renderInline(inner, options)}</em>`;
				index = end + 1;
				continue;
			}
		}

		// Strikethrough.
		if (character === "~") {
			const match = /^~~([\s\S]+?)~~/u.exec(value.slice(index));

			if (match !== null) {
				result += `<del>${renderInline(match[1]!, options)}</del>`;
				index += match[0].length;
				continue;
			}
		}

		// Autolink.
		if (character === "<") {
			const match = /^<((?:https?|mailto):[^\s>]+)>/u.exec(value.slice(index));

			if (match !== null) {
				const url = match[1]!;
				const safe = safeUrl(url, options);

				result +=
					safe === null
						? escapeHtml(match[0])
						: `<a href="${escapeHtml(safe)}">${escapeHtml(url)}</a>`;
				index += match[0].length;
				continue;
			}
		}

		// Raw HTML.
		if (character === "<") {
			const match = /^<\/?[a-zA-Z][^>]*>/u.exec(value.slice(index));

			if (match !== null) {
				result += handleRawHtml(match[0], options);
				index += match[0].length;
				continue;
			}
		}

		// Hard line break (two trailing spaces).
		if (
			character === " " &&
			value[index + 1] === " " &&
			value[index + 2] === "\n"
		) {
			result += "<br />\n";
			index += 3;
			continue;
		}

		result += escapeHtml(character);
		index += 1;
	}

	return result;
}

/** Index of the closing emphasis character, skipping escaped ones. */
function findClosing(value: string, start: number, character: string): number {
	for (let index = start + 1; index < value.length; index += 1) {
		if (value[index] === "\\") {
			index += 1;
			continue;
		}

		if (value[index] === character && value[index - 1] !== " ") {
			return index;
		}
	}

	return -1;
}

function handleRawHtml(tag: string, options: MarkdownOptions): string {
	switch (options.html_input) {
		case "strip":
			return "";
		case "escape":
			return escapeHtml(tag);
		default:
			return tag;
	}
}

function safeUrl(url: string, options: MarkdownOptions): string | null {
	if (url === "") {
		return "";
	}

	// Relative URLs and fragments are always safe.
	if (/^[#/?]/u.test(url) || !/^[a-z][a-z0-9+.-]*:/iu.test(url)) {
		return url;
	}

	const protocol = url.slice(0, url.indexOf(":") + 1).toLowerCase();

	if (SAFE_PROTOCOLS.includes(protocol)) {
		return url;
	}

	return options.allow_unsafe_links === true ? url : null;
}

/** Escapes the HTML special characters. */
export function escapeHtml(value: string): string {
	return value
		.replace(/&/gu, "&amp;")
		.replace(/</gu, "&lt;")
		.replace(/>/gu, "&gt;")
		.replace(/"/gu, "&quot;")
		.replace(/'/gu, "&#039;");
}
