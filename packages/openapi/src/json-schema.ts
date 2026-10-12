interface ZodLikeDef {
	typeName?: string;
	type?: unknown;
	schema?: unknown;
	innerType?: unknown;
	values?: unknown[];
	entries?: Record<string, unknown>;
	shape?: () => Record<string, unknown>;
	checks?: Array<{ kind: string; value?: unknown }>;
	description?: string;
	defaultValue?: () => unknown;
}

interface ZodLikeSchema {
	_def?: ZodLikeDef;
	description?: string;
	toJSONSchema?: () => Record<string, unknown>;
}

export function toJsonSchema(input: unknown): Record<string, unknown> {
	if (!input || typeof input !== "object") {
		return { type: "string" };
	}

	const candidate = input as ZodLikeSchema;

	if (typeof candidate.toJSONSchema === "function") {
		return candidate.toJSONSchema();
	}

	if (candidate._def?.typeName) {
		return parseZodDef(candidate._def);
	}

	const record = input as Record<string, unknown>;
	if (record.type || record.properties || record.items || record.anyOf || record.oneOf) {
		return record;
	}

	return { type: "object" };
}

function parseZodDef(def: ZodLikeDef): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	if (def.description) out.description = def.description;

	switch (def.typeName) {
		case "ZodString": {
			out.type = "string";
			for (const check of def.checks ?? []) {
				if (check.kind === "min") out.minLength = check.value;
				if (check.kind === "max") out.maxLength = check.value;
				if (check.kind === "email") out.format = "email";
				if (check.kind === "url") out.format = "uri";
				if (check.kind === "uuid") out.format = "uuid";
			}
			return out;
		}
		case "ZodNumber": {
			out.type = "number";
			for (const check of def.checks ?? []) {
				if (check.kind === "int") out.type = "integer";
				if (check.kind === "min") out.minimum = check.value;
				if (check.kind === "max") out.maximum = check.value;
			}
			return out;
		}
		case "ZodBoolean":
			out.type = "boolean";
			return out;
		case "ZodArray":
			out.type = "array";
			out.items = toJsonSchema(def.type);
			return out;
		case "ZodObject": {
			out.type = "object";
			const shape = typeof def.shape === "function" ? def.shape() : (def.shape ?? {});
			const properties: Record<string, unknown> = {};
			const required: string[] = [];

			for (const [key, val] of Object.entries(shape)) {
				properties[key] = toJsonSchema(val);
				const subDef = (val as ZodLikeSchema)?._def;
				if (subDef?.typeName !== "ZodOptional" && subDef?.typeName !== "ZodDefault") {
					required.push(key);
				}
			}

			out.properties = properties;
			if (required.length > 0) out.required = required;
			return out;
		}
		case "ZodEnum":
			out.type = "string";
			out.enum = def.values;
			return out;
		case "ZodNativeEnum":
			out.type = "string";
			out.enum = Object.values(def.values ?? {});
			return out;
		case "ZodOptional":
		case "ZodNullable":
			return toJsonSchema(def.innerType);
		case "ZodDefault": {
			const base = toJsonSchema(def.innerType);
			if (typeof def.defaultValue === "function") {
				base.default = def.defaultValue();
			}
			return base;
		}
		default:
			return { type: "string" };
	}
}
