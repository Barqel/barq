import type {
	BooleanFieldOptions,
	FieldParser,
	NumberFieldOptions,
	StringFieldOptions,
	UrlFieldOptions,
} from "./types";

export class EnvValidationError extends Error {
	constructor(
		public readonly errors: Array<{ key: string; message: string }>,
	) {
		const formatted = errors.map((e) => `  - ${e.key}: ${e.message}`).join("\n");
		super(`Environment configuration validation failed:\n${formatted}`);
		this.name = "EnvValidationError";
	}
}

export const env = {
	string(options: StringFieldOptions = {}): FieldParser<string> {
		return (raw, key) => {
			const val = raw !== undefined && raw.trim() !== "" ? raw.trim() : options.default;
			if (val === undefined) {
				throw new Error("Missing required string value");
			}
			if (options.min !== undefined && val.length < options.min) {
				throw new Error(`Length must be at least ${options.min} characters`);
			}
			if (options.max !== undefined && val.length > options.max) {
				throw new Error(`Length must be at most ${options.max} characters`);
			}
			if (options.choices && !options.choices.includes(val)) {
				throw new Error(`Must be one of: ${options.choices.join(", ")}`);
			}
			if (options.regex && !options.regex.test(val)) {
				throw new Error(`Does not match pattern ${options.regex}`);
			}
			return val;
		};
	},

	number(options: NumberFieldOptions = {}): FieldParser<number> {
		return (raw, key) => {
			if ((raw === undefined || raw.trim() === "") && options.default !== undefined) {
				return options.default;
			}
			if (raw === undefined || raw.trim() === "") {
				throw new Error("Missing required numeric value");
			}
			const num = Number(raw.trim());
			if (Number.isNaN(num)) {
				throw new Error(`Invalid number: "${raw}"`);
			}
			if (options.int && !Number.isInteger(num)) {
				throw new Error("Expected an integer");
			}
			if (options.min !== undefined && num < options.min) {
				throw new Error(`Must be at least ${options.min}`);
			}
			if (options.max !== undefined && num > options.max) {
				throw new Error(`Must be at most ${options.max}`);
			}
			return num;
		};
	},

	port(options: { default?: number } = {}): FieldParser<number> {
		return env.number({
			default: options.default,
			int: true,
			min: 1,
			max: 65535,
		});
	},

	boolean(options: BooleanFieldOptions = {}): FieldParser<boolean> {
		return (raw, key) => {
			if ((raw === undefined || raw.trim() === "") && options.default !== undefined) {
				return options.default;
			}
			if (raw === undefined || raw.trim() === "") {
				throw new Error("Missing required boolean value");
			}
			const lower = raw.trim().toLowerCase();
			if (["true", "1", "yes", "on"].includes(lower)) return true;
			if (["false", "0", "no", "off"].includes(lower)) return false;
			throw new Error(`Invalid boolean: "${raw}"`);
		};
	},

	enum<T extends string>(values: readonly T[], options: { default?: T } = {}): FieldParser<T> {
		return (raw, key) => {
			const val = raw !== undefined && raw.trim() !== "" ? (raw.trim() as T) : options.default;
			if (val === undefined) {
				throw new Error(`Missing required enum value, expected one of: ${values.join(", ")}`);
			}
			if (!values.includes(val)) {
				throw new Error(`Invalid value: "${val}". Expected one of: ${values.join(", ")}`);
			}
			return val;
		};
	},

	url(options: UrlFieldOptions = {}): FieldParser<string> {
		return (raw, key) => {
			const val = raw !== undefined && raw.trim() !== "" ? raw.trim() : options.default;
			if (val === undefined) {
				throw new Error("Missing required URL string");
			}
			let parsed: URL;
			try {
				parsed = new URL(val);
			} catch {
				throw new Error(`Invalid URL: "${val}"`);
			}
			if (options.protocols && !options.protocols.includes(parsed.protocol.replace(":", ""))) {
				throw new Error(`URL protocol must be one of: ${options.protocols.join(", ")}`);
			}
			return val;
		};
	},
};
