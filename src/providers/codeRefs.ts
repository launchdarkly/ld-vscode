import { EventEmitter, ExtensionContext, StatusBarAlignment, StatusBarItem, window, workspace } from 'vscode';
import { exec, ExecOptions } from 'child_process';
import { createReadStream } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import csv from 'csv-parser';
import { CodeRefs } from '../coderefs/codeRefsVersion';
import { legacyAuth } from '../utils/legacyAuth';
import { ILDExtensionConfiguration } from '../models';
import { CONST_LD_PREFIX } from '../utils/constants';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { promises: Fs } = require('fs');

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs').promises;

type FlagAlias = {
	flagKey: string;
	path: string;
	startingLineNumber: string;
	lines: string;
	aliases: string;
};

export class FlagAliases {
	private config: ILDExtensionConfiguration;
	private ctx: ExtensionContext;
	public readonly aliasUpdates: EventEmitter<boolean | null> = new EventEmitter();
	map = new Map();
	keys = new Map();
	private statusBar: StatusBarItem;

	constructor(config: ILDExtensionConfiguration) {
		this.config = config;
		// this.ctx = ctx;
		// this.ldConfig = ldConfig;
	}
	aliases: Array<string>;

	async start(): Promise<void> {
		const intConfig = this.config?.getConfig();
		if (intConfig && (await intConfig.isConfigured())) {
			const aliasFile = await workspace.findFiles('.launchdarkly/coderefs.yaml');
			if (intConfig.codeRefsRefreshRate && aliasFile.length > 0) {
				this.generateAndReadAliases();
				if (intConfig.validateRefreshInterval(intConfig.codeRefsRefreshRate)) {
					this.startCodeRefsUpdateTask(intConfig.codeRefsRefreshRate);
				} else {
					window.showErrorMessage(
						`Invalid Refresh time (in Minutes): '${intConfig.codeRefsRefreshRate}'. 0 is off, up to 1440 for one day.`,
					);
				}
			}
		}
	}

	exec(command: string, options: ExecOptions): Promise<{ stdout: string; stderr: string }> {
		return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
			exec(command, options, (error, stdout, stderr) => {
				if (error) {
					reject({ error, stdout, stderr });
				}
				resolve({ stdout, stderr });
			});
		});
	}

	private async startCodeRefsUpdateTask(interval: number) {
		const ms = interval * 60 * 1000;
		setInterval(() => {
			this.generateAndReadAliases();
		}, ms);
	}

	getKeys(): Map<string, string> | undefined {
		return this.config.getCtx().workspaceState.get('aliasKeys');
	}

	getListOfMapKeys(): Array<string> | undefined {
		return this.config.getCtx().workspaceState.get('aliasListOfMapKeys');
	}

	getMap(): Map<string, string> | undefined {
		return this.config.getCtx().workspaceState.get('aliasMap');
	}

	async getCodeRefsBin(): Promise<string> {
		const intConfig = this.config.getConfig();
		if (!intConfig) {
			return '';
		}
		try {
			await Fs.access(join(this.config.getCtx().asAbsolutePath('coderefs'), `${CodeRefs.version}/ld-find-code-refs`));
			let codeRefsBin = `${this.config.getCtx().asAbsolutePath('coderefs')}/${CodeRefs.version}/ld-find-code-refs`;
			if (process.platform == 'win32') {
				codeRefsBin = `${codeRefsBin}.exe`;
			}
			return codeRefsBin;
		} catch (err) {
			return intConfig.codeRefsPath ? intConfig.codeRefsPath : '';
		}
	}

	async generateCsv(directory: string, outDir: string, repoName: string): Promise<void> {
		const session = this.config.getSession();
		const intConfig = this.config.getConfig();
		if (!session || !intConfig) {
			return;
		}
		const apiToken = legacyAuth() ? session.accessToken : `Bearer ${session.accessToken}`;
		try {
			const codeRefsBin = await this.getCodeRefsBin();
			const command = `${codeRefsBin} --dir="${directory}" --dryRun --outDir="${outDir}" --projKey="${intConfig.project}" --repoName="${repoName}" --baseUri="${session.fullUri}" --contextLines=-1 --branch=scan --revision=0`;
			const output = await this.exec(command, {
				env: { LD_ACCESS_TOKEN: apiToken, GOMAXPROCS: '1' },
				timeout: 20 * 60000,
			});
			if (output.stderr) {
				window.showErrorMessage(`${CONST_LD_PREFIX} finding Code References failed ${output.stderr}`);
			}
		} catch (err) {
			window.showErrorMessage(err.error);
			console.error(err);
		}
	}

	async generateAndReadAliases(directory = workspace.workspaceFolders?.[0] ?? null): Promise<void> {
		if (!directory || !this.config.getSession()) {
			return;
		}
		const refsDir = directory.uri.fsPath;
		if (refsDir === '') {
			return;
		}
		const tmpDir = await fs.mkdtemp(join(tmpdir(), 'ld-'));
		const tmpRepo = 'tmpRepo';
		this.statusBar.text = `LaunchDarkly: Generating aliases`;
		this.statusBar.show();
		await this.generateCsv(refsDir, tmpDir, tmpRepo);
		const aliasFile = join(tmpDir, `coderefs__${tmpRepo}_scan.csv`);
		fs.access(aliasFile, fs.F_OK, (err) => {
			if (err) {
				this.statusBar.hide();
				return;
			}
			createReadStream(aliasFile)
				.pipe(csv())
				.on('data', (row: FlagAlias) => {
					const findKey = this.keys[row.flagKey];
					const aliases = row.aliases.split(' ');
					if (findKey === undefined) {
						this.keys[row.flagKey] = [...new Set(aliases)].filter(Boolean);
					} else {
						const items = [...findKey, ...aliases];
						this.keys[row.flagKey] = [...new Set(items)].filter(Boolean);
					}
					aliases.map((alias) => {
						if (alias == '') {
							return;
						}
						this.map[alias] = row.flagKey;
					});
				})
				.on('end', () => {
					this.config.getCtx().workspaceState.update('aliasMap', this.map);
					this.config.getCtx().workspaceState.update('aliasKeys', this.keys);
					const mapKeys = Object.keys(this.map)
						.filter((element) => element != '')
						.sort();
					this.config.getCtx().workspaceState.update('aliasListOfMapKeys', mapKeys);
					this.aliasUpdates.fire(true);
					this.statusBar.hide();
					fs.rm(tmpDir, { recursive: true });
				})
				.on('error', function () {
					console.log('Code Refs file does not exist');
					this.statusBar.hide();
				});
		});
	}

	async codeRefsVersionCheck(): Promise<boolean> {
		try {
			const codeRefsBin = await this.getCodeRefsBin();
			if (!codeRefsBin) {
				return false;
			}
			const command = `${codeRefsBin} --version`;
			const output = await this.exec(command, {});
			if (output.stderr) {
				window.showErrorMessage(output.stderr);
				return false;
			}
			const version = output.stdout.split(' ')[2].split('.');
			if (Number(version[0]) > 2) {
				return true;
			} else {
				return false;
			}
		} catch (err) {
			window.showErrorMessage(err.error);
			console.error(err);
			return false;
		}
	}

	setupStatusBar(): void {
		this.statusBar = window.createStatusBarItem(StatusBarAlignment.Right, 100);
		this.config.getCtx().subscriptions.push(this.statusBar);
	}
}
