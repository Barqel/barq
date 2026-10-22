export interface CommandFlag {
	type: "string" | "boolean" | "number";
	description?: string;
	alias?: string;
	default?: any;
	required?: boolean;
}

export interface CommandContext {
	name: string;
	args: Record<string, string>;
	flags: Record<string, any>;
	rawArgs: string[];
	log: {
		info: (msg: string) => void;
		success: (msg: string) => void;
		warn: (msg: string) => void;
		error: (msg: string) => void;
		table: (data: any[]) => void;
	};
}

export type CommandAction = (ctx: CommandContext) => void | Promise<void>;

export interface CommandDefinition {
	name: string;
	description?: string;
	argsDefinition: Array<{ name: string; required: boolean }>;
	flags: Record<string, CommandFlag>;
	action: CommandAction;
}

export interface CliOptions {
	name?: string;
	version?: string;
	description?: string;
}
