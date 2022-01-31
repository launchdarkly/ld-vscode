import { commands, Disposable, ExtensionContext, window } from 'vscode';
import { Configuration } from '../configuration';
import { FLAG_KEY_REGEX } from '../providers';
import { kebabCase } from 'lodash';
import { FlagStore } from '../flagStore';
import { FeatureFlagConfig } from '../models';
import * as url from 'url';
import opn = require('opn');

export default async function openInLdCmd(
	ctx: ExtensionContext,
	config: Configuration,
	flagStore: FlagStore,
): Promise<Disposable> {
	const openInLdCmd = commands.registerTextEditorCommand('launchdarkly.openInLaunchDarkly', async (editor) => {
		const flagKey = editor.document.getText(
			editor.document.getWordRangeAtPosition(editor.selection.anchor, FLAG_KEY_REGEX),
		);
		if (!flagKey) {
			window.showErrorMessage('[LaunchDarkly] Error retrieving flag (current cursor position is not a feature flag).');
			return;
		}

		if (!config.accessToken) {
			window.showErrorMessage('[LaunchDarkly] accessToken is not set.');
			return;
		}

		if (!config.project) {
			window.showErrorMessage('[LaunchDarkly] project is not set.');
			return;
		}

		try {
			const fKey = ctx.workspaceState.get('LDFlagKey') as string;
			await openFlagInBrowser(config, fKey, flagStore);
		} catch (err) {
			let errMsg = `Encountered an unexpected error retrieving the flag ${flagKey}`;
			if (err.statusCode == 404) {
				// Try resolving the flag key to kebab case
				try {
					await openFlagInBrowser(config, kebabCase(flagKey), flagStore);
					return;
				} catch (err) {
					if (err.statusCode == 404) {
						errMsg = `Could not find the flag ${flagKey}`;
					}
				}
			}
			console.error(`Failed opening browser: ${err}`);
			window.showErrorMessage(`[LaunchDarkly] ${errMsg}`);
		}
	});
	ctx.subscriptions.push(openInLdCmd);

	return openInLdCmd;
}

const openFlagInBrowser = async (config: Configuration, flagKey: string, flagStore: FlagStore) => {
	const { flag } = await flagStore.getFeatureFlag(flagKey);

	// Default to first environment
	let env: FeatureFlagConfig = Object.values(flag.environments)[0];
	let sitePath = env._site.href;

	if (!config.env) {
		window.showWarningMessage('[LaunchDarkly] env is not set. Falling back to first environment.');
	} else if (!flag.environments[config.env]) {
		window.showWarningMessage(
			`[LaunchDarkly] Configured environment '${config.env}' has been deleted. Falling back to first environment.`,
		);
	} else {
		env = flag.environments[config.env];
		sitePath = env._site.href;
	}
	console.log(sitePath);
	opn(url.resolve(config.baseUri, sitePath));
};
