export type FieldParser<T> = (raw: string | undefined, key: string) => T;

export interface StringFieldOptions {
	default?: string;
	min?: number;
	max?: number;
	regex?: RegExp;
	choices?: readonly string[];
}

export interface NumberFieldOptions {
	default?: number;
	min?: number;
	max?: number;
	int?: boolean;
}

export interface BooleanFieldOptions {
	default?: boolean;
}

export interface UrlFieldOptions {
	default?: string;
	protocols?: string[];
}

export type EnvSchema = Record<string, FieldParser<any>>;

export type InferEnv<T extends EnvSchema> = {
	[K in keyof T]: T[K] extends FieldParser<infer R> ? R : never;
};

export interface EnvOptions {
	source?: Record<string, string | undefined>;
	onValidationError?: (errors: Array<{ key: string; message: string }>) => void;
}
