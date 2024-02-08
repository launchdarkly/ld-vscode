import { CompletionItemProvider, TextDocument, Position, CompletionItem, CompletionItemKind, Range } from 'vscode';
import { FLAG_KEY_REGEX } from '../providers';
import { IFlagStore, IConfiguration, IFlagAliases } from '../models';

export const STRING_DELIMITERS = ['"', "'", '`'];

export default class LaunchDarklyCompletionItemProvider implements CompletionItemProvider {
	private readonly flagStore: IFlagStore;
	private readonly config: IConfiguration;
	private readonly aliases?: IFlagAliases;

	constructor(config: IConfiguration, flagStore: IFlagStore, aliases?: IFlagAliases) {
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
	return STRING_DELIMITERS.indexOf(candidate) !== -1;
}

const candidateTextStartLocation = (char: number) => (char === 1 ? 0 : char - 2);
