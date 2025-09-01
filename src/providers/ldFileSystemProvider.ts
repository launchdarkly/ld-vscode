/* eslint-disable @typescript-eslint/no-unused-vars */
import { LDExtensionConfiguration } from '../ldExtensionConfiguration';
import {
	Disposable,
	Event,
	EventEmitter,
	FileChangeEvent,
	FileStat,
	FileSystemError,
	FileSystemProvider,
	FileType,
	Uri,
	window,
	workspace,
} from 'vscode';

export class LaunchDarklyFileSystemProvider implements FileSystemProvider {
	private _onDidChangeFile: EventEmitter<FileChangeEvent[]> = new EventEmitter<FileChangeEvent[]>();
	readonly onDidChangeFile: Event<FileChangeEvent[]> = this._onDidChangeFile.event;
	private config: LDExtensionConfiguration;
	private _data: Map<string, Uint8Array>;

	constructor(ldConfig: LDExtensionConfiguration) {
		this.config = ldConfig;
		this._data = new Map();
	}

	watch(): Disposable {
		return {
			dispose: () => {},
		};
	}

	async stat(uri: Uri): Promise<FileStat> {
		const pathSplit = uri.path.split('/');
		const flag = await this.config.getFlagStore()?.getFeatureFlag(pathSplit[1]);

		for (const variation of flag.flag.variations) {
			if (variation._id === pathSplit[2]) {
				return {
					type: FileType.File,
					size: null,
					mtime: null,
					ctime: null,
				};
			}
		}

		throw FileSystemError.FileNotFound(uri);
	}

	async readDirectory(uri: Uri): Promise<[string, FileType][]> {
		const flagEntries: [string, FileType][] = [];
		// Grab the flag name from the path, it's always after root.
		const flag = uri.path.split('/').slice(1)[0];
		const flagFromLocal = await this.config.getFlagStore().getFeatureFlag(flag);
		flagFromLocal.flag.variations.forEach((variation, idx) => {
			flagEntries.push([variation.name ? variation.name : idx.toString(), FileType.File]);
		});
		return flagEntries;
	}

	createDirectory(_uri: Uri): void | Thenable<void> {
		throw new Error('Creating directories via LaunchDarkly extension is not supported.');
	}

	async readFile(uri: Uri): Promise<Uint8Array> {
		const pathSplit = uri.path.split('/');
		const flag = await this.config.getFlagStore()?.getFeatureFlag(pathSplit[1]);

		let foundVariation;
		for (const variation of flag.flag.variations) {
			if (variation._id === pathSplit[2]) {
				foundVariation = variation.value;
				break;
			}
		}

		let stringifiedVariation;
		switch (typeof flag.flag.variations[0].value) {
			case 'object': {
				const editorConfig = workspace.getConfiguration('editor');
				const tabSize = editorConfig.get('tabSize');
				stringifiedVariation = JSON.stringify(foundVariation, null, tabSize as number);
				break;
			}
			case 'string':
				stringifiedVariation = foundVariation;
				break;
			case 'number':
				stringifiedVariation = foundVariation.toString();
				break;
			default:
				break;
		}
		return Buffer.from(stringifiedVariation, 'utf8');
	}

	async writeFile(uri: Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean }): Promise<void> {
		const [_, flagKey, variationId] = uri.path.split('/');

		const confirmation = await window.showInformationMessage(
			`Are you sure you want to update the feature flag variation?`,
			{ modal: true },
			'Yes',
		);
		if (confirmation !== 'Yes') {
			throw new Error('Variation update was cancelled by the user.');
		}
		const flag = await this.config.getFlagStore()?.getFeatureFlag(flagKey);
		try {
			let updateValue;
			switch (typeof flag.flag.variations[0].value) {
				case 'object':
					updateValue = JSON.parse(content.toString());
					break;
				case 'string':
					updateValue = content.toString();
					break;
				case 'number':
					updateValue = parseInt(content.toString());
					break;
				default:
					break;
			}

			await this.config
				.getFlagStore()
				.executeAndUpdateFlagStore(
					this.config.getApi().patchFlagVariation.bind(this.config.getApi()),
					this.config.getConfig().project,
					flagKey,
					updateValue,
					variationId,
				);
			this._data.delete(uri.fsPath);
		} catch (e) {
			throw new Error(`Error updating flag variation: ${e}`);
		}
	}

	delete(uri: Uri, options: { recursive: boolean }): void | Thenable<void> {
		throw new Error('Method not implemented.');
	}

	rename(oldUri: Uri, newUri: Uri, options: { overwrite: boolean }): void | Thenable<void> {
		throw new Error('Method not implemented.');
	}
}
