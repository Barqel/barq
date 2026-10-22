// A parsed URI — the pieces of a URL, read one by one.
//
//   import { Uri } from "@barq";
//
//   const uri = new Uri("https://example.com:8080/docs?page=2#intro");
//   uri.scheme();   // → "https"
//   uri.host();     // → "example.com"
//   uri.port();     // → 8080
//   uri.path();     // → "/docs"
//   uri.query();    // → "page=2"
//   uri.fragment(); // → "intro"
export class Uri {
	/** The URL this instance was built from. */
	readonly value: string;

	private readonly parsed: URL;

	constructor(value: string) {
		this.value = value;
		this.parsed = new URL(value);
	}

	/** The scheme, without the trailing colon (`https`). */
	scheme(): string {
		return this.parsed.protocol.replace(/:$/u, "");
	}

	/** The host, including the port when there is one. */
	host(): string {
		return this.parsed.host;
	}

	/** The host without the port. */
	hostname(): string {
		return this.parsed.hostname;
	}

	/** The port, or `null` when the URL uses the default one. */
	port(): number | null {
		return this.parsed.port === ""
			? null
			: Number.parseInt(this.parsed.port, 10);
	}

	/** The path (`/docs`). */
	path(): string {
		return this.parsed.pathname;
	}

	/** The query string, without the leading question mark. */
	query(): string {
		return this.parsed.search.replace(/^\?/u, "");
	}

	/** The fragment, without the leading hash. */
	fragment(): string {
		return this.parsed.hash.replace(/^#/u, "");
	}

	/** The user info, without the password. */
	user(): string {
		return this.parsed.username;
	}

	/** The password — empty when the URL carries none. */
	password(): string {
		return this.parsed.password;
	}

	/** The URL, unchanged. */
	toString(): string {
		return this.value;
	}
}
