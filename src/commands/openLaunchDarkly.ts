import { commands, Disposable, window } from 'vscode';
import { FLAG_KEY_REGEX } from '../providers';
import { kebabCase } from 'lodash';
import { FeatureFlagConfig, FlagStoreInterface, ILDExtensionConfiguration } from '../models';
import * as url from 'url';
import opn = require('opn');
import { CMD_LD_OPEN } from '../utils/commands';

export default function openInLdCmd(config: ILDExtensionConfiguration): Disposable {
	const openInLdCmd = commands.registerTextEditorCommand(CMD_LD_OPEN, async (editor) => {
		const flagKey = editor.document.getText(
			editor.document.getWordRangeAtPosition(editor.selection.anchor, FLAG_KEY_REGEX),
		);
		if (!flagKey) {
			window.showErrorMessage('[LaunchDarkly] Error retrieving flag (current cursor position is not a feature flag).');
			return;
		}

		if (!config.getConfig().accessToken) {
			window.showErrorMessage('[LaunchDarkly] accessToken is not set.');
			return;
		}

		if (!config.getConfig().project) {
			window.showErrorMessage('[LaunchDarkly] project is not set.');
			return;
		}

		try {
			const fKey = config.getCtx().workspaceState.get('LDFlagKey') as string;
			await openFlagInBrowser(config, fKey, config.getFlagStore());
		} catch (err) {
			let errMsg = `Encountered an unexpected error retrieving the flag ${flagKey}`;
			if (err.statusCode == 404) {
				// Try resolving the flag key to kebab case
				try {
					await openFlagInBrowser(config, kebabCase(flagKey), config.getFlagStore());
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
	config.getCtx().subscriptions.push(openInLdCmd);

	return openInLdCmd;
}

const openFlagInBrowser = async (config: ILDExtensionConfiguration, flagKey: string, flagStore: FlagStoreInterface) => {
	const { flag } = await flagStore.getFeatureFlag(flagKey);

	// Default to first environment
	let env: FeatureFlagConfig = Object.values(flag.environments)[0];
	let sitePath = env._site.href;

	if (!config.getConfig().env) {
		window.showWarningMessage('[LaunchDarkly] env is not set. Falling back to first environment.');
	} else if (!flag.environments[config.getConfig().env]) {
		window.showWarningMessage(
			`[LaunchDarkly] Configured environment '${
				config.getConfig().env
			}' has been deleted. Falling back to first environment.`,
		);
	} else {
		env = flag.environments[config.getConfig().env];
		sitePath = env._site.href;
	}
	opn(url.resolve(config.getSession().fullUri, sitePath));
};
