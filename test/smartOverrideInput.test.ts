/* eslint-disable @typescript-eslint/no-explicit-any */
import * as assert from 'assert';
import * as vscode from 'vscode';
import { showSmartOverrideInput } from '../src/utils/smartOverrideInput';
import { EnhancedFlag } from '../src/devServerApi';

// Mock vscode.window functions
let mockQuickPickResult: any = undefined;
let mockInputBoxResult: any = undefined;
let mockQuickPickCalls: any[] = [];
let mockInputBoxCalls: any[] = [];

suite('SmartOverrideInput tests', () => {
	let originalShowQuickPick: any;
	let originalShowInputBox: any;

	setup(() => {
		// Reset mocks
		mockQuickPickResult = undefined;
		mockInputBoxResult = undefined;
		mockQuickPickCalls = [];
		mockInputBoxCalls = [];

		// Store original functions
		originalShowQuickPick = vscode.window.showQuickPick;
		originalShowInputBox = vscode.window.showInputBox;

		// Mock showQuickPick
		(vscode.window as any).showQuickPick = async (items: any[], options: any) => {
			mockQuickPickCalls.push({ items, options });
			return mockQuickPickResult;
		};

		// Mock showInputBox
		(vscode.window as any).showInputBox = async (options: any) => {
			mockInputBoxCalls.push({ options });
			return mockInputBoxResult;
		};
	});

	teardown(() => {
		// Restore original functions
		vscode.window.showQuickPick = originalShowQuickPick;
		vscode.window.showInputBox = originalShowInputBox;
	});

	test('shows QuickPick when flag has 2 variations', async () => {
		const flag: EnhancedFlag = {
			key: 'test-flag',
			value: true,
			version: 1,
			variations: [
				{ id: '1', name: 'True', description: 'On', value: true },
				{ id: '2', name: 'False', description: 'Off', value: false },
			],
		};

		mockQuickPickResult = { value: false };

		const result = await showSmartOverrideInput(flag, true, false);

		assert.strictEqual(result, false);
		assert.strictEqual(mockQuickPickCalls.length, 1);
		assert.strictEqual(mockInputBoxCalls.length, 0);
		
		// Verify QuickPick items include only boolean variations (no custom value option)
		const items = mockQuickPickCalls[0].items;
		assert.strictEqual(items.length, 2); // Only 2 boolean variations, no "Enter custom value"
		assert.strictEqual(items[0].label, 'True');
		assert.strictEqual(items[1].label, 'False');
	});

	test('shows QuickPick when flag has multiple string variations', async () => {
		const flag: EnhancedFlag = {
			key: 'test-flag',
			value: 'option1',
			version: 1,
			variations: [
				{ id: '1', name: 'Option 1', description: 'First option', value: 'option1' },
				{ id: '2', name: 'Option 2', description: 'Second option', value: 'option2' },
				{ id: '3', name: 'Option 3', description: 'Third option', value: 'option3' },
			],
		};

		mockQuickPickResult = { value: 'option2' };

		const result = await showSmartOverrideInput(flag, 'option1', false);

		assert.strictEqual(result, 'option2');
		assert.strictEqual(mockQuickPickCalls.length, 1);
		
		// Verify all variations are shown
		const items = mockQuickPickCalls[0].items;
		assert.strictEqual(items.length, 4); // 3 variations + "Enter custom value"
	});

	test('marks current value correctly in QuickPick', async () => {
		const flag: EnhancedFlag = {
			key: 'test-flag',
			value: 'current-value',
			version: 1,
			variations: [
				{ id: '1', name: 'Option A', description: 'First', value: 'value-a' },
				{ id: '2', name: 'Option B', description: 'Second', value: 'current-value' },
				{ id: '3', name: 'Option C', description: 'Third', value: 'value-c' },
			],
		};

		mockQuickPickResult = { value: 'value-c' };

		await showSmartOverrideInput(flag, 'current-value', true);

		const items = mockQuickPickCalls[0].items;
		
		// Find the current value item
		const currentItem = items.find((item: any) => item.value === 'current-value');
		assert.ok(currentItem);
		assert.ok(currentItem.description?.includes('(current)'));
	});

	test('marks current boolean value correctly in QuickPick', async () => {
		const flag: EnhancedFlag = {
			key: 'test-flag',
			value: false,
			version: 1,
			variations: [
				{ id: '1', name: 'True', description: 'On', value: true },
				{ id: '2', name: 'False', description: 'Off', value: false },
			],
		};

		mockQuickPickResult = { value: true };

		await showSmartOverrideInput(flag, false, true);

		const items = mockQuickPickCalls[0].items;
		
		// Find the current value item (false)
		const currentItem = items.find((item: any) => item.value === false);
		assert.ok(currentItem);
		assert.ok(currentItem.description?.includes('(current)'), 'False should be marked as current');
		
		// Verify true is NOT marked as current
		const otherItem = items.find((item: any) => item.value === true);
		assert.ok(otherItem);
		assert.ok(!otherItem.description?.includes('(current)'), 'True should NOT be marked as current');
	});

	test('does not allow custom value entry for boolean flags', async () => {
		const flag: EnhancedFlag = {
			key: 'test-flag',
			value: true,
			version: 1,
			variations: [
				{ id: '1', name: 'True', description: 'On', value: true },
				{ id: '2', name: 'False', description: 'Off', value: false },
			],
		};

		mockQuickPickResult = { value: false };

		const result = await showSmartOverrideInput(flag, true, false);

		assert.strictEqual(result, false);
		
		const items = mockQuickPickCalls[0].items;
		
		// Verify NO "Enter custom value" option for boolean flags
		assert.strictEqual(items.length, 2);
		const hasCustomOption = items.some((item: any) => item.value === '__custom__');
		assert.strictEqual(hasCustomOption, false, 'Boolean flags should not have custom value option');
	});

	test('falls back to JSON input when no variations available', async () => {
		const flag: EnhancedFlag = {
			key: 'test-flag',
			value: { complex: 'object' },
			version: 1,
			variations: [],
		};

		mockInputBoxResult = '{"new": "value"}';

		const result = await showSmartOverrideInput(flag, undefined, false);

		assert.deepStrictEqual(result, { new: 'value' });
		assert.strictEqual(mockQuickPickCalls.length, 0);
		assert.strictEqual(mockInputBoxCalls.length, 1);
	});

	test('falls back to JSON input when variations is undefined', async () => {
		const flag: EnhancedFlag = {
			key: 'test-flag',
			value: 'test',
			version: 1,
			variations: undefined,
		};

		mockInputBoxResult = '"custom-value"';

		const result = await showSmartOverrideInput(flag, undefined, false);

		assert.strictEqual(result, 'custom-value');
		assert.strictEqual(mockInputBoxCalls.length, 1);
	});

	test('allows custom value entry from QuickPick', async () => {
			const flag: EnhancedFlag = {
			key: 'test-flag',
			value: 'option1',
			version: 1,
			variations: [
				{ id: '1', name: 'Option 1', description: 'First option', value: 'option1' },
				{ id: '2', name: 'Option 2', description: 'Second option', value: 'option2' },
			],
		};

		// User selects "Enter custom value"
		mockQuickPickResult = { value: '__custom__' };
		mockInputBoxResult = '"custom-value"';

		const result = await showSmartOverrideInput(flag, 'option1', false);

		assert.strictEqual(result, 'custom-value');
		assert.strictEqual(mockQuickPickCalls.length, 1);
		assert.strictEqual(mockInputBoxCalls.length, 1);
	});

	test('returns undefined when user cancels QuickPick', async () => {
		const flag: EnhancedFlag = {
			key: 'test-flag',
			value: true,
			version: 1,
			variations: [
				{ id: '1', name: 'True', description: 'On', value: true },
				{ id: '2', name: 'False', description: 'Off', value: false },
			],
		};

		mockQuickPickResult = undefined; // User cancelled

		const result = await showSmartOverrideInput(flag, true, false);

		assert.strictEqual(result, undefined);
	});

	test('returns undefined when user cancels InputBox', async () => {
		const flag: EnhancedFlag = {
			key: 'test-flag',
			value: 'test',
			version: 1,
			variations: [],
		};

		mockInputBoxResult = undefined; // User cancelled

		const result = await showSmartOverrideInput(flag, undefined, false);

		assert.strictEqual(result, undefined);
	});

	test('handles complex JSON objects in variations', async () => {
		const flag: EnhancedFlag = {
			key: 'test-flag',
			value: { setting: 'default' },
			version: 1,
			variations: [
				{ id: '1', name: 'Config A', description: 'First config', value: { setting: 'a', enabled: true } },
				{ id: '2', name: 'Config B', description: 'Second config', value: { setting: 'b', enabled: false } },
			],
		};

		mockQuickPickResult = { value: { setting: 'b', enabled: false } };

		const result = await showSmartOverrideInput(flag, { setting: 'default' }, false);

		assert.deepStrictEqual(result, { setting: 'b', enabled: false });
		assert.strictEqual(mockQuickPickCalls.length, 1);
	});

	test('uses variation name as label when available', async () => {
		const flag: EnhancedFlag = {
			key: 'test-flag',
			value: 'v1',
			version: 1,
			variations: [
				{ id: '1', name: 'Variation One', description: 'First variation', value: 'v1' },
				{ id: '2', name: 'Variation Two', description: 'Second variation', value: 'v2' },
			],
		};

		mockQuickPickResult = { value: 'v2' };

		await showSmartOverrideInput(flag, 'v1', false);

		const items = mockQuickPickCalls[0].items;
		
		assert.strictEqual(items[0].label, 'Variation One');
		assert.strictEqual(items[1].label, 'Variation Two');
	});

	test('shows variation description in QuickPick', async () => {
		const flag: EnhancedFlag = {
			key: 'test-flag',
			value: 'v1',
			version: 1,
			variations: [
				{ id: '1', name: 'Option A', description: 'This is the first option', value: 'v1' },
				{ id: '2', name: 'Option B', description: 'This is the second option', value: 'v2' },
			],
		};

		mockQuickPickResult = { value: 'v1' };

		await showSmartOverrideInput(flag, 'v1', false);

		const items = mockQuickPickCalls[0].items;
		
		// Current value should show in description
		assert.ok(items[0].description?.includes('(current)'));
		// Non-current should show their description
		assert.ok(items[1].description?.includes('This is the second option'));
	});

	test('validates JSON input correctly', async () => {
		const flag: EnhancedFlag = {
			key: 'test-flag',
			value: 'test',
			version: 1,
			variations: [],
		};

		mockInputBoxResult = '{"valid": "json"}';

		await showSmartOverrideInput(flag, undefined, false);

		// Check that validateInput function was provided
		const inputOptions = mockInputBoxCalls[0].options;
		assert.ok(inputOptions.validateInput);
		
		// Test validation with valid JSON
		const validResult = inputOptions.validateInput('{"test": true}');
		assert.strictEqual(validResult, null);
		
		// Test validation with invalid JSON
		const invalidResult = inputOptions.validateInput('{invalid}');
		assert.ok(invalidResult?.includes('JSON'));
	});
});
