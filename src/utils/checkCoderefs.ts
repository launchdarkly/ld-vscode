import path from 'path';
import { ExtensionContext, FileType, Uri, window, workspace } from 'vscode';
import { registerCommand } from './registerCommand';

export function checkCodeRefs(ctx: ExtensionContext) {
	const disposable = registerCommand('extension.checkLaunchDarkly', async () => {
		const workspaceFolders = workspace.workspaceFolders;

		if (workspaceFolders) {
			const launchDarklyPath = path.join(workspaceFolders[0].uri.fsPath, '.launchdarkly', 'coderefs.yaml');

			try {
				const stat = await workspace.fs.stat(Uri.file(launchDarklyPath));

				if (stat.type === FileType.File) {
					window.showInformationMessage('The .launchdarkly/coderefs.yaml file exists.');
				} else {
					window.showErrorMessage('The .launchdarkly/coderefs.yaml path exists but it is not a file.');
				}
			} catch (error) {
				window.showErrorMessage('The .launchdarkly/coderefs.yaml file does not exist.');
			}
		} else {
			window.showErrorMessage('No workspace is open.');
		}
	});

	ctx.subscriptions.push(disposable);

	return disposable;
}
