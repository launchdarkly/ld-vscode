import {
	ColorThemeKind,
	commands,
	ExtensionContext,
	Hover,
	HoverProvider,
	MarkdownString,
	Position,
	TextDocument,
	window,
} from 'vscode';
import { FlagStore } from '../flagStore';
import { FlagAliases } from './codeRefs';
import { Configuration } from '../configuration';
import { FeatureFlag, FlagConfiguration } from '../models';
import { kebabCase } from 'lodash';
import { FLAG_KEY_REGEX } from '../providers';
import * as fs from 'fs';
import * as url from 'url';

const FLAG_STATUS_CACHE = new Map<string, string>();

export class LaunchDarklyHoverProvider implements HoverProvider {
	private readonly flagStore: FlagStore;
	private readonly config: Configuration;
	private readonly aliases?: FlagAliases;
	private readonly ctx: ExtensionContext;

	constructor(config: Configuration, flagStore: FlagStore, ctx: ExtensionContext, aliases?: FlagAliases) {
		this.config = config;
		this.flagStore = flagStore;
		this.aliases = aliases;
		this.ctx = ctx;
	}

	public provideHover(document: TextDocument, position: Position): Thenable<Hover | undefined> {
		commands.executeCommand('setContext', 'LDFlagToggle', '');
		// eslint-disable-next-line no-async-promise-executor
		return new Promise(async (resolve) => {
			if (this.config.enableHover && this.flagStore) {
				const candidate = document.getText(document.getWordRangeAtPosition(position, FLAG_KEY_REGEX));
				if (typeof candidate === 'undefined') {
					resolve(undefined);
					return;
				}
				let aliases;
				let foundAlias = [];
				if (typeof this.aliases !== undefined) {
					aliases = this.aliases?.getMap();
					if (typeof aliases !== undefined) {
						const aliasKeys = Object.keys(aliases) ? Object.keys(aliases) : [];
						const aliasArr = [...aliasKeys].filter((element) => element !== '');
						foundAlias = aliasArr.filter((element) => candidate.includes(element));
					}
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
						resolve(new Hover(hover));
						return;
					}
				} catch (e) {
					resolve(undefined);
					return;
				}
			}
			resolve(undefined);
			return;
		});
	}
}

export function generateHoverString(
	flag: FeatureFlag,
	c: FlagConfiguration,
	config: Configuration,
	ctx: ExtensionContext,
): MarkdownString {
	const env = Object.keys(flag.environments)[0];
	const flagUri = url.resolve(config.baseUri, flag.environments[env]._site.href);
	const hoverString = new MarkdownString(
		`![Flag status](${getFlagStatusUri(ctx, c.on)}) ${config.project} / ${env} / **[${
			flag.key
		}](${flagUri} "Open in LaunchDarkly")** \n\n`,
		true,
	);
	hoverString.isTrusted = true;

	hoverString.appendText('\n');
	hoverString.appendMarkdown(flag.description);
	hoverString.appendText('\n');

	if (c.prerequisites && c.prerequisites.length > 0) {
		hoverString.appendMarkdown(
			`* Prerequisites: ${c.prerequisites
				.map((p: { key: string; variation: string | number }) => `\`${p.key}\``)
				.join(' ')}\n`,
		);
	}
	if (c.targets && c.targets.length > 0) {
		hoverString.appendMarkdown(`* Targets configured\n`);
	}
	if (c.rules && c.rules.length > 0) {
		hoverString.appendMarkdown(`* Rules configured\n`);
	}
	hoverString.appendText('\n');

	let varTypeIcon;
	const varType = flag.kind === 'multivariate' ? typeof flag.variations[0].value : flag.kind;
	switch (varType) {
		case 'boolean':
			varTypeIcon = '$(symbol-boolean)';
			break;
		case 'number':
			varTypeIcon = '$(symbol-number)';
			break;
		case 'object':
			varTypeIcon = '$(symbol-object)';
			break;
		case 'string':
			varTypeIcon = '$(symbol-key)';
			break;
		default:
			break;
	}

	hoverString.appendMarkdown(`**${varTypeIcon} Variations**`);
	flag.variations.map((variation, idx) => {
		const props = [];
		if (c.offVariation !== undefined && c.offVariation === idx) {
			props.push('`$(arrow-small-right)off`');
		}
		if (c.fallthrough) {
			if (c.fallthrough.variation !== undefined && c.fallthrough.variation === idx) {
				props.push('`$(arrow-small-right)fallthrough`');
			}
		}
		if (c.fallthrough?.rollout) {
			let weight = 0;
			if (c.fallthrough.rollout.variations[idx]?.weight) {
				weight = c.fallthrough.rollout.variations[idx].weight / 1000;
			}
			props.push(`\`$(arrow-small-right)rollout @ ${weight}%\``);
		}

		const varVal = `\`${truncate(JSON.stringify(variation.value), 30).trim()}\``;
		const varName = variation.name ? ` **${variation.name}**` : '';
		const varDescription = variation.description ? `: ${variation.description}` : '';
		hoverString.appendText('\n');
		hoverString.appendMarkdown(`* ${varVal}${varName}${varDescription} ${props.length ? props.join(' ') : ''}`);
	});

	return hoverString;
}

function truncate(str: string, n: number): string {
	return str.length > n ? str.substr(0, n - 1) + '\u2026' : str;
}

function getFlagStatusUri(ctx: ExtensionContext, status: boolean) {
	const fileName = status ? 'toggleon' : 'toggleoff';
	const theme: ColorThemeKind = window.activeColorTheme.kind;
	const colorTheme = ColorThemeKind[theme] === 'Light' ? 'light' : 'dark';
	let dataUri = FLAG_STATUS_CACHE.get(`${colorTheme}-${fileName}`);
	if (dataUri == null && ctx !== undefined) {
		const contents = fs.readFileSync(ctx.asAbsolutePath(`resources/${colorTheme}/${fileName}.svg`)).toString('base64');

		dataUri = encodeURI(`data:image/svg+xml;base64,${contents}`);
		FLAG_STATUS_CACHE.set(`${colorTheme}-${fileName}`, dataUri);
	}

	return dataUri;
}
