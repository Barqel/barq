export interface BaseValidatorOptions<T> {
	default?: T;
	optional?: boolean;
}

export interface StringOptions extends BaseValidatorOptions<string> {
	min?: number;
	max?: number;
	regex?: RegExp;
}

export interface NumberOptions extends BaseValidatorOptions<number> {
	min?: number;
	max?: number;
}

export interface PortOptions extends BaseValidatorOptions<number> {}

export interface BooleanOptions extends BaseValidatorOptions<boolean> {}

export interface UrlOptions extends BaseValidatorOptions<string> {}

export interface EnumOptions<T extends string>
	extends BaseValidatorOptions<T> {}

export type InferOutput<T, O extends BaseValidatorOptions<T>> = O extends {
	optional: true;
}
	? O extends { default: T }
		? T
		: T | undefined
	: T;

export interface Validator<
	T,
	O extends BaseValidatorOptions<T> = BaseValidatorOptions<T>,
> {
	readonly _output?: InferOutput<T, O>;
	type: string;
	options: O;
	parse(raw: string | undefined, key: string): InferOutput<T, O>;
}

export type EnvSchema = Record<string, Validator<any, any>>;

export type InferEnv<TSchema extends EnvSchema> = {
	[K in keyof TSchema]: ReturnType<TSchema[K]["parse"]>;
};

export interface DotEnvOptions {
	cwd?: string;
	files?: string | string[];
	override?: boolean;
}

export interface CreateEnvOptions extends DotEnvOptions {
	dotEnv?: boolean;
	source?: Record<string, string | undefined>;
	onValidationError?: (errors: Array<{ key: string; message: string }>) => void;
}
