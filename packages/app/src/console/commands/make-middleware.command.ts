import { appConfigFileLabel } from "../../config/app-config-file";
import {
	camelCase,
	GeneratorCommand,
	kebabCase,
	moduleRoot,
} from "../generator";

export class MakeMiddlewareCommand extends GeneratorCommand {
	readonly signature = "middleware:make <name> [module]";

	override readonly description =
		"Create a middleware in modules/<module>/middleware";

	protected readonly stub = "middleware.stub";

	protected className(name: string): string {
		return `${camelCase(name)}Middleware`;
	}

	protected outputPath(name: string, module: string): string {
		return `${moduleRoot(module)}/middleware/${kebabCase(name)}.ts`;
	}

	protected override hints(
		_name: string,
		className: string,
		_relativePath: string,
	): string[] {
		return [
			`Attach it per route: users.post("/", ${className}(), handler)`,
			`Or app-wide in ${appConfigFileLabel()} — configure: (app) => app.use(${className}())`,
		];
	}
}
