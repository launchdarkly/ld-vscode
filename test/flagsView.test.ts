import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

import * as flagsView from '../src/providers/flagsView';
import { FeatureFlag, FlagConfiguration } from '../src/models';

const flag = new FeatureFlag({
	name: "Test",
	key: "test",
	tags: [],
	environments: null,
});

suite('flagsView tests', () => {
	let flagValue = new flagsView.FlagValue(null, flag.name, vscode.TreeItemCollapsibleState.None, [], "testContext")

	test('testFlagValue label', () => {
		assert.equal(
			flagValue.label,
			"Test"
		);
	});

	test('testFlagValue children', () => {
		assert.equal(
			flagValue.children.length,
			0
		);
	});

});
