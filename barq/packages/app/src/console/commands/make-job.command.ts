import { GeneratorCommand, moduleRoot, pascalCase } from "../generator";

export class MakeJobCommand extends GeneratorCommand {
	readonly signature = "job:make <name> [module]";

	override readonly description =
		"Create a scheduled job in modules/<module>/jobs";

	protected readonly stub = "job.stub";

	protected override readonly registry = { key: "jobs" } as const;

	protected className(name: string): string {
		return `${pascalCase(name)}Job`;
	}

	protected outputPath(name: string, module: string): string {
		return `${moduleRoot(module)}/jobs/${name}.ts`;
	}

	protected override hints(): string[] {
		return [
			"It starts with the server automatically — adjust `schedule` if needed",
		];
	}
}
