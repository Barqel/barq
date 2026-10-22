// Built-in console commands — always available, in every application.
import type { CommandClass } from "../command";
import { AppInfoCommand } from "./app-info.command";
import { EnvCheckCommand } from "./env-check.command";
import { KeyGenerateCommand } from "./key-generate.command";
import { MakeActionCommand } from "./make-action.command";
import { MakeCommandCommand } from "./make-command.command";
import { MakeConfigCommand } from "./make-config.command";
import { MakeControllerCommand } from "./make-controller.command";
import { MakeDtoCommand } from "./make-dto.command";
import { MakeEnvCommand } from "./make-env.command";
import { MakeJobCommand } from "./make-job.command";
import { MakeListenerCommand } from "./make-listener.command";
import { MakeLocaleCommand } from "./make-locale.command";
import { MakeMailCommand } from "./make-mail.command";
import { MakeMiddlewareCommand } from "./make-middleware.command";
import { MakeModuleCommand } from "./make-module.command";
import { MakeRepositoryCommand } from "./make-repository.command";
import { MakeRequestCommand } from "./make-request.command";
import { MakeRouteCommand } from "./make-route.command";
import { MakeServiceCommand } from "./make-service.command";

export const builtinCommands: CommandClass[] = [
	AppInfoCommand,
	EnvCheckCommand,
	KeyGenerateCommand,
	MakeActionCommand,
	MakeCommandCommand,
	MakeConfigCommand,
	MakeControllerCommand,
	MakeDtoCommand,
	MakeEnvCommand,
	MakeJobCommand,
	MakeListenerCommand,
	MakeLocaleCommand,
	MakeMailCommand,
	MakeMiddlewareCommand,
	MakeModuleCommand,
	MakeRepositoryCommand,
	MakeRequestCommand,
	MakeRouteCommand,
	MakeServiceCommand,
];
