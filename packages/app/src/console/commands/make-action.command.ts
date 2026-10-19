import { GeneratorCommand, pascalCase } from "../generator";

export class MakeActionCommand extends GeneratorCommand {
	readonly signature = "action:make <name>";

	override readonly description = "Create a use-case action in app/actions";

	protected readonly stub = "action.stub";

	protected className(name: string): string {
		return `${pascalCase(name)}Action`;
	}

	protected outputPath(name: string): string {
		return `app/actions/${name}.ts`;
	}

	protected override hints(): string[] {
		return [
			"Inject it anywhere — controller, job or command — and call `handle()`",
			"Return a DTO from app/dtos (`dto:make`) — never the raw entity",
		];
	}
}
