import * as assert from 'assert';
import * as vscode from 'vscode';

import * as flagsView from '../src/providers/flagsView';
import { FeatureFlag } from '../src/models';

const flag = new FeatureFlag({
	name: "Test",
	key: "test",
	tags: [],
	environments: null,
});

suite('flagNode tests', () => {
	const flagValue = new flagsView.FlagNode(null, flag.name, vscode.TreeItemCollapsibleState.None, [], "testContext")
	const flagFunc = flagsView.flagNodeFactory({ label: "test-label", uri: "/test", flagKey: "flag-key"})
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

	test('testFlagValueFunc ', () => {
		assert.equal(
			flagFunc.collapsibleState,
			vscode.TreeItemCollapsibleState.None
		);

		assert.equal(
			flagFunc.children.length,
			0
		);

		assert.equal(
			flagFunc instanceof flagsView.FlagNode,
			true
		)
	});
});

suite('flagParentNode tests', () => {
	const flagValue = new flagsView.FlagParentNode(null, flag.name, vscode.TreeItemCollapsibleState.None, [], "testContext")
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
