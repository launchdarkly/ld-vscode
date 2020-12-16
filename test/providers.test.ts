import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

import * as providers from '../src/providers';
import { FeatureFlag, FlagConfiguration, Variation } from '../src/models';

const trueVariation = new Variation
trueVariation.value = true

const falseVariation = new Variation
falseVariation.value = false

const flag = new FeatureFlag ({
	name: "Test",
	key: "test",
	tags: [],
	environments: null,
	variations: [trueVariation, falseVariation]
});

const flagConfig: FlagConfiguration = {
	key: 'test',
	on: true,
	variations: ['SomeVariation', { thisIsJson: 'AnotherVariation' }],
	fallthrough: {
		variation: 0,
	},
	offVariation: 1,
	prerequisites: ['something'],
	targets: [{ values: ['user', 'anotheruser'] }, { values: ['someotheruser'] }],
	rules: [],
	version: 1,
};

const testPath = path.join(__dirname, '..', '..', 'test');

suite('provider utils tests', () => {
	test('generateHoverString', () => {
		assert.equal(
			"**LaunchDarkly feature flag** • Test    [$(link-external)](http://app.launchdarkly.com/example)\n\n\n\n• prerequisites 1\n\n**Variations**\n\n1   ◆ Fallthrough Variation ◆ Return Value: `true`\n\n\n\n\n\n\n\n2  ◆ Off Variation  ◆ Return Value: `false`\n\n\n\n\n\n\n",
			providers.generateHoverString(flag, flagConfig, "http://app.launchdarkly.com/example").value,
		);
	});

	test('isPrecedingCharStringDelimeter', async () => {
		// TODO: generate the test data in this file
		const uri = vscode.Uri.file(path.join(testPath, 'test.txt'));
		const tests = [
			{
				name: "single-quote delim",
				expected: true,
				line: 0,
				char: 1,
			},
			{
				name: "double-quote delim",
				expected: true,
				line: 1,
				char: 1,
			},
			{
				name: "backtick delim",
				expected: true,
				line: 2,
				char: 1,
			},
			{
				name: "not start of line",
				expected: true,
				line: 3,
				char: 2,
			},
			{
				name: "delim preceded by another char",
				expected: false,
				line: 4,
				char: 2,
			},
			{
				name: "doesn't match flag key regex",
				expected: false,
				line: 6,
				char: 2,
			}
		];

		const document = await vscode.workspace.openTextDocument(uri);
		tests.forEach(t => {
			const pos = new vscode.Position(t.line, t.char);
			assert.equal(providers.isPrecedingCharStringDelimeter(document, pos), t.expected, t.name);
		});
	});
});
