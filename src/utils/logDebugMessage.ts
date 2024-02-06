import { workspace } from 'vscode';

export function logDebugMessage(message: string) {
	const debugLogging = workspace.getConfiguration('launchdarkly').get('debugLogging', false);
	if (debugLogging) {
		console.log(message);
	}
}
