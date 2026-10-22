import type { RegistryTarget } from "../generator";
import {
	GeneratorCommand,
	kebabCase,
	moduleRoot,
	pascalCase,
} from "../generator";

export class MakeCommandCommand extends GeneratorCommand {
	readonly signature = "command:make <name> [module]";

	override readonly description =
		"Create a console command in modules/<module>/commands (namespaces allowed, e.g. cache:clear)";

	protected readonly stub = "command.stub";

	// Command names may be namespaced with colons ("cache:clear").
	protected override readonly namePattern = /^[a-z0-9]+(?:[.:-][a-z0-9]+)*$/i;

	protected override readonly registry: RegistryTarget = { key: "commands" };

	protected className(name: string): string {
		return `${pascalCase(name)}Command`;
	}

	protected outputPath(name: string, module: string): string {
		return `${moduleRoot(module)}/commands/${kebabCase(name)}.ts`;
	}

	protected override variables(name: string): Record<string, string> {
		return { signature: name };
	}

	protected override hints(name: string): string[] {
		return [`Run it with: bun run cli ${name}`];
	}
}
