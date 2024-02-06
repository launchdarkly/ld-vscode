/* eslint-disable @typescript-eslint/no-unused-vars */
import { expect } from 'chai';
import * as vscode from 'vscode';
import { FlagCodeLensProvider, SimpleCodeLens } from '../src/providers/flagLens';
import { FeatureFlag, FlagConfiguration } from '../src/models'; // Import these from your actual models file
import { Configuration } from '../src/configuration';
import { FlagStore } from '../src/flagStore';
import { instance, mock, when } from 'ts-mockito';
import { FlagAliases } from '../src/providers/codeRefs';
import { LDExtensionConfiguration } from '../src/ldExtensionConfiguration';
import { EndOfLine, Position, Uri } from 'vscode';

const flag: FeatureFlag = {
	key: 'test',
	name: 'test',
	description: 'test',
	kind: 'boolean',
	variations: [
		{ name: 'false variation', value: false },
		{ name: 'true variation', value: true },
	],
	clientSideAvailability: {
		usingEnvironmentId: false,
		usingMobileKey: false,
	},
};

mock(Configuration);
mock(FlagStore);
mock(FlagAliases);
const mockLDconfig = mock(LDExtensionConfiguration);
const mockExt = mock<vscode.ExtensionContext>();
const mockFlagstore = mock<FlagStore>();
const ldConfig = instance(mockLDconfig);
const flagstore = instance(mockFlagstore);
Object.defineProperty(flagstore, 'flagMetadata', {
	value: {
		fake: flag,
	},
	writable: false,
});
when(mockLDconfig.getFlagStore()).thenReturn(flagstore);
when(mockFlagstore.listFlags()).thenReturn(Promise.resolve(['fake']));
suite('FlagCodeLensProvider', () => {
	let config: Configuration;
	let flagStore: FlagStore;
	let aliases: FlagAliases;
	let provider: FlagCodeLensProvider;

	suiteSetup(() => {
		const flag: FeatureFlag = {
			key: 'fake',
			name: 'fake flag',
			description: 'test',
			kind: 'boolean',
			variations: [
				{ name: 'false variation', value: false },
				{ name: 'true variation', value: true },
			],
			clientSideAvailability: {
				usingEnvironmentId: false,
				usingMobileKey: false,
			},
		};

		// Initialize your objects here
		aliases = new FlagAliases(ldConfig);
		provider = new FlagCodeLensProvider(ldConfig);
	});

	test('should construct properly', () => {
		expect(provider).to.be.instanceOf(FlagCodeLensProvider);
	});

	test('should get offVariation variation', () => {
		const env: FlagConfiguration = {
			key: 'test',
			variations: [
				{ id: 0, value: false },
				{ id: 1, value: true },
			],
			offVariation: 0,
			fallthrough: undefined,
			prerequisites: undefined,
			targets: undefined,
			rules: [],
			on: false,
			version: 0,
		};
		const result = provider.getActiveVariations(env);
		expect([0]).to.deep.equal(result);
	});

	test('should get fallthrough variation', () => {
		const env: FlagConfiguration = {
			key: 'test',
			variations: [
				{ id: 0, value: false },
				{ id: 1, value: true },
			],
			offVariation: 0,
			fallthrough: { variation: 1 },
			prerequisites: undefined,
			targets: undefined,
			rules: [],
			on: true,
			version: 0,
		};
		const result = provider.getActiveVariations(env);
		expect([1]).to.deep.equal(result);
	});

	test('should get targets variation', () => {
		const env: FlagConfiguration = {
			key: 'test',
			variations: [
				{ id: 0, value: false },
				{ id: 1, value: true },
			],
			offVariation: 0,
			fallthrough: { variation: 1 },
			prerequisites: undefined,
			targets: [
				{ variation: 0, values: ['test0'] },
				{ variation: 1, values: ['test1'] },
			],
			rules: [],
			on: true,
			version: 0,
		};
		const result = provider.getActiveVariations(env);
		expect([0, 1]).to.deep.equal(result);
	});

	test('should get name or value', () => {
		const flag: FeatureFlag = {
			key: 'test',
			name: 'test',
			description: 'test',
			kind: 'boolean',
			variations: [
				{ name: 'false variation', value: false },
				{ name: 'true variation', value: true },
			],
			clientSideAvailability: {
				usingEnvironmentId: false,
				usingMobileKey: false,
			},
		};

		const result = provider.getNameorValue(flag, 0);
		expect('false variation').to.equal(result);
	});

	test('should provide code lenses', async () => {
		const document: vscode.TextDocument = {
			uri: Uri.file('test/flagLens.test.ts'),
			fileName: '',
			isUntitled: false,
			languageId: '',
			version: 0,
			isDirty: false,
			isClosed: false,
			save: function (): Thenable<boolean> {
				throw new Error('Function not implemented.');
			},
			eol: EndOfLine.LF,
			lineCount: 0,
			lineAt: function (line: number | Position): vscode.TextLine {
				return {
					lineNumber: 1,
					text: 'This is a "fake" text line',
					range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 20)),
					rangeIncludingLineBreak: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 21)),
					firstNonWhitespaceCharacterIndex: 0,
					isEmptyOrWhitespace: false,
				};
			},
			offsetAt: function (position: vscode.Position): number {
				throw new Error('Function not implemented.');
			},
			positionAt: function (offset: number): vscode.Position {
				return new vscode.Position(0, 10);
			},
			getText: function (range?: vscode.Range): string {
				return 'This is a "fake" text line';
			},
			getWordRangeAtPosition: function (position: vscode.Position, regex?: RegExp): vscode.Range {
				return new vscode.Range(new vscode.Position(0, 4), new vscode.Position(0, 8));
			},
			validateRange: function (range: vscode.Range): vscode.Range {
				throw new Error('Function not implemented.');
			},
			validatePosition: function (position: vscode.Position): vscode.Position {
				throw new Error('Function not implemented.');
			},
		};
		const token: vscode.CancellationToken = {
			isCancellationRequested: false,
			onCancellationRequested: undefined,
		};
		provider.provideCodeLenses(document, token).then((result) => {
			const expected = new SimpleCodeLens(
				new vscode.Range(new vscode.Position(0, 4), new vscode.Position(0, 8)),
				'fake',
			);
			expect(result).to.deep.equal([expected]);
		});
	});
});
