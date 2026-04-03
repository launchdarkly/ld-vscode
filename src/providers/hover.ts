import { commands, Hover, HoverProvider, Position, TextDocument } from 'vscode';
import { kebabCase } from 'lodash';
import { FLAG_KEY_REGEX } from '../providers';

import { DevServerHoverInfo, generateHoverString } from '../utils/hover';
import { ILDExtensionConfiguration } from '../models';
import { analytics } from '../analytics';

export class LaunchDarklyHoverProvider implements HoverProvider {
	private readonly ldConfig: ILDExtensionConfiguration;

	constructor(ldConfig: ILDExtensionConfiguration) {
		this.ldConfig = ldConfig;
	}

	public async provideHover(document: TextDocument, position: Position): Promise<Hover | undefined> {
		commands.executeCommand('setContext', 'LDFlagToggle', '');
		if (this.ldConfig.getConfig().enableHover && this.ldConfig.getFlagStore()) {
			const candidate = document.getText(document.getWordRangeAtPosition(position, FLAG_KEY_REGEX));
			if (typeof candidate === 'undefined') {
				return;
			}
			let aliases;
			let foundAlias = [];
			if (this.ldConfig.getAliases() !== null) {
				aliases = this.ldConfig.getAliases()?.getMap();
				const aliasKeys = Object.keys(aliases || {});
				const aliasArr = [...aliasKeys].filter((element) => element !== '');
				foundAlias = aliasArr.filter((element) => candidate.includes(element));
			} else {
				aliases = [];
			}
			try {
				let data =
					(await this.ldConfig.getFlagStore().getFeatureFlag(candidate)) ||
					(await this.ldConfig.getFlagStore().getFeatureFlag(kebabCase(candidate)));
				if (!data && aliases && foundAlias) {
					data = await this.ldConfig.getFlagStore().getFeatureFlag(aliases[foundAlias[0]]);
				} // We only match on first alias
				if (data?.config) {
					commands.executeCommand('setContext', 'LDFlagToggle', data.flag.key);
					this.ldConfig.getCtx().workspaceState.update('LDFlagKey', data.flag.key);

					// Get dev-server info if connected
					let devServerInfo: DevServerHoverInfo | undefined;
					if (this.ldConfig.getConfig().isDevServerEnabled()) {
						const devServerProvider = this.ldConfig.getDevServerProvider();
						if (devServerProvider) {
							const flagValue = devServerProvider.getFlagValue(data.flag.key);
							if (flagValue !== undefined) {
								devServerInfo = {
									value: flagValue,
									isOverridden: devServerProvider.isOverridden(data.flag.key),
								};
							}
						}
					}

					const hover = generateHoverString(data.flag, data.config, this.ldConfig, devServerInfo);
					analytics.track('hover-triggered', { flagKey: data.flag.key });
					return new Hover(hover);
				}
			} catch (e) {
				return;
			}
		}
		return;
	}
}
