import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

import * as providers from '../src/providers';
import { FeatureFlag, FlagConfiguration } from '../src/models';
import { Configuration } from '../src/configuration';

const flag = new FeatureFlag ({
	name: "Test",
	key: "test",
	description: 'First flag',
	tags: [],
	environments: {
		test: {
			'_site': {
				href: 'https://example.com'
			}
		},
	},
	kind: 'boolean',
	variations: [
		{
			value: 1,
			name: 'one',
			description: 'first flag'
		}
	]
});

const flagConfig: FlagConfiguration = {
	key: 'test',
	on: true,
	variations: ['SomeVariation', { thisIsJson: 'AnotherVariation' }],
	fallthrough: {
		variation: 0,
	},
	offVariation: 1,
	prerequisites: [{ key: 'something'}],
	targets: [{ values: ['user', 'anotheruser'] }, { values: ['someotheruser'] }],
	rules: [],
	version: 1,
};

class MockConfiguration extends Configuration {
	baseUri = 'https://example.com';
	project = 'abc';
	constructor() {
		super(null)
	}

	reload():void {
		console.log('calling overridden reload()');
	}
}
const mockConfig = new MockConfiguration()

const testPath = path.join(__dirname, '..', '..', 'test');

suite('provider utils tests', () => {
	test('generateHoverString', () => {
		const hoverStr = providers.generateHoverString(flag, flagConfig, mockConfig).value;
		assert.strictEqual(
			"$(rocket) abc / test / **[test](https://example.com/ \"Open in LaunchDarkly\")**\n\n\n\nFirst flag\n\n* Prerequisites: `something`\n* Targets configured\n\n\n**$(symbol-boolean) Variations**\n\n* `1` **one**: first flag `$(arrow-small-right)fallthrough`",
			hoverStr
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
			assert.equal(providers.isPrecedingCharStringDelimiter(document, pos), t.expected, t.name);
		});
	});
});
