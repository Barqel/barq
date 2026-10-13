import { parseArgv } from "./parser";
import type {
	CliOptions,
	CommandAction,
	CommandContext,
	CommandDefinition,
	CommandFlag,
} from "./types";

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";

export class Cli {
	private readonly commands = new Map<string, CommandDefinition>();
	readonly name: string;
	readonly version: string;
	readonly description: string;

	constructor(options: CliOptions = {}) {
		this.name = options.name ?? "barq";
		this.version = options.version ?? "1.0.0";
		this.description = options.description ?? "Barq Console Commands Runner";
	}

	command(
		signature: string,
		options:
			| { description?: string; flags?: Record<string, CommandFlag> }
			| CommandAction,
		action?: CommandAction,
	): this {
		const parsed = this.parseSignature(signature);
		const act = typeof options === "function" ? options : action!;
		const desc = typeof options === "object" ? options.description : undefined;
		const flags = typeof options === "object" ? (options.flags ?? {}) : {};

		this.commands.set(parsed.name, {
			name: parsed.name,
			description: desc,
			argsDefinition: parsed.args,
			flags,
			action: act,
		});

		return this;
	}

	async run(argv: string[] = process.argv): Promise<void> {
		const parsed = parseArgv(argv);

		if (!parsed.command || parsed.flags.help || parsed.flags.h) {
			if (parsed.command && this.commands.has(parsed.command)) {
				this.showCommandHelp(this.commands.get(parsed.command)!);
				return;
			}
			this.showHelp();
			return;
		}

		if (parsed.flags.version || parsed.flags.v) {
			console.log(`${this.name} v${this.version}`);
			return;
		}

		const cmd = this.commands.get(parsed.command);
		if (!cmd) {
			console.error(
				`${RED}Error: Unknown command "${parsed.command}"${RESET}\n`,
			);
			this.showHelp();
			process.exitCode = 1;
			return;
		}

		const argsMap: Record<string, string> = {};
		for (let i = 0; i < cmd.argsDefinition.length; i++) {
			const def = cmd.argsDefinition[i]!;
			const val = parsed.positionals[i];
			if (def.required && val === undefined) {
				console.error(
					`${RED}Error: Missing required argument <${def.name}>${RESET}`,
				);
				process.exitCode = 1;
				return;
			}
			if (val !== undefined) {
				argsMap[def.name] = val;
			}
		}

		const flagsMap: Record<string, any> = {};
		for (const [name, flagDef] of Object.entries(cmd.flags)) {
			let val = parsed.flags[name];
			if (val === undefined && flagDef.alias) {
				val = parsed.flags[flagDef.alias];
			}
			if (val === undefined && flagDef.default !== undefined) {
				val = flagDef.default;
			}
			if (flagDef.required && val === undefined) {
				console.error(`${RED}Error: Missing required flag --${name}${RESET}`);
				process.exitCode = 1;
				return;
			}
			flagsMap[name] = val;
		}

		const ctx: CommandContext = {
			name: cmd.name,
			args: argsMap,
			flags: flagsMap,
			rawArgs: parsed.positionals,
			log: {
				info: (msg) => console.log(`${CYAN}ℹ${RESET} ${msg}`),
				success: (msg) => console.log(`${GREEN}✔${RESET} ${msg}`),
				warn: (msg) => console.warn(`${YELLOW}⚠${RESET} ${msg}`),
				error: (msg) => console.error(`${RED}✖${RESET} ${msg}`),
				table: (data) => console.table(data),
			},
		};

		try {
			await Promise.resolve(cmd.action(ctx));
		} catch (err) {
			console.error(`\n${RED}Command failed:${RESET}`, err);
			process.exitCode = 1;
		}
	}

	private parseSignature(sig: string): {
		name: string;
		args: Array<{ name: string; required: boolean }>;
	} {
		const parts = sig.trim().split(/\s+/);
		const name = parts[0]!;
		const args: Array<{ name: string; required: boolean }> = [];

		for (let i = 1; i < parts.length; i++) {
			const part = parts[i]!;
			if (part.startsWith("<") && part.endsWith(">")) {
				args.push({ name: part.slice(1, -1), required: true });
			} else if (part.startsWith("[") && part.endsWith("]")) {
				args.push({ name: part.slice(1, -1), required: false });
			}
		}

		return { name, args };
	}

	private showHelp(): void {
		console.log(
			`\n${BOLD}${this.name}${RESET} v${this.version} - ${this.description}\n`,
		);
		console.log(
			`${BOLD}Usage:${RESET} ${this.name} <command> [arguments] [flags]\n`,
		);
		console.log(`${BOLD}Available Commands:${RESET}`);

		const entries = Array.from(this.commands.values());
		const maxLen = Math.max(...entries.map((c) => c.name.length), 8);

		for (const cmd of entries) {
			console.log(
				`  ${GREEN}${cmd.name.padEnd(maxLen + 4)}${RESET} ${cmd.description ?? ""}`,
			);
		}

		console.log(
			`\nUse "${this.name} <command> --help" for detailed command instructions.\n`,
		);
	}

	private showCommandHelp(cmd: CommandDefinition): void {
		console.log(`\n${BOLD}Command:${RESET} ${cmd.name}`);
		if (cmd.description) console.log(`${cmd.description}\n`);

		const argStr = cmd.argsDefinition
			.map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`))
			.join(" ");
		console.log(
			`${BOLD}Usage:${RESET} ${this.name} ${cmd.name} ${argStr} [flags]\n`,
		);

		const flagEntries = Object.entries(cmd.flags);
		if (flagEntries.length > 0) {
			console.log(`${BOLD}Flags:${RESET}`);
			for (const [name, flag] of flagEntries) {
				const aliasPart = flag.alias ? `-${flag.alias}, ` : "    ";
				console.log(
					`  ${aliasPart}--${name.padEnd(16)} ${flag.description ?? ""} ${flag.default !== undefined ? `(default: ${flag.default})` : ""}`,
				);
			}
			console.log("");
		}
	}
}
