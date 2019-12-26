import * as assert from 'assert';
import * as flags from '../src/flags';
import * as path from 'path';
import * as vscode from 'vscode';

const flag = {
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
};

let testPath = path.join(__dirname, '..', '..', 'test');

suite('flags tests', () => {
	test('generateHoverString', () => {
		assert.equal(
			`**LaunchDarkly feature flag**\n\n\tKey: test\n\tEnabled: true\n\tDefault variation: "SomeVariation"\n\tOff variation: {"thisIsJson":"AnotherVariation"}\n\t1 prerequisite\n\t3 user targets\n\t0 rules`,
			flags.generateHoverString(flag),
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
			assert.equal(flags.isPrecedingCharStringDelimeter(document, pos), t.expected, t.name);
		});

	});
});
