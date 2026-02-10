import { QuickPickItem, window } from 'vscode';
import { DevServerFlag, FlagVariation } from '../devServerApi';

interface OverrideQuickPickItem extends QuickPickItem {
	value: unknown;
}

/**
 * Show a smart input based on flag type with available variations
 */
export async function showSmartOverrideInput(
	flag: DevServerFlag,
	currentValue?: string | number | boolean | object,
	isEdit: boolean = false
): Promise<unknown | undefined> {
	const variations = flag.variations;

	// If no variations available, fall back to JSON input
	if (!variations || variations.length === 0) {
		return showJsonInput(isEdit, currentValue);
	}

	// If we have 2 or more variations, always show the picker
	if (variations.length >= 2) {
		return showVariationPicker(variations, currentValue);
	}

	// Single variation - just use JSON input as fallback
	return showJsonInput(isEdit, currentValue);
}

/**
 * Show a variation picker for any flag type
 */
async function showVariationPicker(
	variations: FlagVariation[],
	currentValue?: unknown
): Promise<unknown | undefined> {
	const items: OverrideQuickPickItem[] = variations.map((variation) => {
		const isCurrentValue = JSON.stringify(variation.value) === JSON.stringify(currentValue);
		const valueDisplay = typeof variation.value === 'object' 
			? JSON.stringify(variation.value)
			: String(variation.value);
		
		return {
			label: variation.name || valueDisplay,
			description: isCurrentValue ? '(current)' : variation.description || valueDisplay,
			detail: variation.description && variation.name !== valueDisplay ? valueDisplay : undefined,
			value: variation.value,
		};
	});

	// Add option to enter custom value
	items.push({
		label: '$(edit) Enter custom value...',
		description: 'Type a custom value',
		value: '__custom__',
	});

	const selected = await window.showQuickPick(items, {
		title: 'Select override value',
		placeHolder: 'Choose from available variations or enter custom value',
	});

	if (!selected) {
		return undefined;
	}

	if (selected.value === '__custom__') {
		return showJsonInput(false, currentValue);
	}

	return selected.value;
}

/**
 * Show generic JSON input (fallback)
 */
async function showJsonInput(isEdit: boolean = false, currentValue?: unknown): Promise<unknown | undefined> {
	const valueInput = await window.showInputBox({
		prompt: isEdit ? 'Edit override value (JSON format)' : 'Enter override value (JSON format)',
		placeHolder: 'true, false, "string", 123, {"key": "value"}, etc.',
		value: currentValue !== undefined ? JSON.stringify(currentValue) : undefined,
		validateInput: (value) => {
			try {
				JSON.parse(value);
				return null;
			} catch {
				return 'Please enter valid JSON';
			}
		},
	});

	if (valueInput === undefined) {
		return undefined;
	}

	return JSON.parse(valueInput);
}
