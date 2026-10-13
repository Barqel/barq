import type {
	BooleanOptions,
	EnumOptions,
	NumberOptions,
	PortOptions,
	StringOptions,
	UrlOptions,
	Validator,
} from "./types";

export const env = {
	string<const O extends StringOptions = StringOptions>(
		options: O = {} as O,
	): Validator<string, O> {
		return {
			type: "string",
			options,
			parse(raw: string | undefined, key: string): any {
				if (raw === undefined || raw.trim() === "") {
					if (options.default !== undefined) return options.default;
					if (options.optional) return undefined;
					throw new Error(`Required environment variable "${key}" is missing`);
				}
				if (options.min !== undefined && raw.length < options.min) {
					throw new Error(
						`"${key}" must have a minimum length of ${options.min}, got ${raw.length}`,
					);
				}
				if (options.max !== undefined && raw.length > options.max) {
					throw new Error(
						`"${key}" must have a maximum length of ${options.max}, got ${raw.length}`,
					);
				}
				if (options.regex && !options.regex.test(raw)) {
					throw new Error(`"${key}" failed format validation`);
				}
				return raw;
			},
		};
	},

	number<const O extends NumberOptions = NumberOptions>(
		options: O = {} as O,
	): Validator<number, O> {
		return {
			type: "number",
			options,
			parse(raw: string | undefined, key: string): any {
				if (raw === undefined || raw.trim() === "") {
					if (options.default !== undefined) return options.default;
					if (options.optional) return undefined;
					throw new Error(`Required environment variable "${key}" is missing`);
				}
				const num = Number(raw);
				if (Number.isNaN(num)) {
					throw new Error(`"${key}" must be a valid number, got "${raw}"`);
				}
				if (options.min !== undefined && num < options.min) {
					throw new Error(`"${key}" must be >= ${options.min}, got ${num}`);
				}
				if (options.max !== undefined && num > options.max) {
					throw new Error(`"${key}" must be <= ${options.max}, got ${num}`);
				}
				return num;
			},
		};
	},

	port<const O extends PortOptions = PortOptions>(
		options: O = {} as O,
	): Validator<number, O> {
		return {
			type: "port",
			options,
			parse(raw: string | undefined, key: string): any {
				if (raw === undefined || raw.trim() === "") {
					if (options.default !== undefined) return options.default;
					if (options.optional) return undefined;
					throw new Error(`Required environment variable "${key}" is missing`);
				}
				const num = Number(raw);
				if (
					Number.isNaN(num) ||
					!Number.isInteger(num) ||
					num < 1 ||
					num > 65535
				) {
					throw new Error(
						`"${key}" must be an integer port between 1 and 65535, got "${raw}"`,
					);
				}
				return num;
			},
		};
	},

	boolean<const O extends BooleanOptions = BooleanOptions>(
		options: O = {} as O,
	): Validator<boolean, O> {
		return {
			type: "boolean",
			options,
			parse(raw: string | undefined, key: string): any {
				if (raw === undefined || raw.trim() === "") {
					if (options.default !== undefined) return options.default;
					if (options.optional) return undefined;
					throw new Error(`Required environment variable "${key}" is missing`);
				}
				const lower = raw.trim().toLowerCase();
				if (
					lower === "true" ||
					lower === "1" ||
					lower === "yes" ||
					lower === "t"
				) {
					return true;
				}
				if (
					lower === "false" ||
					lower === "0" ||
					lower === "no" ||
					lower === "f"
				) {
					return false;
				}
				throw new Error(
					`"${key}" must be a boolean (true/false/1/0), got "${raw}"`,
				);
			},
		};
	},

	url<const O extends UrlOptions = UrlOptions>(
		options: O = {} as O,
	): Validator<string, O> {
		return {
			type: "url",
			options,
			parse(raw: string | undefined, key: string): any {
				if (raw === undefined || raw.trim() === "") {
					if (options.default !== undefined) return options.default;
					if (options.optional) return undefined;
					throw new Error(`Required environment variable "${key}" is missing`);
				}
				try {
					new URL(raw);
					return raw;
				} catch {
					throw new Error(`"${key}" must be a valid URL, got "${raw}"`);
				}
			},
		};
	},

	enum<
		const T extends readonly string[],
		const O extends EnumOptions<T[number]> = EnumOptions<T[number]>,
	>(values: T, options: O = {} as O): Validator<T[number], O> {
		return {
			type: "enum",
			options,
			parse(raw: string | undefined, key: string): any {
				if (raw === undefined || raw.trim() === "") {
					if (options.default !== undefined) return options.default;
					if (options.optional) return undefined;
					throw new Error(`Required environment variable "${key}" is missing`);
				}
				if (!values.includes(raw as T[number])) {
					throw new Error(
						`"${key}" must be one of [${values.join(", ")}], got "${raw}"`,
					);
				}
				return raw;
			},
		};
	},
};
