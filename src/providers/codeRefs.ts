import { EventEmitter, ExtensionContext, StatusBarAlignment, StatusBarItem, window, workspace } from 'vscode';
import { exec, ExecOptions } from 'child_process';
import { access, createReadStream, constants } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import * as csv from 'csv-parser';
import { Configuration } from '../configuration';
import { CodeRefs } from '../coderefs/codeRefsVersion';

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
	private config: Configuration;
	private ctx: ExtensionContext;
	public readonly aliasUpdates: EventEmitter<boolean | null> = new EventEmitter();
	map = new Map();
	keys = new Map();
	private statusBar: StatusBarItem;

	constructor(config: Configuration, ctx: ExtensionContext) {
		this.config = config;
		this.ctx = ctx;
	}
	aliases: Array<string>;

	async start(): Promise<void> {
		const aliasFile = await workspace.findFiles('.launchdarkly/coderefs.yaml');
		if (this.config.codeRefsRefreshRate && aliasFile.length > 0) {
			this.generateAndReadAliases();
			if (this.config.validateRefreshInterval(this.config.codeRefsRefreshRate)) {
				this.startCodeRefsUpdateTask(this.config.codeRefsRefreshRate);
			} else {
				window.showErrorMessage(
					`Invalid Refresh time (in Minutes): '${this.config.codeRefsRefreshRate}'. 0 is off, up to 1440 for one day.`,
				);
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

	getKeys(): Map<string, string> {
		return this.ctx.workspaceState.get('aliasKeys');
	}

	getListOfMapKeys(): Array<string> {
		return this.ctx.workspaceState.get('aliasListOfMapKeys');
	}

	getMap(): Map<string, string> {
		return this.ctx.workspaceState.get('aliasMap');
	}

	async getCodeRefsBin(): Promise<string> {
		await access(
			join(this.ctx.asAbsolutePath('coderefs'), `${CodeRefs.version}/ld-find-code-refs`),
			constants.F_OK,
			err => {
				if (err) {
					return this.config.codeRefsPath ? this.config.codeRefsPath : '';
				}
			},
		);
		let codeRefsBin = `${this.ctx.asAbsolutePath('coderefs')}/${CodeRefs.version}/ld-find-code-refs`;
		if (process.platform == 'win32') {
			codeRefsBin = `${codeRefsBin}.exe`;
		}
		return codeRefsBin;
	}

	async generateCsv(directory: string, outDir: string, repoName: string): Promise<void> {
		try {
			const codeRefsBin = await this.getCodeRefsBin();
			const command = `${codeRefsBin} --dir="${directory}" --dryRun --outDir="${outDir}" --projKey="${this.config.project}" --repoName="${repoName}" --baseUri="${this.config.baseUri}" --contextLines=-1 --branch=scan --revision=0`;
			const output = await this.exec(command, {
				env: { LD_ACCESS_TOKEN: this.config.accessToken, GOMAXPROCS: 1 },
				timeout: 20 * 60000,
			});
			if (output.stderr) {
				window.showErrorMessage(output.stderr);
			}
		} catch (err) {
			window.showErrorMessage(err.error);
			console.error(err);
		}
	}

	async generateAndReadAliases(directory = workspace.workspaceFolders[0]): Promise<void> {
		const refsDir = directory.uri.fsPath;
		if (refsDir === '') {
			return;
		}
		const tmpDir = await fs.mkdtemp(join(tmpdir(), 'ld-'));
		const tmpRepo = 'tmpRepo';
		this.statusBar.text = `LaunchDarkly: Generating aliases`;
		this.statusBar.show();
		await this.generateCsv(refsDir, tmpDir, tmpRepo);
		const aliasFile = join(tmpDir, `coderefs_${this.config.project}_${tmpRepo}_scan.csv`);
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
				aliases.map(alias => {
					if (alias == '') {
						return;
					}
					this.map[alias] = row.flagKey;
				});
			})
			.on('end', () => {
				console.log(this.map);
				this.ctx.workspaceState.update('aliasMap', this.map);
				this.ctx.workspaceState.update('aliasKeys', this.keys);
				const mapKeys = Object.keys(this.map).filter(element => element != '');
				this.ctx.workspaceState.update('aliasListOfMapKeys', mapKeys);
				this.aliasUpdates.fire(true);
				this.statusBar.hide();
				fs.rmdir(tmpDir, { recursive: true });
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
		this.ctx.subscriptions.push(this.statusBar);
	}
}
