import { Disposable, commands } from 'vscode';
import { logDebugMessage } from './logDebugMessage';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerCommand(command: string, callback: (...args: any[]) => any) {
	try {
		return commands.registerCommand(command, callback);
	} catch (err) {
		logDebugMessage(err);
		return Disposable.from();
	}
}
