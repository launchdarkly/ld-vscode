import { commands, ExtensionContext, Hover, HoverProvider, Position, TextDocument } from 'vscode';
import { FlagStore } from '../flagStore';
import { FlagAliases } from './codeRefs';
import { Configuration } from '../configuration';
import { kebabCase } from 'lodash';
import { FLAG_KEY_REGEX } from '../providers';

import { generateHoverString } from '../utils/hover';

export class LaunchDarklyHoverProvider implements HoverProvider {
	private readonly flagStore: FlagStore;
	private readonly config: Configuration;
	private readonly aliases?: FlagAliases;
	private readonly ctx: ExtensionContext;

	constructor(config: Configuration, flagStore: FlagStore, ctx: ExtensionContext, aliases?: FlagAliases) {
		this.config = config;
		this.flagStore = flagStore;
		this.aliases = aliases;
		this.ctx = global.ldContext;
	}

	public async provideHover(document: TextDocument, position: Position): Promise<Hover | undefined> {
		commands.executeCommand('setContext', 'LDFlagToggle', '');
		if (this.config.enableHover && this.flagStore) {
			const candidate = document.getText(document.getWordRangeAtPosition(position, FLAG_KEY_REGEX));
			if (typeof candidate === 'undefined') {
				return;
			}
			let aliases;
			let foundAlias = [];
			if (typeof this.aliases !== 'undefined') {
				aliases = this.aliases?.getMap();
				const aliasKeys = Object.keys(aliases || {});
				const aliasArr = [...aliasKeys].filter((element) => element !== '');
				foundAlias = aliasArr.filter((element) => candidate.includes(element));
			} else {
				aliases = [];
			}
			try {
				let data =
					(await this.flagStore.getFeatureFlag(candidate)) ||
					(await this.flagStore.getFeatureFlag(kebabCase(candidate)));
				if (!data && aliases && foundAlias) {
					data = await this.flagStore.getFeatureFlag(aliases[foundAlias[0]]);
				} // We only match on first alias
				if (data?.config) {
					commands.executeCommand('setContext', 'LDFlagToggle', data.flag.key);
					this.ctx.workspaceState.update('LDFlagKey', data.flag.key);
					const hover = generateHoverString(data.flag, data.config, this.config, this.ctx);
					return new Hover(hover);
				}
			} catch (e) {
				return;
			}
		}
		return;
	}
}
