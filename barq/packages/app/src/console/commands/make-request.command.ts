import {
	GeneratorCommand,
	kebabCase,
	moduleRoot,
	pascalCase,
} from "../generator";

export class MakeRequestCommand extends GeneratorCommand {
	readonly signature = "request:make <name> [module]";

	override readonly description =
		"Create a validated request in modules/<module>/requests (resource/action, e.g. user/create)";

	protected readonly stub = "request.stub";

	// "user/create" → class CreateUserRequest, file user/create-user.ts
	// "create"      → class CreateRequest,      file create.ts
	protected className(name: string): string {
		const segments = name.split("/");
		const action = segments.pop()!;

		return `${pascalCase(action)}${segments.map(pascalCase).join("")}Request`;
	}

	protected outputPath(name: string, module: string): string {
		const segments = name.split("/");
		const action = segments.pop()!;
		const resource = segments.pop();

		// Modules are already scoped, so there is no version folder and the
		// resource lives in the file name only.
		const directory = [`${moduleRoot(module)}/requests`, ...segments].join("/");
		const file = resource
			? `${kebabCase(action)}-${kebabCase(resource)}.ts`
			: `${kebabCase(action)}.ts`;

		return `${directory}/${file}`;
	}

	protected override hints(): string[] {
		return [
			"Bind it at the route with `action(Request, handler, docs?)` " +
				"(validation + OpenAPI docs in one place; `handler` follows " +
				"`(ctx, data)` and can be a controller method), stamp a method " +
				"with `@validatedBy(Request)` and wrap it as `action(method)`, " +
				"or inject it and call `await request.validated()`",
		];
	}
}
