// The template layer — `{{ name }}` placeholders filled from a plain
// object.
//
// Values are substituted, never the template itself: a template keeps its
// markup and only the data is escaped (HTML bodies) or inserted raw
// (subjects, plain text bodies).

import { MailTemplateError } from "./errors";
import type { MailTemplate } from "./types";

const PLACEHOLDER = /\{\{\s*([\w$]+(?:\.[\w$]+)*)\s*\}\}/g;

const HTML_ESCAPES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};

export interface RenderOptions {
	/** Escape the substituted values — for HTML bodies (default: false). */
	escape?: boolean;
	/** Throw when a placeholder has no value (default: false — it renders empty). */
	strict?: boolean;
}

/** Escapes the five characters that matter inside an HTML body. */
export function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/** Reads a dotted path (`user.name`) out of the data object. */
function resolvePath(data: Record<string, unknown>, path: string): unknown {
	if (!path.includes(".")) {
		return data[path];
	}

	let current: unknown = data;

	for (const segment of path.split(".")) {
		if (current === null || typeof current !== "object") {
			return undefined;
		}

		current = (current as Record<string, unknown>)[segment];
	}

	return current;
}

/**
 * Fills the placeholders of a template.
 *
 *   renderTemplate("Hi {{ name }}", { name: "Hassan" }); // → "Hi Hassan"
 */
export function renderTemplate(
	source: string,
	data: Record<string, unknown> = {},
	options: RenderOptions = {},
): string {
	return source.replace(PLACEHOLDER, (_match, path: string) => {
		const value = resolvePath(data, path);

		if (value === undefined || value === null) {
			if (options.strict) {
				throw new MailTemplateError(
					`The template placeholder "${path}" has no value`,
				);
			}

			return "";
		}

		const text = typeof value === "string" ? value : String(value);

		return options.escape ? escapeHtml(text) : text;
	});
}

/**
 * Renders a whole template — the subject raw, the HTML body escaped
 * unless the caller says otherwise.
 */
export function renderTemplateMessage(
	template: MailTemplate,
	data: Record<string, unknown> = {},
	options: RenderOptions = {},
): { subject: string; html: string; text?: string } {
	return {
		subject: renderTemplate(template.subject, data, options),
		html: renderTemplate(template.html, data, {
			...options,
			escape: options.escape ?? true,
		}),
		text:
			template.text === undefined
				? undefined
				: renderTemplate(template.text, data, options),
	};
}
