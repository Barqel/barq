// Built-in console commands — always available, in every application.
import type { CommandClass } from "../command";
import { AppInfoCommand } from "./app-info.command";
import { EnvCheckCommand } from "./env-check.command";
import { MakeActionCommand } from "./make-action.command";
import { MakeCommandCommand } from "./make-command.command";
import { MakeControllerCommand } from "./make-controller.command";
import { MakeDtoCommand } from "./make-dto.command";
import { MakeJobCommand } from "./make-job.command";
import { MakeListenerCommand } from "./make-listener.command";
import { MakeMiddlewareCommand } from "./make-middleware.command";
import { MakeRepositoryCommand } from "./make-repository.command";
import { MakeRequestCommand } from "./make-request.command";
import { MakeServiceCommand } from "./make-service.command";

export const builtinCommands: CommandClass[] = [
	AppInfoCommand,
	EnvCheckCommand,
	MakeActionCommand,
	MakeCommandCommand,
	MakeControllerCommand,
	MakeDtoCommand,
	MakeJobCommand,
	MakeListenerCommand,
	MakeMiddlewareCommand,
	MakeRepositoryCommand,
	MakeRequestCommand,
	MakeServiceCommand,
];
