/* eslint-disable @typescript-eslint/no-explicit-any */
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { instance, mock, when, anything } from 'ts-mockito';
import { setDevServerOverride, removeDevServerOverride } from '../src/commands/devServerOverrides';
import { ILDExtensionConfiguration, IDevServerProvider } from '../src/models';
import { Configuration } from '../src/configuration';

suite('DevServer override command guards', () => {
	let mockConfig: ILDExtensionConfiguration;
	let mockConfiguration: Configuration;
	let showErrorStub: sinon.SinonStub;

	setup(() => {
		mockConfig = mock<ILDExtensionConfiguration>();
		mockConfiguration = mock(Configuration);
		when(mockConfig.getConfig()).thenReturn(instance(mockConfiguration));

		showErrorStub = sinon.stub(vscode.window, 'showErrorMessage');
	});

	teardown(() => {
		sinon.restore();
	});

	test('setDevServerOverride shows error when dev server is not connected', async () => {
		when(mockConfiguration.isDevServerEnabled()).thenReturn(false);
		when(mockConfig.getDevServerProvider()).thenReturn(undefined);

		await setDevServerOverride(instance(mockConfig), 'test-flag');

		assert.ok(showErrorStub.calledOnce, 'showErrorMessage should be called');
		assert.ok(showErrorStub.calledWith('Not connected to dev-server'), 'Should show "Not connected" message');
	});

	test('setDevServerOverride shows error when provider exists but disabled', async () => {
		const mockProvider = mock<IDevServerProvider>();
		when(mockConfig.getDevServerProvider()).thenReturn(instance(mockProvider));
		when(mockConfiguration.isDevServerEnabled()).thenReturn(false);

		await setDevServerOverride(instance(mockConfig), 'test-flag');

		assert.ok(showErrorStub.calledOnce);
		assert.ok(showErrorStub.calledWith('Not connected to dev-server'));
	});

	test('setDevServerOverride shows error when flag not found', async () => {
		const mockProvider = mock<IDevServerProvider>();
		when(mockConfig.getDevServerProvider()).thenReturn(instance(mockProvider));
		when(mockConfiguration.isDevServerEnabled()).thenReturn(true);
		when(mockProvider.getFlag('missing-flag')).thenReturn(undefined);

		await setDevServerOverride(instance(mockConfig), 'missing-flag');

		assert.ok(showErrorStub.calledOnce);
		assert.ok(showErrorStub.calledWith('Flag not found in dev-server'));
	});

	test('removeDevServerOverride shows error when dev server is not connected', async () => {
		when(mockConfiguration.isDevServerEnabled()).thenReturn(false);
		when(mockConfig.getDevServerProvider()).thenReturn(undefined);

		await removeDevServerOverride(instance(mockConfig), 'test-flag');

		assert.ok(showErrorStub.calledOnce);
		assert.ok(showErrorStub.calledWith('Not connected to dev-server'));
	});

	test('removeDevServerOverride shows error when provider exists but disabled', async () => {
		const mockProvider = mock<IDevServerProvider>();
		when(mockConfig.getDevServerProvider()).thenReturn(instance(mockProvider));
		when(mockConfiguration.isDevServerEnabled()).thenReturn(false);

		await removeDevServerOverride(instance(mockConfig), 'test-flag');

		assert.ok(showErrorStub.calledOnce);
		assert.ok(showErrorStub.calledWith('Not connected to dev-server'));
	});
});

suite('DevServer context key in package.json when clauses', () => {
	let packageJson: any;

	setup(async () => {
		const pkgUri = vscode.Uri.file(require('path').resolve(__dirname, '..', 'package.json'));
		const doc = await vscode.workspace.openTextDocument(pkgUri);
		packageJson = JSON.parse(doc.getText());
	});

	test('setDevServerOverride menu entry requires devServerConnected context', () => {
		const viewItemContextMenus = packageJson.contributes.menus['view/item/context'];
		const setOverrideEntry = viewItemContextMenus.find((m: any) => m.command === 'launchdarkly.setDevServerOverride');

		assert.ok(setOverrideEntry, 'setDevServerOverride should exist in view/item/context');
		assert.ok(
			setOverrideEntry.when.includes('launchdarkly:devServerConnected'),
			`when clause should include devServerConnected, got: "${setOverrideEntry.when}"`,
		);
	});

	test('removeDevServerOverride menu entry requires devServerConnected context', () => {
		const viewItemContextMenus = packageJson.contributes.menus['view/item/context'];
		const removeOverrideEntry = viewItemContextMenus.find(
			(m: any) => m.command === 'launchdarkly.removeDevServerOverride',
		);

		assert.ok(removeOverrideEntry, 'removeDevServerOverride should exist in view/item/context');
		assert.ok(
			removeOverrideEntry.when.includes('launchdarkly:devServerConnected'),
			`when clause should include devServerConnected, got: "${removeOverrideEntry.when}"`,
		);
	});

	test('setDevServerOverride is hidden from command palette when disconnected', () => {
		const paletteEntries = packageJson.contributes.menus.commandPalette;
		const setOverrideEntry = paletteEntries.find((m: any) => m.command === 'launchdarkly.setDevServerOverride');

		assert.ok(setOverrideEntry, 'setDevServerOverride should have a commandPalette entry');
		assert.ok(
			setOverrideEntry.when.includes('launchdarkly:devServerConnected'),
			`commandPalette when clause should gate on devServerConnected, got: "${setOverrideEntry.when}"`,
		);
	});

	test('removeDevServerOverride is hidden from command palette when disconnected', () => {
		const paletteEntries = packageJson.contributes.menus.commandPalette;
		const removeOverrideEntry = paletteEntries.find((m: any) => m.command === 'launchdarkly.removeDevServerOverride');

		assert.ok(removeOverrideEntry, 'removeDevServerOverride should have a commandPalette entry');
		assert.ok(
			removeOverrideEntry.when.includes('launchdarkly:devServerConnected'),
			`commandPalette when clause should gate on devServerConnected, got: "${removeOverrideEntry.when}"`,
		);
	});
});
