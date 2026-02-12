import { ColorThemeKind, ExtensionContext, MarkdownString, window } from 'vscode';
import { FeatureFlag, FlagConfiguration, ILDExtensionConfiguration } from '../models';
import * as fs from 'fs';
import * as url from 'url';

const FLAG_STATUS_CACHE = new Map<string, string>();

export interface DevServerHoverInfo {
	value: unknown;
	isOverridden: boolean;
}

export function generateHoverString(
	flag: FeatureFlag,
	c: FlagConfiguration,
	config: ILDExtensionConfiguration,
	devServerInfo?: DevServerHoverInfo,
): MarkdownString {
	let env;
	try {
		env = Object.keys(flag.environments)[0];
	} catch (err) {
		console.error(err);
		return;
	}

	// Determine toggle state: use dev-server value when available
	let toggleState = c.on;
	if (devServerInfo !== undefined) {
		toggleState = typeof devServerInfo.value === 'boolean' ? devServerInfo.value : Boolean(devServerInfo.value);
	}

	const session = config.getSession();
	const flagUri = session ? url.resolve(session.fullUri, flag.environments[env]._site.href) : '';
	const flagLink = flagUri ? `**[${flag.key}](${flagUri} "Open in LaunchDarkly")**` : `**${flag.key}**`;
	const hoverString = new MarkdownString(
		`![Flag status](${getFlagStatusUri(config.getCtx(), toggleState)}) ${config.getConfig().project} / ${env} / ${flagLink} \n\n`,
		true,
	);
	hoverString.isTrusted = true;

	hoverString.appendText('\n');
	hoverString.appendMarkdown(flag.description);
	hoverString.appendText('\n');
	const clientSDK = flag.clientSideAvailability.usingEnvironmentId ? '$(browser)' : '';
	const mobileSDK = flag.clientSideAvailability.usingMobileKey ? '$(device-mobile)' : '';
	const sdkAvailability = `Client-side SDK availability: ${clientSDK}${clientSDK && mobileSDK ? ' ' : ''}${mobileSDK}${
		!clientSDK && !mobileSDK ? '$(server)' : ''
	}\n\n`;
	hoverString.appendMarkdown(sdkAvailability);
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

	// Add dev-server section if connected
	if (devServerInfo !== undefined) {
		hoverString.appendText('\n');
		const valueStr =
			typeof devServerInfo.value === 'object' ? JSON.stringify(devServerInfo.value) : String(devServerInfo.value);
		const overrideNote = devServerInfo.isOverridden ? ' **(overridden)**' : '';
		hoverString.appendMarkdown(`\n\n---\n**Dev Server Value:** \`${valueStr}\`${overrideNote}`);
	}

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
