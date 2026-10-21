// A string that is already HTML — never escaped when rendered.
//
//   import { HtmlString } from "@barq";
//
//   const html = new HtmlString("<strong>Laravel</strong>");
//   html.toHtml(); // → "<strong>Laravel</strong>"
export class HtmlString {
	/** The raw HTML. */
	readonly html: string;

	constructor(html: string) {
		this.html = html;
	}

	/** The raw HTML — the method renderers call. */
	toHtml(): string {
		return this.html;
	}

	/** The raw HTML. */
	toString(): string {
		return this.html;
	}
}
