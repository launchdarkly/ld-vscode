import * as vscode from 'vscode';
import {
	DecorationOptions,
	Diagnostic,
	DiagnosticCollection,
	DiagnosticSeverity,
	Disposable,
	Range,
	TextEditor,
	TextEditorDecorationType,
	window,
	workspace,
} from 'vscode';

import { ILDExtensionConfiguration, StaleConfig } from '../models';
import { FlagCodeLensProvider, SimpleCodeLens } from './flagLens';
import { CopilotProvider } from './copilot';

import { isFlagReadyForCleanupCheck } from '../utils/isFlagReadyForCleanup';
import { debounce } from 'lodash';
import { logDebugMessage } from '../utils/logDebugMessage';

export interface FlagNode {
	flagKey: string;
	ranges: Range[];
}

export class FlagCleanupEditorLens implements Disposable {
	private ldConfig: ILDExtensionConfiguration;
	private lens: FlagCodeLensProvider;
	private flagMap: Map<string, FlagNode> = new Map();
	private disposables: Disposable[] = [];
	private cleanupFlagDecorationType: TextEditorDecorationType;
	private diagnostics: DiagnosticCollection;
	private copilot: CopilotProvider;
	private yamlConfig: StaleConfig = {
		days: 10,
		checkRulesInCriticalEnvs: true,
		skipCriticalEnvironmentsCheck: false,
		skipReleasePipelinesCheck: true,
	};

	constructor(_ldConfig_: ILDExtensionConfiguration, _lens_: FlagCodeLensProvider) {
		this.ldConfig = _ldConfig_;
		this.lens = _lens_;

		this.copilot = new CopilotProvider(_ldConfig_);
		this.cleanupFlagDecorationType = window.createTextEditorDecorationType({
			textDecoration: 'underline wavy editorWarning.foreground',
		});

		this.diagnostics = vscode.languages.createDiagnosticCollection('flagCleanup');

		const editor = window.activeTextEditor;
		if (!editor || !editor.document) {
			return;
		}

		this.disposables.push(this.cleanupFlagDecorationType, this.diagnostics);
		const debouncedInit = debounce(
			() => {
				this.init();
			},
			500,
			{ leading: false, trailing: true },
		);
		window.onDidChangeActiveTextEditor(this.init, this);
		vscode.workspace.onDidChangeTextDocument((event: vscode.TextDocumentChangeEvent) => {
			const activeEditor = vscode.window.activeTextEditor;
			if (activeEditor && event.document.uri.toString() === activeEditor.document.uri.toString()) {
				debouncedInit();
			}
		});
		this.init();
	}

	dispose() {
		this.disposables.forEach((_disposable_) => _disposable_.dispose());
		this.cleanupFlagDecorationType.dispose();
		this.diagnostics.dispose();
	}

	private async init() {
		const yamlConfig: StaleConfig = await this.ldConfig.getConfig().getStaleConfig();

		// Compare the current YAML configuration with the previous one
		if (JSON.stringify(yamlConfig) !== JSON.stringify(this.yamlConfig)) {
			this.yamlConfig = yamlConfig;
			// Clear the diagnostic collection if the YAML configuration has changed
			this.diagnostics.clear();
		}

		await this.setFlagsInDocument(this.yamlConfig);
	}

	public setFlagsInDocument = async (yamlConfig?: StaleConfig): Promise<void> => {
		if (workspace.getConfiguration('launchdarkly').get('enableStaleFlagCheck') === false) {
			this.flagMap.clear();
			this.diagnostics.clear();
			return;
		}

		const editor = window.activeTextEditor;

		if (!editor || !editor?.document) {
			return;
		}

		this.flagMap.clear();
		const cancellationTokenSource = new vscode.CancellationTokenSource();
		const flagsFound = await this.lens.ldCodeLens(editor.document, cancellationTokenSource.token, true);
		const simpleFlagsFound: SimpleCodeLens[] = flagsFound as unknown as SimpleCodeLens[];

		if (!simpleFlagsFound) {
			return;
		}

		for (const flag of simpleFlagsFound) {
			const flagKey = flag.flag;
			if (flagKey) {
				if (this.flagMap.has(flagKey)) {
					this.flagMap.get(flagKey)?.ranges.push(flag.range);
				} else {
					const ranges: Range[] = [flag.range];
					this.flagMap.set(flagKey, { flagKey, ranges });
				}
			}
		}

		await this.highlightFlagsForCleanup(editor, this.flagMap, yamlConfig);
	};

	private async getFlagRefsAcrossFiles(flagKey: string, range: vscode.Range): Promise<Map<string, vscode.Range[]>> {
		const newReferences = new Map<string, vscode.Range[]>();

		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return newReferences;
		}

		const document = editor.document;
		const position = range.start;

		try {
			const references = await vscode.commands.executeCommand<vscode.Location[]>(
				'vscode.executeReferenceProvider',
				document.uri,
				position,
			);

			if (references) {
				references.forEach(() => {
					if (!newReferences.has(flagKey)) {
						newReferences.set(flagKey, []);
					}
				});
			} else {
				logDebugMessage('No references found.');
			}
		} catch (error) {
			console.error('Error finding references:', error);
		}

		return newReferences;
	}

	private async highlightFlagsForCleanup(
		_editor_: TextEditor,
		_flagMap_: Map<string, FlagNode>,
		yamlConfig?: StaleConfig,
	): Promise<void> {
		const flagsToRemove: FlagNode[] = [];
		const decorations: DecorationOptions[] = [];
		const diagnostics: Diagnostic[] = [];

		for (const [flagKey, flagNode] of _flagMap_.entries()) {
			logDebugMessage(`checking flag... ${flagKey}`);
			const checkData = await isFlagReadyForCleanupCheck(this.ldConfig, flagKey, yamlConfig);
			logDebugMessage(`${checkData.result}, ${checkData.reason}`);
			if (checkData.result) {
				flagNode.ranges.forEach((_range_) => {
					decorations.push({
						range: _range_,
					});
					const diagnostic = new Diagnostic(
						_range_,
						`Flag "${flagKey}" is ready for cleanup.`,
						DiagnosticSeverity.Warning,
					);
					diagnostic.code = flagKey; // Set a unique code for each diagnostic
					diagnostics.push(diagnostic);
					flagsToRemove.push(flagNode);
				});
			}
		}

		logDebugMessage(`flags to remove: ${flagsToRemove}`);

		_editor_.setDecorations(this.cleanupFlagDecorationType, decorations);
		this.diagnostics.set(_editor_.document.uri, diagnostics);
	}
}
