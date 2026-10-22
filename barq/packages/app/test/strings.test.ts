import { describe, expect, it } from "bun:test";
import { Pluralizer, Str, Stringable, str, Uri } from "../src/index";

describe("Str — slicing", () => {
	it("returns everything after a value", () => {
		expect(Str.after("This is my name", "This is")).toBe(" my name");
		expect(Str.after("This is my name", "nope")).toBe("This is my name");
	});

	it("returns everything after the last value", () => {
		expect(Str.afterLast("App\\Http\\Controllers\\Controller", "\\")).toBe(
			"Controller",
		);
	});

	it("returns everything before a value", () => {
		expect(Str.before("This is my name", "my name")).toBe("This is ");
		expect(Str.beforeLast("This is my name", "is")).toBe("This ");
	});

	it("returns the portion between two values", () => {
		expect(Str.between("This is my name", "This", "name")).toBe(" is my ");
	});

	it("returns the smallest portion between two values", () => {
		expect(Str.betweenFirst("[a] bc [d]", "[", "]")).toBe("a");
	});

	it("returns a character by index", () => {
		expect(Str.charAt("This is my name.", 6)).toBe("s");
		expect(Str.charAt("This is my name.", 99)).toBeNull();
	});

	it("takes the first characters", () => {
		expect(Str.take("Build something amazing!", 5)).toBe("Build");
	});

	it("slices the string", () => {
		expect(Str.substr("The Laravel Framework", 4, 7)).toBe("Laravel");
		expect(Str.substr("The Laravel Framework", 4)).toBe("Laravel Framework");
	});

	it("replaces text inside a portion of the string", () => {
		expect(Str.substrReplace("1300", ":", 2)).toBe("13:");
		expect(Str.substrReplace("1300", ":", 2, 0)).toBe("13:00");
	});

	it("counts the occurrences of a value", () => {
		expect(
			Str.substrCount(
				"If you like ice cream, you will like snow cones.",
				"like",
			),
		).toBe(2);
	});
});

describe("Str — searching", () => {
	it("checks the content", () => {
		expect(Str.contains("This is my name", "my")).toBe(true);
		expect(Str.contains("This is my name", ["my", "foo"])).toBe(true);
		expect(Str.contains("This is my name", "MY", true)).toBe(true);
		expect(Str.contains("This is my name", "MY")).toBe(false);
	});

	it("checks that every value is present", () => {
		expect(Str.containsAll("This is my name", ["my", "name"])).toBe(true);
		expect(Str.containsAll("This is my name", ["my", "foo"])).toBe(false);
	});

	it("checks the beginning and the end", () => {
		expect(Str.startsWith("This is my name", "This")).toBe(true);
		expect(Str.startsWith("This is my name", ["This", "That"])).toBe(true);
		expect(Str.endsWith("This is my name", ["name", "foo"])).toBe(true);
		expect(Str.endsWith("This is my name", ["this", "foo"])).toBe(false);
		expect(Str.doesntStartWith("This is my name", "That")).toBe(true);
		expect(Str.doesntEndWith("This is my name", "dog")).toBe(true);
	});

	it("matches wildcard patterns", () => {
		expect(Str.is("foo*", "foobar")).toBe(true);
		expect(Str.is("baz*", "foobar")).toBe(false);
		expect(Str.is("*.jpg", "photo.JPG", true)).toBe(true);
	});

	it("matches regular expressions", () => {
		expect(Str.isMatch("/foo (.*)/", "foo bar")).toBe(true);
		expect(Str.match("/bar/", "foo bar")).toBe("bar");
		expect(Str.matchAll("/bar/", "bar foo bar").all()).toEqual(["bar", "bar"]);
	});

	it("finds the position of a value", () => {
		expect(Str.position("Hello, World!", "Hello")).toBe(0);
		expect(Str.position("Hello, World!", "W")).toBe(7);
		expect(Str.position("Hello, World!", "nope")).toBeNull();
	});
});

describe("Str — replacing", () => {
	it("replaces a value", () => {
		expect(Str.replace("Laravel 11.x", "11.x", "12.x")).toBe("Laravel 12.x");
		expect(
			Str.replace("PHP Framework for Web Artisans", "php", "Laravel", false),
		).toBe("Laravel Framework for Web Artisans");
	});

	it("replaces the first and the last occurrence", () => {
		const value = "the quick brown fox jumps over the lazy dog";

		expect(Str.replaceFirst("the", "a", value)).toBe(
			"a quick brown fox jumps over the lazy dog",
		);
		expect(Str.replaceLast("the", "a", value)).toBe(
			"the quick brown fox jumps over a lazy dog",
		);
	});

	it("replaces every occurrence in order", () => {
		expect(
			Str.replaceArray(
				"?",
				["8:30", "9:00"],
				"The event will take place between ? and ?",
			),
		).toBe("The event will take place between 8:30 and 9:00");
	});

	it("replaces only at the start or at the end", () => {
		expect(Str.replaceStart("Hello", "Laravel", "Hello World")).toBe(
			"Laravel World",
		);
		expect(Str.replaceStart("World", "Laravel", "Hello World")).toBe(
			"Hello World",
		);
		expect(Str.replaceEnd("World", "Laravel", "Hello World")).toBe(
			"Hello Laravel",
		);
	});

	it("replaces the matches of a pattern", () => {
		expect(
			Str.replaceMatches("/[^A-Za-z0-9]++/", "", "(+1) 501-555-1000"),
		).toBe("15015551000");
		expect(
			Str.replaceMatches("/\\d/", (matches) => `[${matches[0]}]`, "123"),
		).toBe("[1][2][3]");
	});

	it("removes values", () => {
		expect(
			Str.remove("Peter Piper picked a peck of pickled peppers.", "e"),
		).toBe("Ptr Pipr pickd a pck of pickld ppprs.");
	});

	it("swaps several values at once", () => {
		expect(
			Str.swap({ Tacos: "Burritos", great: "fantastic" }, "Tacos are great!"),
		).toBe("Burritos are fantastic!");
	});

	it("chops the start and the end", () => {
		expect(Str.chopStart("https://laravel.com", "https://")).toBe(
			"laravel.com",
		);
		expect(Str.chopStart("http://laravel.com", ["https://", "http://"])).toBe(
			"laravel.com",
		);
		expect(Str.chopEnd("app/Models/Photograph.php", ".php")).toBe(
			"app/Models/Photograph",
		);
	});
});

describe("Str — trimming and wrapping", () => {
	it("trims the whitespace", () => {
		expect(Str.trim(" foo bar ")).toBe("foo bar");
		expect(Str.ltrim("  foo bar  ")).toBe("foo bar  ");
		expect(Str.rtrim("  foo bar  ")).toBe("  foo bar");
		expect(Str.trim("/Laravel/", "/")).toBe("Laravel");
	});

	it("squishes the whitespace", () => {
		expect(Str.squish("    laravel    framework    ")).toBe(
			"laravel framework",
		);
	});

	it("deduplicates characters", () => {
		expect(Str.deduplicate("The   Laravel   Framework")).toBe(
			"The Laravel Framework",
		);
		expect(Str.deduplicate("The---Laravel---Framework", "-")).toBe(
			"The-Laravel-Framework",
		);
	});

	it("adds a prefix or a suffix", () => {
		expect(Str.start("this/string", "/")).toBe("/this/string");
		expect(Str.start("/this/string", "/")).toBe("/this/string");
		expect(Str.finish("this/string", "/")).toBe("this/string/");
	});

	it("unwraps and wraps", () => {
		expect(Str.unwrap("-Laravel-", "-")).toBe("Laravel");
		expect(Str.wrap("Laravel", '"')).toBe('"Laravel"');
		expect(Str.wrap("is", "This ", " Laravel!")).toBe("This is Laravel!");
	});
});

describe("Str — case", () => {
	it("converts the case", () => {
		expect(Str.lower("LARAVEL")).toBe("laravel");
		expect(Str.upper("laravel")).toBe("LARAVEL");
		expect(Str.ucfirst("foo bar")).toBe("Foo bar");
		expect(Str.lcfirst("Foo Bar")).toBe("foo Bar");
		expect(Str.ucwords("laravel framework")).toBe("Laravel Framework");
		expect(Str.ucsplit("FooBar")).toEqual(["Foo", "Bar"]);
	});

	it("converts between naming conventions", () => {
		expect(Str.camel("foo_bar")).toBe("fooBar");
		expect(Str.studly("foo_bar")).toBe("FooBar");
		expect(Str.snake("fooBar")).toBe("foo_bar");
		expect(Str.kebab("fooBar")).toBe("foo-bar");
		expect(Str.headline("steve_jobs")).toBe("Steve Jobs");
		expect(Str.headline("EmailNotificationSent")).toBe(
			"Email Notification Sent",
		);
		expect(Str.title("a nice title uses the correct case")).toBe(
			"A Nice Title Uses The Correct Case",
		);
		expect(Str.apa("Creating A Project")).toBe("Creating a Project");
	});
});

describe("Str — measures", () => {
	it("counts the characters and the words", () => {
		expect(Str.length("Laravel")).toBe(7);
		expect(Str.wordCount("Hello, world!")).toBe(2);
	});

	it("limits the words", () => {
		expect(
			Str.words("Perfectly balanced, as all things should be.", 3, " >>>"),
		).toBe("Perfectly balanced, as >>>");
	});

	it("truncates the string", () => {
		expect(Str.limit("The quick brown fox jumps over the lazy dog", 20)).toBe(
			"The quick brown fox...",
		);
		expect(Str.limit("The quick brown fox", 12, "...", true)).toBe(
			"The quick...",
		);
	});

	it("extracts an excerpt", () => {
		expect(Str.excerpt("This is my name", "my", { radius: 3 })).toBe(
			"...is my na...",
		);
		expect(
			Str.excerpt("This is my name", "name", { radius: 3, omission: "(...) " }),
		).toBe("(...) my name");
	});

	it("masks a portion of the string", () => {
		expect(Str.mask("taylor@example.com", "*", 3)).toBe("tay***************");
		expect(Str.mask("taylor@example.com", "*", -15, 3)).toBe(
			"tay***@example.com",
		);
	});

	it("pads the string", () => {
		expect(Str.padBoth("James", 10, "_")).toBe("__James___");
		expect(Str.padLeft("James", 10, "-=")).toBe("-=-=-James");
		expect(Str.padRight("James", 10, "-")).toBe("James-----");
	});

	it("wraps the text at a width", () => {
		expect(
			Str.wordWrap("The quick brown fox jumped over the lazy dog.", 20, "|"),
		).toBe("The quick brown fox|jumped over the lazy|dog.");
	});
});

describe("Str — encodings and identifiers", () => {
	it("encodes and decodes base64", () => {
		expect(Str.toBase64("Laravel")).toBe("TGFyYXZlbA==");
		expect(Str.fromBase64("TGFyYXZlbA==")).toBe("Laravel");
	});

	it("transliterates to ASCII", () => {
		expect(Str.ascii("û")).toBe("u");
		expect(Str.transliterate("مُحَمَّد")).toBe("mhmd");
	});

	it("builds a slug", () => {
		expect(Str.slug("Laravel 5 Framework")).toBe("laravel-5-framework");
	});

	it("checks the format of a value", () => {
		expect(Str.isAscii("Taylor")).toBe(true);
		expect(Str.isAscii("ü")).toBe(false);
		expect(Str.isJson("[1,2,3]")).toBe(true);
		expect(Str.isJson('{first: "John"}')).toBe(false);
		expect(Str.isUrl("http://example.com")).toBe(true);
		expect(Str.isUrl("laravel")).toBe(false);
		expect(Str.isUuid("a0a2a2d2-0b87-4a18-83f2-2529882be2de")).toBe(true);
		expect(Str.isUuid("a0a2a2d2-0b87-4a18-83f2-2529882be2de", 4)).toBe(true);
		expect(Str.isUuid("a0a2a2d2-0b87-4a18-83f2-2529882be2de", 1)).toBe(false);
		expect(Str.isUlid("01gd6r360bp37zj17nxb55yv40")).toBe(true);
		expect(Str.isUlid("laravel")).toBe(false);
	});

	it("generates identifiers", () => {
		expect(Str.isUuid(Str.uuid())).toBe(true);
		expect(Str.isUuid(Str.uuid7(), 7)).toBe(true);
		expect(Str.isUlid(Str.ulid())).toBe(true);
		expect(Str.isUuid(Str.orderedUuid())).toBe(true);
	});

	it("generates random values", () => {
		expect(Str.random(40)).toHaveLength(40);
		expect(Str.password(12)).toHaveLength(12);
		expect(Str.password()).toHaveLength(32);
	});

	it("reads the class name", () => {
		expect(Str.classBasename("Foo\\Bar\\Baz")).toBe("Baz");
	});

	it("escapes HTML", () => {
		expect(Str.escapeHtml("<html>foo</html>")).toBe(
			"&lt;html&gt;foo&lt;/html&gt;",
		);
	});
});

describe("Str — pluralization", () => {
	it("pluralizes and singularizes", () => {
		expect(Str.plural("car")).toBe("cars");
		expect(Str.plural("child")).toBe("children");
		expect(Str.plural("child", 1)).toBe("child");
		expect(Str.singular("cars")).toBe("car");
		expect(Str.singular("children")).toBe("child");
	});

	it("counts the word", () => {
		expect(Str.counted("order", 1)).toBe("1 order");
		expect(Str.counted("order", 1000)).toBe("1,000 orders");
		expect(Str.plural("car", 1000, true)).toBe("1,000 cars");
	});

	it("pluralizes studly words", () => {
		expect(Str.pluralStudly("VerifiedHuman")).toBe("VerifiedHumans");
		expect(Str.pluralStudly("UserFeedback")).toBe("UserFeedbacks");
	});

	it("exposes the pluralizer", () => {
		expect(Pluralizer.plural("box")).toBe("boxes");
		expect(Pluralizer.singular("boxes")).toBe("box");
	});
});

describe("Str — markdown", () => {
	it("renders a document", () => {
		expect(Str.markdown("# Laravel")).toContain("<h1>Laravel</h1>");
		expect(Str.markdown("**bold**")).toContain("<strong>bold</strong>");
	});

	it("renders inline markdown", () => {
		expect(Str.inlineMarkdown("**Laravel**")).toBe("<strong>Laravel</strong>");
	});

	it("strips raw HTML when asked to", () => {
		const html = Str.inlineMarkdown(
			'Inject: <script>alert("Hello XSS!");</script>',
			{ html_input: "strip" },
		);

		expect(html).not.toContain("<script>");
	});
});

describe("Stringable", () => {
	it("chains the operations", () => {
		expect(str("foo_bar").camel().upper().toString()).toBe("FOOBAR");
		expect(Str.of("  laravel  ").trim().squish().toString()).toBe("laravel");
	});

	it("appends and prepends", () => {
		expect(str("Taylor").append(" Otwell").toString()).toBe("Taylor Otwell");
		expect(str("Framework").prepend("Laravel ").toString()).toBe(
			"Laravel Framework",
		);
	});

	it("taps without changing the value", () => {
		let seen = "";

		const result = str("Laravel")
			.append(" Framework")
			.tap((value) => {
				seen = value.toString();
			})
			.upper();

		expect(seen).toBe("Laravel Framework");
		expect(result.toString()).toBe("LARAVEL FRAMEWORK");
	});

	it("pipes into a callback", () => {
		expect(str("Laravel").pipe((value) => value.length())).toBe(7);
	});

	it("runs the conditional helpers", () => {
		expect(
			str("tony stark")
				.whenContains("tony", (value) => value.title())
				.toString(),
		).toBe("Tony Stark");
		expect(
			str("  ")
				.trim()
				.whenEmpty((value) => value.prepend("Laravel"))
				.toString(),
		).toBe("Laravel");
		expect(
			str("Framework")
				.whenNotEmpty((value) => value.prepend("Laravel "))
				.toString(),
		).toBe("Laravel Framework");
		expect(
			str("laravel")
				.whenIs("lar*", (value) => value.title())
				.toString(),
		).toBe("Laravel");
	});

	it("checks the value", () => {
		expect(str("Laravel").isEmpty()).toBe(false);
		expect(str("").isEmpty()).toBe(true);
		expect(str("Laravel").isNotEmpty()).toBe(true);
		expect(str("Laravel").exactly("Laravel")).toBe(true);
		expect(str("Laravel").length()).toBe(7);
	});

	it("splits and explodes", () => {
		expect(str("foo bar baz").explode(" ").all()).toEqual([
			"foo",
			"bar",
			"baz",
		]);
		expect(str("one, two, three").split("/[\\s,]+/").all()).toEqual([
			"one",
			"two",
			"three",
		]);
	});

	it("hashes, encrypts and decodes", () => {
		expect(str("secret").hash("sha256")).toHaveLength(64);
		expect(str("secret").toHtmlString().toHtml()).toBe("secret");
		expect(str("https://example.com/docs").toUri().path()).toBe("/docs");
	});

	it("keeps the class typed", () => {
		const value: Stringable = str("x");

		expect(value).toBeInstanceOf(Stringable);
	});
});

describe("Uri", () => {
	it("reads the parts of a URL", () => {
		const uri = new Uri("https://example.com:8080/docs?page=2#intro");

		expect(uri.scheme()).toBe("https");
		expect(uri.host()).toBe("example.com:8080");
		expect(uri.port()).toBe(8080);
		expect(uri.path()).toBe("/docs");
		expect(uri.query()).toBe("page=2");
		expect(uri.fragment()).toBe("intro");
	});
});
