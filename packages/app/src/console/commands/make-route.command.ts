import type { CommandContext } from "@barqel/barq-cli";
import {
	camelCase,
	GeneratorCommand,
	moduleRoot,
	pascalCase,
} from "../generator";

export class MakeRouteCommand extends GeneratorCommand {
	readonly signature = "route:make <name> [module]";

	override readonly description =
		"Create a route group in modules/<module>/routes";

	protected readonly stub = "route.stub";

	protected className(name: string): string {
		return `${pascalCase(name)}Routes`;
	}

	protected outputPath(name: string, module: string): string {
		return `${moduleRoot(module)}/routes/${name}.ts`;
	}

	protected override variables(
		name: string,
		_className: string,
		module: string,
	): Record<string, string> {
		return { camelName: camelCase(`${module}-${name}`) };
	}

	protected override hints(
		name: string,
		_className: string,
		_relativePath: string,
		module: string,
	): string[] {
		const routes = camelCase(`${module}-${name}`);

		return [
			`Import and call \`${routes}Routes(app)\` in modules/${module}/routes/routes.ts`,
			"The module entry is the only route file loaded at boot",
		];
	}

	override async handle(ctx: CommandContext): Promise<void> {
		// `routes/routes.ts` is the auto-loaded module entry and takes an
		// `App`, not a `Route` — never let this generator shadow it.
		if (String(ctx.args[this.argumentName] ?? "").trim() === "routes") {
			ctx.log.error(
				'"routes" is the module entry point — use `module:make` to scaffold it.',
			);
			process.exitCode = 1;
			return;
		}

		return super.handle(ctx);
	}
}
