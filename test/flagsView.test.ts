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
	test('testFlagValue', () => {
		let flagValue = new flagsView.FlagValue(null, flag.name, vscode.TreeItemCollapsibleState.None, [], "testContext")
		assert.equal(
			flagValue.label,
			"Test"
		);
	});

});
