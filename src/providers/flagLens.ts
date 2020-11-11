import * as vscode from 'vscode';
import { LaunchDarklyAPI } from '../api';
import { Configuration } from '../configuration';
import { FeatureFlag, FlagConfiguration } from '../models';
import { FlagStore } from '../flagStore';
import { LaunchDarklyTreeViewProvider } from './flagsView';
import { FlagAliases } from './codeRefs';

/**
 * CodelensProvider
 */
export class FlagCodeLensProvider implements vscode.CodeLensProvider {
	private readonly api: LaunchDarklyAPI;
	private config: Configuration;
	private codeLenses: vscode.CodeLens[] = [];
	private regex: RegExp;
	private flagStore: FlagStore;
	private aliases: FlagAliases;
	private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
	public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

	constructor(api: LaunchDarklyAPI, config: Configuration, flagStore: FlagStore, aliases: FlagAliases) {
		this.api = api;
		this.config = config;
		this.flagStore = flagStore;
		this.aliases = aliases;
		this.regex = /(.+)/g;
		vscode.workspace.onDidChangeConfiguration(_ => {
			this._onDidChangeCodeLenses.fire(null);
		});
		this.start();
	}

	refresh(): void {
		this._onDidChangeCodeLenses.fire(null);
	}

	public async start(): Promise<void> {
		await this.flagUpdateListener();
	}

	private async flagUpdateListener() {
		// Setup listener for flag changes
		console.log('setting up lens listener');
		this.flagStore.on('update', () => {
			try {
				console.log('flag update');
				this.refresh();
			} catch (err) {
				console.error('Failed to update LaunchDarkly flag lens:', err);
			}
		});
	}

	getActiveVariations(env: FlagConfiguration) {
		//const hasPrereqs = env.prerequisites > 0;
		if (!env.on) {
			const offVariation = env.offVariation ? env.offVariation : -1;
			return [offVariation];
		} else {
			// eslint-disable-next-line no-prototype-builtins
			const allVariations = obj => [
				...new Set(
					obj.rules
						.concat(obj.fallthrough)
						// eslint-disable-next-line no-prototype-builtins
						.map(x => (x.hasOwnProperty('rollout') ? x.rollout.variations.map(v => v.variation) : x.variation))
						.flat(),
				),
			];
			return allVariations(env);
		}
	}

	getNameorValue(flag: FeatureFlag, variation: number) {
		return flag.variations[variation].name ? flag.variations[variation].name : flag.variations[variation].value;
	}

	public async provideCodeLenses(
		document: vscode.TextDocument,
		token: vscode.CancellationToken,
	): Promise<vscode.CodeLens[]> {
		if (vscode.workspace.getConfiguration('launchdarkly').get('enableCodeLens', true)) {
			this.codeLenses = [];
			const regex = new RegExp(this.regex);
			const text = document.getText();
			let matches;
			const flags = await this.flagStore.allFlagsMetadata();
			const env = await this.flagStore.allFlags();
			const keys = Object.keys(flags);
			let aliases: Map<string, string>;
			let aliasArr;
			try {
				aliases = this.aliases.getMap();
				const aliasKeys = Object.keys(aliases);
				aliasArr = [...aliasKeys].filter(element => element !== '');
			} catch (err) {
				console.log(err);
			}
			while ((matches = regex.exec(text)) !== null) {
				const line = document.lineAt(document.positionAt(matches.index).line);
				const indexOf = line.text.indexOf(matches[0]);
				const position = new vscode.Position(line.lineNumber, indexOf);
				const range = document.getWordRangeAtPosition(position, new RegExp(this.regex));
				const prospect = document.getText(range);
				const flag = keys.filter(element => prospect.includes(element));
				const foundAliases = aliasArr.filter(element => prospect.includes(element));

				if (range && flag !== undefined && flags[flag[0]]) {
					const codeLens = new FlagCodeLens(range, flags[flag[0]], env[flag[0]], this.config);
					this.codeLenses.push(codeLens);
				} else if (range && foundAliases.length > 0 && flags[aliases[foundAliases]]) {
					const codeLens = new FlagCodeLens(
						range,
						flags[aliases[foundAliases]],
						env[aliases[foundAliases]],
						this.config,
					);
					this.codeLenses.push(codeLens);
				}
			}

			return this.codeLenses;
		}
	}

	public resolveCodeLens(codeLens: FlagCodeLens, token: vscode.CancellationToken): FlagCodeLens {
		try {
			let preReq = '';
			if (codeLens.env.prerequisites && codeLens.env.prerequisites.length > 0) {
				preReq = codeLens.env.prerequisites.length > 0 ? `\u2022 Prerequisites configured` : ``;
			} else {
				preReq = '';
			}
			const variations = this.getActiveVariations(codeLens.env) as Array<number>;
			let flagVariations;
			if (variations.length === 1) {
				flagVariations = this.getNameorValue(codeLens.flag, 0);
			} else if (variations.length === 2) {
				flagVariations = `${this.getNameorValue(codeLens.flag, 0)}, ${this.getNameorValue(codeLens.flag, 1)}`;
			} else {
				flagVariations = `${variations.length} variations`;
			}
			let offVariation;
			if (codeLens.env.offVariation !== null) {
				offVariation = `${this.getNameorValue(codeLens.flag, codeLens.env.offVariation)} - off variation`;
			} else {
				offVariation = '**Code Fallthrough(No off variation set)**';
			}
			codeLens.command = {
				title: `LaunchDarkly Feature Flag \u2022 Serving: ${codeLens.env.on ? flagVariations : offVariation} ${preReq}`,
				tooltip: 'Feature Flag Variations',
				command: '',
				arguments: ['Argument 1', true],
			};
			return codeLens;
		} catch (err) {
			console.log(err);
		}
	}
}

export class FlagCodeLens extends vscode.CodeLens {
	public readonly flag: FeatureFlag;
	public readonly env: FlagConfiguration;
	public config: Configuration;
	constructor(
		range: vscode.Range,
		flag: FeatureFlag,
		env: FlagConfiguration,
		config: Configuration,
		command?: vscode.Command | undefined,
	) {
		super(range, command);
		this.flag = flag;
		this.env = env;
		this.config = config;
	}
}
