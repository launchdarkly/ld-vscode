import { commands } from "vscode";

export default async function checkExistingCommand(commandName: string): Promise<boolean> {
	const checkCommands = await commands.getCommands(false);
	if (checkCommands.includes(commandName)) {
		return true;
	}
	return false;
}