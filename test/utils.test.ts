import * as assert from 'assert';
import * as utils from '../src/utils';
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

suite('Utils tests', () => {
	test('generateHoverString', () => {
		assert.equal(
			`**LaunchDarkly feature flag**\n\n\tKey: test\n\tEnabled: true\n\tDefault variation: "SomeVariation"\n\tOff variation: {"thisIsJson":"AnotherVariation"}\n\t1 prerequisite\n\t3 user targets\n\t0 rules`,
			utils.generateHoverString(flag),
		);
	});

	test('isPrecedingCharStringDelimeter', () => {
		let uri = vscode.Uri.file(path.join(testPath, 'test.txt'));
		const tests = [
			{
				expected: true,
				line: 0,
				char: 1,
			},
			{
				expected: true,
				line: 1,
				char: 1,
			},
			{
				expected: true,
				line: 2,
				char: 1,
			},
			{
				expected: true,
				line: 3,
				char: 2,
			},
			{
				expected: false,
				line: 4,
				char: 2,
			},
		];

		vscode.workspace.openTextDocument(uri).then(document => {
			tests.forEach(t => {
				let pos = new vscode.Position(t.line, t.char);
				assert.equal(utils.isPrecedingCharStringDelimeter(document, pos), t.expected);
			});
		});
	});
});
