import * as vscode from 'vscode';
import { FlagStore } from '../flagStore';
import { FeatureFlag } from 'launchdarkly-api-typescript';
import { FlagAliases } from './codeRefs';

/** Code that is used to associate diagnostic entries with code actions. */
export const CLIENT_SIDE_MENTION = 'ld_clientside_flag';

/**
 * Analyzes the text document for flags that should be marked available to client side.
 * @param doc text document to analyze
 * @param clientSideDiagnostic diagnostic collection
 */
export async function refreshDiagnostics(
	doc: vscode.TextDocument,
	clientSideDiagnostics: vscode.DiagnosticCollection,
	aliasesStore: FlagAliases,
	flagStore: FlagStore,
): Promise<void> {
	const diagnostics: vscode.Diagnostic[] = [];
	let flags;
	if (flagStore && checkFilename(vscode.window.activeTextEditor.document.fileName)) {
		flags = await flagStore.allFlagsMetadata();
	} else {
		return;
	}
	const regex = /(.+)/g;
	let matches;
	let aliasesLocal: Map<string, string>;
	let aliasArr;
	try {
		if (typeof aliasesStore !== 'undefined') {
			aliasesLocal = aliasesStore.getMap();
			aliasArr = aliasesStore.getListOfMapKeys();
		}
	} catch (err) {
		console.log(err);
	}
	for (let lineIndex = 0; lineIndex < doc.lineCount; lineIndex++) {
		const lineOfText = doc.lineAt(lineIndex);
		while ((matches = regex.exec(lineOfText.text)) !== null) {
			const indexOf = lineOfText.text.indexOf(matches[0]);
			if (indexOf == -1) {
				continue;
			}
			const position = new vscode.Position(lineIndex, indexOf);
			const range = doc.getWordRangeAtPosition(position, new RegExp(regex));
			const prospect = doc.getText(range);
			let flag;
			const keys = Object.keys(flags);
			if (typeof keys !== 'undefined') {
				flag = keys.filter(element => prospect.includes(element));
			}
			let foundAliases;
			if (typeof aliasesLocal !== 'undefined') {
				foundAliases = aliasArr.filter(element => prospect.includes(element));
			}

			// Use first found flag
			const firstFlag = flag[0];
			if (range && typeof flag !== 'undefined' && flags[firstFlag]) {
				const getFlag = flags[firstFlag] as FeatureFlag;
				if (getFlag.clientSideAvailability?.usingEnvironmentId == false || getFlag.includeInSnippet == false) {
					diagnostics.push(createDiagnostic(doc, lineOfText, lineIndex, getFlag.key, getFlag.key));
				}
			} else if (range && foundAliases?.length > 0 && flags[aliasesLocal[foundAliases]]) {
				if (
					flags[aliasesLocal[foundAliases]].clientSideAvailability?.usingEnvironmentId == false ||
					flags[aliasesLocal[foundAliases]].includeInSnippet == false
				) {
					diagnostics.push(
						createDiagnostic(doc, lineOfText, lineIndex, foundAliases, flags[aliasesLocal[foundAliases].key]),
					);
				}
			}
		}
	}

	clientSideDiagnostics.set(doc.uri, diagnostics);
}

function createDiagnostic(
	doc: vscode.TextDocument,
	lineOfText: vscode.TextLine,
	lineIndex: number,
	element: string,
	flagKey: string,
): vscode.Diagnostic {
	const index = lineOfText.text.indexOf(element);

	// create range that represents, where in the document the word is
	const range = new vscode.Range(lineIndex, index, lineIndex, index + element.length);

	const diagnostic = new vscode.Diagnostic(
		range,
		'Feature Flag is not enabled on the client side',
		vscode.DiagnosticSeverity.Warning,
	);
	diagnostic.code = CLIENT_SIDE_MENTION;
	const relatedInfo: vscode.DiagnosticRelatedInformation = {
		location: { uri: vscode.Uri.parse('https://app.launchdarkly.com'), range: range },
		message: flagKey,
	};
	diagnostic.relatedInformation = [relatedInfo];
	return diagnostic;
}

export async function subscribeToDocumentChanges(
	context: vscode.ExtensionContext,
	clientSideDiagnostics: vscode.DiagnosticCollection,
	aliases: FlagAliases,
	flagStore: FlagStore,
): Promise<void> {
	if (vscode.window.activeTextEditor && checkFilename(vscode.window.activeTextEditor.document.fileName)) {
		try {
			await refreshDiagnostics(vscode.window.activeTextEditor.document, clientSideDiagnostics, aliases, flagStore);
		} catch (err) {
			console.log(err);
		}

		context.subscriptions.push(
			vscode.window.onDidChangeActiveTextEditor(editor => {
				if (editor) {
					try {
						refreshDiagnostics(vscode.window.activeTextEditor.document, clientSideDiagnostics, aliases, flagStore);
					} catch (err) {
						console.log(err);
					}
				}
			}),
		);

		context.subscriptions.push(
			vscode.workspace.onDidChangeTextDocument(e =>
				refreshDiagnostics(e.document, clientSideDiagnostics, aliases, flagStore),
			),
		);
	}

	context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(doc => clientSideDiagnostics.delete(doc.uri)));
}

const checkFilename = (filename: string): boolean => {
	return new RegExp('.*.(jsx?|tsx?)$').test(filename);
};

/**
 * Provides code actions corresponding to diagnostic problems.
 */
export class ClientSideEnable implements vscode.CodeActionProvider {
	public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

	provideCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range | vscode.Selection,
		context: vscode.CodeActionContext,
		token: vscode.CancellationToken,
	): vscode.CodeAction[] {
		// for each diagnostic entry that has the matching `code`, create a code action command
		return context.diagnostics
			.filter(diagnostic => diagnostic.code === CLIENT_SIDE_MENTION)
			.map(diagnostic => this.createCommandCodeAction(diagnostic));
	}

	private createCommandCodeAction(diagnostic: vscode.Diagnostic): vscode.CodeAction {
		const action = new vscode.CodeAction(
			'Enable LaunchDarkly Feature Flag for client-side usage.',
			vscode.CodeActionKind.QuickFix,
		);
		action.command = {
			command: 'launchdarkly.enableClientSide',
			title: 'Enable client-side on flag',
			tooltip: 'This will enable flag for the client-side usage.',
			arguments: [diagnostic.relatedInformation[0].message],
		};
		action.diagnostics = [diagnostic];
		action.isPreferred = true;
		return action;
	}
}
