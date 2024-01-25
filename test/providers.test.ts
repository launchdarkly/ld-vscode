/* eslint-disable @typescript-eslint/no-var-requires */
import { anyString, instance, mock, when } from 'ts-mockito';
import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
const expect = require('expect');
const toMatchSnapshot = require('expect-mocha-snapshot');

expect.extend({ toMatchSnapshot });
import { generateHoverString } from '../src/utils/hover';
import { FeatureFlag, FlagConfiguration } from '../src/models';
import { isPrecedingCharStringDelimiter } from '../src/providers/completion';
import { LDExtensionConfiguration } from '../src/ldExtensionConfiguration';
import { Configuration } from '../src/configuration';
import { LaunchDarklyAuthenticationSession } from '../src/providers/authProvider';

function resolveSrcTestPath(ctx) {
	return Object.assign(ctx, { test: { file: ctx.test.file.replace('/out', '') } });
}

const flag = new FeatureFlag({
	name: 'Test',
	key: 'test',
	description: 'First flag',
	tags: [],
	environments: {
		test: {
			_site: {
				href: 'https://example.com',
			},
		},
	},
	kind: 'boolean',
	variations: [
		{
			value: 1,
			name: 'one',
			description: 'first flag',
		},
	],
	clientSideAvailability: {
		usingMobileKey: false,
		usingEnvironmentId: false,
	}
});

const flagConfig: FlagConfiguration = {
	key: 'test',
	on: true,
	variations: ['SomeVariation', { thisIsJson: 'AnotherVariation' }],
	fallthrough: {
		variation: 0,
	},
	offVariation: 1,
	prerequisites: [{ key: 'something' }],
	targets: [{ values: ['user', 'anotheruser'] }, { values: ['someotheruser'] }],
	rules: [],
	version: 1,
};

const mockLDConfig = mock(LDExtensionConfiguration);
const mockConfig = mock(Configuration);
const mockCtx = mock<vscode.ExtensionContext>();
const mockSession = mock<LaunchDarklyAuthenticationSession>();

const ctx = instance(mockCtx);
const config = instance(mockConfig);
const ldConfig = instance(mockLDConfig);
const session = instance(mockSession);

when(mockLDConfig.getConfig()).thenReturn(config);
when(mockConfig.project).thenReturn('abc');

when(mockLDConfig.getSession()).thenReturn(session);
when(mockSession.fullUri).thenReturn('https://example.com');

when(mockLDConfig.getCtx()).thenReturn(ctx);
when(mockCtx.asAbsolutePath(anyString())).thenReturn(path.normalize(`${__dirname}/../../resources/dark/toggleon.svg`));

const testPath = path.join(__dirname, '..', '..', 'test');
suite('provider utils tests', function () {
	test('generateHoverString', function () {
		expect(generateHoverString(flag, flagConfig, ldConfig).value).toMatchSnapshot(resolveSrcTestPath(this));
	});

	test('isPrecedingCharStringDelimeter', async () => {
		// TODO: generate the test data in this file
		const uri = vscode.Uri.file(path.join(testPath, 'test.txt'));
		const tests = [
			{
				name: 'single-quote delim',
				expected: true,
				line: 0,
				char: 1,
			},
			{
				name: 'double-quote delim',
				expected: true,
				line: 1,
				char: 1,
			},
			{
				name: 'backtick delim',
				expected: true,
				line: 2,
				char: 1,
			},
			{
				name: 'not start of line',
				expected: true,
				line: 3,
				char: 2,
			},
			{
				name: 'delim preceded by another char',
				expected: false,
				line: 4,
				char: 2,
			},
			{
				name: "doesn't match flag key regex",
				expected: false,
				line: 6,
				char: 2,
			},
		];

		const document = await vscode.workspace.openTextDocument(uri);
		tests.forEach((t) => {
			const pos = new vscode.Position(t.line, t.char);
			assert.equal(isPrecedingCharStringDelimiter(document, pos), t.expected, t.name);
		});
	});
});
