import { camelCase, GeneratorCommand, kebabCase } from "../generator";

export class MakeMiddlewareCommand extends GeneratorCommand {
	readonly signature = "middleware:make <name>";

	override readonly description = "Create a middleware in app/middleware";

	protected readonly stub = "middleware.stub";

	protected className(name: string): string {
		return `${camelCase(name)}Middleware`;
	}

	protected outputPath(name: string): string {
		return `app/middleware/${kebabCase(name)}.ts`;
	}

	protected override hints(
		_name: string,
		className: string,
		_relativePath: string,
	): string[] {
		return [
			`Attach it per route: users.post("/", ${className}(), handler)`,
			`Or app-wide in barq.config.ts — configure: (app) => app.use(${className}())`,
		];
	}
}
