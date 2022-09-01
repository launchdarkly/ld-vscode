import * as vscode from 'vscode';
import { LaunchDarklyAPI } from '../api';
import { Configuration } from '../configuration';
import { FeatureFlag, FlagConfiguration } from '../models';
import { FlagStore } from '../flagStore';
import { FlagAliases } from './codeRefs';
import { CancellationToken, CodeLens, ConfigurationChangeEvent } from 'vscode';
import { LaunchDarklyTreeViewProvider } from './flagsView';

const MAX_CODELENS_VALUE = 20;
/**
 * CodelensProvider
 */
export class FlagCodeLensProvider implements vscode.CodeLensProvider {
	private config: Configuration;
	private regex: RegExp;
	private flagStore: FlagStore;
	private aliases: FlagAliases;
	private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
	public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

	constructor(api: LaunchDarklyAPI, config: Configuration, flagStore: FlagStore, aliases?: FlagAliases) {
		this.config = config;
		this.flagStore = flagStore;
		this.aliases = aliases;
		this.regex = /(.+)/g;
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		vscode.workspace.onDidChangeConfiguration(async (e: ConfigurationChangeEvent) => {
			if (e.affectsConfiguration('launchdarkly.enableCodeLens')) {
				this._onDidChangeCodeLenses.fire(null);
			}
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
		this.flagStore?.on('update', () => {
			try {
				this.refresh();
			} catch (err) {
				console.error('Failed to update LaunchDarkly flag lens:', err);
			}
		});
	}

	getActiveVariations(env: FlagConfiguration): unknown {
		//const hasPrereqs = env.prerequisites > 0;
		if (!env.on) {
			const offVariation = env.offVariation ? env.offVariation : -1;
			return [offVariation];
		} else {
			// eslint-disable-next-line no-prototype-builtins
			const allVariations = (obj) => [
				...new Set(
					obj.rules
						.concat(obj.fallthrough)
						// eslint-disable-next-line no-prototype-builtins
						.map((x) => (x.hasOwnProperty('rollout') ? x.rollout.variations.map((v) => v.variation) : x.variation))
						.flat(),
				),
			];
			return allVariations(env);
		}
	}

	getNameorValue(flag: FeatureFlag, variation: number): string {
		let flagVal;
		if (typeof flag.variations[variation].value === 'object') {
			flagVal = JSON.stringify(flag.variations[variation].value).substring(0, MAX_CODELENS_VALUE);
		} else {
			flagVal =
				typeof flag.variations[variation].value === 'string'
					? flag.variations[variation].value.substring(0, MAX_CODELENS_VALUE)
					: flag.variations[variation].value;
		}
		return JSON.stringify(flag.variations[variation].name) ? flag.variations[variation].name : flagVal;
	}

	public async provideCodeLenses(document: vscode.TextDocument, token: CancellationToken): Promise<vscode.CodeLens[]> {
		if (vscode.workspace.getConfiguration('launchdarkly').get('enableCodeLens', false)) {
			return this.ldCodeLens(document, token);
		}
	}

	public async ldCodeLens(
		document: vscode.TextDocument,
		token: CancellationToken,
		firstFlagOnly = true,
	): Promise<vscode.CodeLens[]> {
		const codeLenses: vscode.CodeLens[] = [];
		const regex = new RegExp(this.regex);
		const text = document.getText();
		if (token.isCancellationRequested) return codeLenses;
		let keys;
		if (this.flagStore) {
			keys = await this.flagStore.listFlags();
		} else {
			return;
		}

		let aliasesLocal: Map<string, string>;
		let aliasArr;
		try {
			if (typeof this.aliases !== 'undefined') {
				aliasesLocal = this.aliases.getMap();
				aliasArr = this.aliases.getListOfMapKeys();
			}
		} catch (err) {
			console.log(err);
		}
		let matches;

		while ((matches = regex.exec(text)) !== null) {
			if (token.isCancellationRequested) return codeLenses;
			const line = document.lineAt(document.positionAt(matches.index).line);
			const indexOf = line.text.indexOf(matches[0]);
			if (indexOf == -1) {
				continue;
			}
			const position = new vscode.Position(line.lineNumber, indexOf);
			const range = document.getWordRangeAtPosition(position, new RegExp(this.regex));
			const prospect = document.getText(range);

			let flag;
			let foundAliases;

			if (typeof keys !== 'undefined') {
				flag = keys.filter((element) => prospect.includes(element));
			}

			if (flag.length == 0 && typeof aliasesLocal !== 'undefined') {
				foundAliases = aliasArr.filter((element) => prospect.includes(element));
			}

			// Use first found flag on line for inlay codelens
			if (firstFlagOnly) {
				const firstFlag = flag[0] ? flag[0] : aliasesLocal[foundAliases[0]];
				if (range && firstFlag) {
					const codeLens = new SimpleCodeLens(range, firstFlag, this.config);
					codeLenses.push(codeLens);
				}
			} else {
				flag?.forEach((flag) => {
					const codeLens = new SimpleCodeLens(range, flag, this.config);
					codeLenses.push(codeLens);
				});
				foundAliases?.forEach((flag) => {
					const codeLens = new SimpleCodeLens(range, aliasesLocal[flag], this.config);
					codeLenses.push(codeLens);
				});
			}
		}
		return codeLenses;
	}
	public async resolveCodeLens(codeLens: SimpleCodeLens, token: CancellationToken): Promise<CodeLens> {
		if (!(codeLens instanceof SimpleCodeLens)) return Promise.reject<CodeLens>(undefined);
		const basicLens = codeLens;
		if (token.isCancellationRequested) return basicLens;
		let flags;
		if (this.flagStore) {
			flags = await this.flagStore.allFlagsMetadata();
		} else {
			return;
		}

		const flagEnv = await this.flagStore.getFlagConfig(codeLens.flag);
		const flagData = flags[codeLens.flag];

		try {
			let preReq = '';
			if (flagEnv.prerequisites && flagEnv.prerequisites.length > 0) {
				preReq = flagEnv.prerequisites.length > 0 ? `\u2022 Prerequisites configured` : ``;
			} else {
				preReq = '';
			}
			const variations = this.getActiveVariations(flagEnv) as Array<number>;
			let flagVariations;
			if (variations.length === 1) {
				flagVariations = this.getNameorValue(flagData, 0);
			} else if (variations.length === 2) {
				flagVariations = `${this.getNameorValue(flagData, 0)}, ${this.getNameorValue(flagData, 1)}`;
			} else {
				flagVariations = `${variations.length} variations`;
			}
			let offVariation;
			if (flagEnv.offVariation !== null) {
				offVariation = `${JSON.stringify(this.getNameorValue(flagData, flagEnv.offVariation))} - off variation`;
			} else {
				offVariation = '**Code Fallthrough(No off variation set)**';
			}
			const newLens = new CodeLens(codeLens.range);
			newLens.command = {
				title: `LaunchDarkly Feature Flag \u2022 ${flagEnv.key} \u2022 Serving: ${
					flagEnv.on ? flagVariations : offVariation
				} ${preReq}`,
				tooltip: 'Feature Flag Variations',
				command: '',
				arguments: ['Argument 1', true],
			};
			return newLens;
		} catch (err) {
			console.log('Lens error');
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

export class SimpleCodeLens extends vscode.CodeLens {
	public readonly flag: string;
	constructor(range: vscode.Range, flag: string, config: Configuration, command?: vscode.Command | undefined) {
		super(range, command);
		this.flag = flag;
	}
}
