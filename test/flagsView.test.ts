import * as assert from 'assert';
import * as vscode from 'vscode';

import { FlagNode, FlagParentNode, flagNodeFactory } from '../src/utils/FlagNode';
import { FeatureFlag } from '../src/models';

const flag = new FeatureFlag({
	name: 'Test',
	key: 'test',
	tags: [],
	environments: null,
});

suite('flagNode tests', () => {
	const flagValue = new FlagNode(null, flag.name, vscode.TreeItemCollapsibleState.None, [], 'testContext');
	const flagFunc = flagNodeFactory({ label: 'test-label', uri: '/test', flagKey: 'flag-key' });
	test('testFlagValue label', () => {
		assert.equal(flagValue.label, 'Test');
	});

	test('testFlagValue children', () => {
		const children = flagValue.children as Array<unknown>;
		assert.equal(children, 0);
	});

	test('testFlagValueFunc ', () => {
		const children = flagFunc.children as Array<unknown>;

		assert.equal(flagFunc.collapsibleState, vscode.TreeItemCollapsibleState.None);

		assert.equal(children, 0);

		assert.equal(flagFunc instanceof FlagNode, true);
	});
});

suite('flagParentNode tests', () => {
	const flagValue = new FlagParentNode(
		null,
		flag.name,
		flag.description,
		null,
		vscode.TreeItemCollapsibleState.None,
		[],
		'testContext',
	);
	test('testFlagValue label', () => {
		assert.equal(flagValue.label, 'Test');
	});

	test('testFlagValue children', () => {
		assert.equal(flagValue.children.length, 0);
	});
});
