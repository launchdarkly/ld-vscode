import { CompletionItemProvider, TextDocument, Position, CompletionItem, CompletionItemKind, Range } from 'vscode';
import { Configuration } from '../configuration';
import { FlagStore } from '../flagStore';
import { FLAG_KEY_REGEX } from '../providers';
import { FlagAliases } from './codeRefs';

const STRING_DELIMETERS = ['"', "'", '`'];

export default class LaunchDarklyCompletionItemProvider implements CompletionItemProvider {
	private readonly flagStore: FlagStore;
	private readonly config: Configuration;
	private readonly aliases?: FlagAliases;

	constructor(config: Configuration, flagStore: FlagStore, aliases?: FlagAliases) {
		this.config = config;
		this.flagStore = flagStore;
		this.aliases = aliases;
	}

	public provideCompletionItems(document: TextDocument, position: Position): Thenable<CompletionItem[]> {
		if (isPrecedingCharStringDelimiter(document, position)) {
			// eslint-disable-next-line no-async-promise-executor
			return new Promise(async (resolve) => {
				if (this.config.enableAutocomplete) {
					const flags = await this.flagStore.allFlagsMetadata();
					const flagCompletes = [];
					// eslint-disable-next-line @typescript-eslint/no-unused-vars
					for (const [key, flag] of Object.entries(flags)) {
						const flagCompletion = new CompletionItem(flag.key, CompletionItemKind.Field);
						flagCompletion.detail = flag.description ? flag.description : '';
						flagCompletes.push(flagCompletion);
					}
					resolve(flagCompletes);
					return;
				}
				resolve(null);
			});
		}
	}
}

export function isPrecedingCharStringDelimiter(document: TextDocument, position: Position): boolean {
	const range = document.getWordRangeAtPosition(position, FLAG_KEY_REGEX);
	if (!range || !range.start || range.start.character === 0) {
		return false;
	}
	const c = new Range(
		range.start.line,
		candidateTextStartLocation(range.start.character),
		range.start.line,
		range.start.character,
	);
	const candidate = document.getText(c).trim().replace('(', '');
	return STRING_DELIMETERS.indexOf(candidate) !== -1;
}

const candidateTextStartLocation = (char: number) => (char === 1 ? 0 : char - 2);
