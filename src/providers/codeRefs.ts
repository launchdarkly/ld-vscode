import { EventEmitter, window, workspace } from 'vscode';
import { exec, ExecOptions } from 'child_process';
import { createReadStream } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import * as csv from 'csv-parser';
import { Configuration } from '../configuration';

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
	public readonly aliasUpdates: EventEmitter<boolean | null> = new EventEmitter();
	map = new Map();
	keys = new Map();

	constructor(config: Configuration) {
		this.config = config;
	}
	aliases: Array<string>;

	async start(): Promise<void> {
		this.generateAndReadAliases();
		if (this.config.refreshRate) {
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

	async generateCsv(directory: string, outDir: string, repoName: string): Promise<void> {
		try {
			const command = `${this.config.codeRefsPath} --dir="${directory}" --dryRun --outDir="${outDir}" --projKey="${this.config.project}" --repoName="${repoName}" --baseUri="${this.config.baseUri}" --contextLines=-1 --branch=scan --revision=0`;
			const output = await this.exec(command, { env: { LD_ACCESS_TOKEN: this.config.accessToken } });
			if (output.stderr) {
				window.showErrorMessage(output.stderr);
			}
		} catch (err) {
			window.showErrorMessage(err.error);
			console.error(err);
		}
	}

	async generateAndReadAliases(directory = workspace.workspaceFolders[0]): Promise<void> {
		const refsDir = directory.uri.toString().split(':', 2);
		if (refsDir[0] !== 'file') {
			return;
		}
		const tmpDir = await fs.mkdtemp(join(tmpdir(), 'ld-'));
		const tmpRepo = 'tmpRepo';
		await this.generateCsv(refsDir[1], tmpDir, tmpRepo);
		const aliasFile = `${tmpDir}/coderefs_${this.config.project}_${tmpRepo}_scan.csv`;
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
					this.map[alias] = row.flagKey;
				});
			})
			.on('end', () => {
				this.aliasUpdates.fire(true);
				fs.rmdir(tmpDir, { recursive: true });
			});
	}
}
