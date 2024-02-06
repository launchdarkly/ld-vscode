import * as vscode from 'vscode';
import { Configuration } from '../configuration';
import { Fallthrough, FeatureFlag, FlagConfiguration, WeightedVariation } from '../models';
import { FlagStore } from '../flagStore';
import { FlagAliases } from './codeRefs';
import { CancellationToken, CancellationTokenSource, CodeLens, ConfigurationChangeEvent, workspace } from 'vscode';
import { LDExtensionConfiguration } from '../ldExtensionConfiguration';
import { Dictionary } from 'lodash';
import { logDebugMessage } from '../utils/logDebugMessage';

// Most Lens are read only, so leaving a longer cache. There is an optimistic delete if we receive a flag update.
const LENS_CACHE_TTL = 300000;
const MAX_CODELENS_VALUE = 20;

/**
 * CodelensProvider
 */
export class FlagCodeLensProvider implements vscode.CodeLensProvider {
	private config: LDExtensionConfiguration;
	private regex: RegExp;
	private flagStore: FlagStore | null;
	private aliases: FlagAliases;
	private keyCache;
	private flagCache;
	public lensCache = new LensCache(LENS_CACHE_TTL);
	private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
	public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

	constructor(config: LDExtensionConfiguration) {
		this.config = config;
		this.regex = /(.+)/g;
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		vscode.workspace.onDidChangeConfiguration(async (e: ConfigurationChangeEvent) => {
			if (e.affectsConfiguration('launchdarkly.enableCodeLens')) {
				this._onDidChangeCodeLenses.fire(undefined);
			}
		});
		// authentication.onDidChangeSessions(async (e) => {
		// 	if (e.provider.id === 'launchdarkly') {
		// 		const session = await authentication.getSession('launchdarkly', ['writer'], { createIfNone: false });
		// 		if (session === undefined) {
		// 			this.flagStore = null;
		// 		}
		// 	}
		// });
		this.start();
	}

	refresh(): void {
		this._onDidChangeCodeLenses.fire(undefined);
	}

	public async start(): Promise<void> {
		await this.flagUpdateListener();
	}

	private async flagUpdateListener() {
		// Setup listener for flag changes
		this.config.getFlagStore()?.on('update', (keys: string) => {
			try {
				const flagKeys = Object.values(keys);
				flagKeys.map((key) => {
					//optimistically try to delete cache for updated flag.
					logDebugMessage(`Deleting cache for flag: ${key}`);
					this.lensCache.delete(key);
				});
				this.refresh();
			} catch (err) {
				console.error('Failed to update LaunchDarkly flag lens:', err);
			}
		});
	}

	getActiveVariations(env: FlagConfiguration): unknown {
		if (!env.on) {
			const offVariation = env.offVariation !== undefined ? env.offVariation : -1;
			return [offVariation];
		} else {
			// eslint-disable-next-line no-prototype-builtins
			const allVariations = (obj: FlagConfiguration) =>
				[
					...new Set(
						obj.rules
							.concat([obj.fallthrough])
							.map((x: Fallthrough) =>
								'rollout' in x ? x.rollout?.variations?.map((v: WeightedVariation) => v.variation) : x.variation,
							)
							.flat()
							.concat(obj.targets ? obj.targets.map((x) => x.variation) : []),
					),
				].sort((a, b) => (a ?? 0) - (b ?? 0));
			return allVariations(env);
		}
	}

	getNameorValue(flag: FeatureFlag, variation: number): string {
		let flagVal;
		if (flag.variations && typeof flag.variations[variation].value === 'object') {
			flagVal = JSON.stringify(flag.variations[variation].value).substring(0, MAX_CODELENS_VALUE);
		} else if (flag.variations) {
			flagVal =
				typeof flag.variations[variation].value === 'string'
					? flag.variations[variation].value.substring(0, MAX_CODELENS_VALUE)
					: flag.variations[variation].value;
		}
		return JSON.stringify(flag.variations[variation].name) ? flag.variations[variation].name : flagVal;
	}

	public async provideCodeLenses(document: vscode.TextDocument, token: CancellationToken): Promise<vscode.CodeLens[]> {
		if (vscode.workspace.getConfiguration('launchdarkly').get('enableCodeLens', false)) {
			return this.ldCodeLens(document, token, true);
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
		const enableLens = workspace.getConfiguration('launchdarkly').get('enableCodeLens', false);
		if (token.isCancellationRequested) return codeLenses;
		let keys;
		if (this.keyCache) {
			keys = this.keyCache;
		} else {
			// Filtering keys of length less than 3 to avoid overwhelming UI.
			keys = (await this.config.getFlagStore().listFlags()).filter((key) => {
				if (key.length <= 2) {
					logDebugMessage(`Filtered out key: ${key}`);
					return false;
				}
				return true;
			});
			this.keyCache = keys;
			setTimeout(() => {
				this.keyCache = null;
			}, 50000);
		}

		let aliasesLocal: Map<string, string> | undefined;
		let aliasArr;
		try {
			if (this.config.getAliases() !== null) {
				aliasesLocal = this.config.getAliases()?.getMap();
				aliasArr = this.config.getAliases()?.getListOfMapKeys();
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
			if (prospect.length === 0) {
				continue;
			}
			let flags;
			let foundAliases;

			if (typeof keys !== 'undefined') {
				flags = keys.filter((element) => prospect.includes(element));
			}
			if (!(flags.length == 0 && firstFlagOnly) && typeof aliasesLocal !== 'undefined') {
				foundAliases = aliasArr.filter((element) => prospect.includes(element));
			}

			// Use first found flag on line for inlay codelens
			if (firstFlagOnly) {
				if (typeof aliasesLocal !== 'undefined') {
					foundAliases = aliasArr.filter((element) => prospect.includes(element));
				}

				const firstFlag =
					flags.length > 0
						? flags[0]
						: foundAliases?.length > 0 && Object.keys(aliasesLocal)?.length > 0
							? aliasesLocal[foundAliases[0]]
							: undefined;

				if (range && firstFlag) {
					codeLenses.push(new SimpleCodeLens(range, firstFlag));
				}
			} else {
				flags?.forEach((flag) => {
					const lens = new SimpleCodeLens(range, flag);
					codeLenses.push(lens);
					// Not awaiting/doing anything with response, just pre-populating cache
					if (enableLens && !this.lensCache.has(flag)) {
						this.resolveCodeLens(lens, new CancellationTokenSource().token);
					}
				});
				foundAliases?.forEach((flag) => {
					const lens = new SimpleCodeLens(range, aliasesLocal[flag]);
					codeLenses.push(lens);
					if (enableLens && !this.lensCache.has(aliasesLocal[flag])) {
						this.resolveCodeLens(lens, new CancellationTokenSource().token);
					}
				});
			}
		}

		return codeLenses;
	}

	public async resolveCodeLens(codeLens: SimpleCodeLens, token: CancellationToken): Promise<CodeLens> {
		if (!(codeLens instanceof SimpleCodeLens)) return Promise.reject<CodeLens>(undefined);

		if (token.isCancellationRequested) return codeLens;

		let flags: Dictionary<FeatureFlag>;
		const resolvedLens = this.lensCache.get(codeLens.flag);

		if (resolvedLens) {
			resolvedLens.range = codeLens.range;
			return resolvedLens;
		}

		if (this.config.getFlagStore()) {
			flags = this.flagCache ? this.flagCache : await this.config.getFlagStore()?.allFlagsMetadata();
			this.flagCache = flags;

			setTimeout(() => {
				this.flagCache = null;
			}, 50000);
		}

		// eslint-disable-next-line no-async-promise-executor
		return new Promise(async (resolve, reject) => {
			const flagEnv = await this.config.getFlagStore()?.getFlagConfig(codeLens.flag);
			const flagData = flags[codeLens.flag];

			try {
				if (flagEnv) {
					let preReq = '';
					if (flagEnv?.prerequisites.length > 0) {
						preReq = `\u2022 Prerequisites configured`;
					}
					const variations = this.getActiveVariations(flagEnv) as Array<number>;
					let flagVariations;
					switch (variations.length) {
						case 1:
							flagVariations = this.getNameorValue(flagData, variations[0]);
							break;
						case 2:
							flagVariations = `${this.getNameorValue(flagData, variations[0])}, ${this.getNameorValue(
								flagData,
								variations[1],
							)}`;
							break;
						default:
							flagVariations = `${variations.length} variations`;
							break;
					}
					let offVariation;
					if (flagEnv.offVariation !== undefined) {
						offVariation = `${JSON.stringify(this.getNameorValue(flagData, flagEnv.offVariation))} - off variation`;
					} else {
						offVariation = '**Code Fallthrough(No off variation set)**';
					}
					const clientSDK = flagData.clientSideAvailability.usingEnvironmentId ? '$(browser)' : '';
					const mobileSDK = flagData.clientSideAvailability.usingMobileKey ? '$(device-mobile)' : '';
					const clientAvailability = [clientSDK, mobileSDK].filter(Boolean).join(' ') || '';

					const newLens = new CodeLens(codeLens.range);
					newLens.command = {
						title: `$(launchdarkly-logo) ${flagEnv.key} \u2022 ${clientAvailability} Serving: ${
							flagEnv.on ? flagVariations : offVariation
						} ${preReq}`,
						command: '',
					};
					this.lensCache.set(flagEnv.key, newLens);
					resolve(newLens);
				}
				//return newLens;
			} catch (err) {
				console.log(err);
				reject(err);
			}
		});
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
	constructor(range: vscode.Range, flag: string, command?: vscode.Command | undefined) {
		super(range, command);
		this.flag = flag;
	}
}

class LensCache {
	private cache: Map<string, { value: CodeLens; timeoutId: NodeJS.Timeout }>;
	private ttl: number;

	constructor(ttl: number) {
		this.cache = new Map();
		this.ttl = ttl;
	}

	get(key: string) {
		const data = this.cache.get(key);
		if (data) {
			return data.value;
		}
	}

	has(key: string) {
		return this.cache.has(key);
	}

	set(key: string, value: CodeLens) {
		const timeoutId = setTimeout(() => {
			this.cache.delete(key);
		}, this.ttl);
		this.cache.set(key, { value, timeoutId });
	}

	delete(key: string) {
		const data = this.cache.get(key);
		if (data) {
			clearTimeout(data.timeoutId);
			this.cache.delete(key);
		}
	}
}
