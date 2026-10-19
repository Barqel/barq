import type { RegistryTarget } from "../generator";
import { GeneratorCommand, kebabCase, pascalCase } from "../generator";

export class MakeListenerCommand extends GeneratorCommand {
	readonly signature = "listener:make <event>";

	override readonly description =
		"Create an event listener in app/listeners (event as user.created)";

	protected readonly stub = "listener.stub";

	/** The positional argument is named `<event>`, not `<name>`. */
	protected override readonly argumentName = "event";

	// Event names are dotted ("user.created") — no slashes here.
	protected override readonly namePattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/i;

	protected override readonly registry: RegistryTarget = { key: "listeners" };

	protected className(eventName: string): string {
		return `${pascalCase(kebabCase(eventName))}Listener`;
	}

	protected outputPath(eventName: string): string {
		return `app/listeners/${kebabCase(eventName)}.ts`;
	}

	protected override variables(eventName: string): Record<string, string> {
		return { event: eventName.replace(/-/g, ".") };
	}

	protected override hints(eventName: string): string[] {
		return [
			"Replace Record<string, unknown> with the real payload shape (Listener.of<…> in the class header)",
			`Emit it anywhere with: await eventBus().emit(${this.className(eventName)}.event, payload)`,
		];
	}
}
