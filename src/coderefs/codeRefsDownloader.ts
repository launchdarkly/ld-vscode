/* eslint-disable @typescript-eslint/no-var-requires */
import { ExtensionContext } from 'vscode';
import { mkdirSync, createWriteStream, existsSync, unlinkSync, createReadStream } from 'fs';
import { CodeRefs } from './codeRefsVersion';
import * as rr from 'rimraf';
import * as tar from 'tar-fs';
import axios from 'axios';
const gunzip = require('gunzip-maybe');

export class CodeRefsDownloader {
	private ctx: ExtensionContext;
	private downloadDir: string;

	constructor(ctx: ExtensionContext, downloadDir: string) {
		this.ctx = ctx;
		this.downloadDir = downloadDir;
	}

	async download(): Promise<void> {
		const dir = this.ctx.asAbsolutePath('coderefs');
		const codeRefsPath = this.ctx.asAbsolutePath(`coderefs/coderefs-${CodeRefs.version}.tar.gz`);

		// Remove all previous versions of the binary
		try {
			await new Promise(resolve => rr(`${dir}/*`, resolve));
		} catch (err) {
			console.log(`No previous version of code references installed`);
		}
		this.installDir(dir, codeRefsPath);
	}

	async installDir(dir: string, codeRefsPath: string): Promise<void> {
		let platform = process.platform.toString();
		if (platform === 'win32') {
			platform = 'windows';
		}
		let arch: string;
		switch (process.arch) {
			case 'x64':
				arch = 'amd64';
				break;
			case 'ia32':
				arch = '386';
				break;
		}
		if (!existsSync(dir)) {
			mkdirSync(dir);
		}
		if (!existsSync(this.downloadDir)) {
			mkdirSync(this.downloadDir);
		}
		const file = createWriteStream(codeRefsPath);
		try {
			const archivedFile = await axios.get(
				`https://github.com/launchdarkly/ld-find-code-refs/releases/download/${CodeRefs.version}/ld-find-code-refs_${CodeRefs.version}_${platform}_${arch}.tar.gz`,
				{
					method: 'GET',
				},
			);
			file.write(archivedFile);
			file.end();
		} catch (err) {
			console.log(err);
		}
		try {
			createReadStream(codeRefsPath)
				.pipe(gunzip())
				.pipe(tar.extract(this.downloadDir));
			unlinkSync(codeRefsPath);
		} catch (err) {
			console.log(err);
		}
	}
}
