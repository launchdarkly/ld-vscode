import * as assert from 'assert';
import { instance, mock, when } from 'ts-mockito';
import { DevServerApi, DevServerProject } from '../src/devServerApi';
import { DevServerProvider } from '../src/providers/devServerProvider';
import { ILDExtensionConfiguration } from '../src/models';
import { Configuration } from '../src/configuration';
import * as sinon from 'sinon';
import axios from 'axios';

suite('DevServerApi tests', () => {
	let mockConfig: ILDExtensionConfiguration;
	let mockConfiguration: Configuration;
	let devServerApi: DevServerApi;
	let axiosStub: sinon.SinonStub;

	setup(() => {
		mockConfig = mock<ILDExtensionConfiguration>();
		mockConfiguration = mock(Configuration);
		
		when(mockConfig.getConfig()).thenReturn(instance(mockConfiguration));
		when(mockConfiguration.getDevServerUri()).thenReturn('http://localhost:8765');
		when(mockConfiguration.project).thenReturn('test-project');
		
		devServerApi = new DevServerApi(instance(mockConfig));
	});

	teardown(() => {
		if (axiosStub) {
			axiosStub.restore();
		}
	});

	test('isAvailable returns true when dev-server responds', async () => {
		axiosStub = sinon.stub(axios, 'get').resolves({ status: 200, data: {} });
		
		const result = await devServerApi.isAvailable();
		
		assert.strictEqual(result, true);
		assert.ok(axiosStub.calledWith('http://localhost:8765/dev/projects'));
	});

	test('isAvailable returns false when dev-server is unreachable', async () => {
		axiosStub = sinon.stub(axios, 'get').rejects(new Error('Connection refused'));
		
		const result = await devServerApi.isAvailable();
		
		assert.strictEqual(result, false);
	});

	test('getProject returns project data with variations and overrides', async () => {
		const mockProject: DevServerProject = {
			key: 'test-project',
			sourceEnvironmentKey: 'production',
			context: { kind: 'user', key: 'test-user' },
			flagsState: {
				'test-flag': {
					key: 'test-flag',
					value: true,
					version: 1,
					variation: 0,
					trackEvents: false,
					trackReason: false,
					variations: [
						{ id: '1', name: 'True', description: 'On', value: true },
						{ id: '2', name: 'False', description: 'Off', value: false },
					],
				},
			},
			overrides: {
				'test-flag': {
					value: false,
					version: 2,
				},
			},
			availableVariations: {
				'test-flag': [
					{ id: '1', name: 'True', description: 'On', value: true },
					{ id: '2', name: 'False', description: 'Off', value: false },
				],
			},
			lastSyncTime: '2024-01-01T00:00:00Z',
		};

		axiosStub = sinon.stub(axios, 'get').resolves({ data: mockProject });
		
		const result = await devServerApi.getProject();
		
		assert.deepStrictEqual(result, mockProject);
		assert.ok(axiosStub.calledOnce);
	});

	test('getProject returns null on error', async () => {
		axiosStub = sinon.stub(axios, 'get').rejects(new Error('Server error'));
		
		const result = await devServerApi.getProject();
		
		assert.strictEqual(result, null);
	});

	test('getAllFlags returns array of flags with keys', async () => {
		const mockProject: DevServerProject = {
			key: 'test-project',
			sourceEnvironmentKey: 'production',
			context: {},
			flagsState: {
				'flag1': {
					key: 'flag1',
					value: true,
					version: 1,
					variation: 0,
					trackEvents: false,
					trackReason: false,
					variations: [],
				},
				'flag2': {
					key: 'flag2',
					value: 'test',
					version: 1,
					variation: 0,
					trackEvents: false,
					trackReason: false,
					variations: [],
				},
			},
			availableVariations: {},
			lastSyncTime: '2024-01-01T00:00:00Z',
		};

		axiosStub = sinon.stub(axios, 'get').resolves({ data: mockProject });
		
		const result = await devServerApi.getAllFlags();
		
		assert.strictEqual(result?.length, 2);
		assert.ok(result?.some(f => f.key === 'flag1'));
		assert.ok(result?.some(f => f.key === 'flag2'));
	});

	test('getAllFlags returns null when project is null', async () => {
		axiosStub = sinon.stub(axios, 'get').rejects(new Error('Error'));
		
		const result = await devServerApi.getAllFlags();
		
		assert.strictEqual(result, null);
	});

	test('getFlagValue returns specific flag by key', async () => {
		const mockProject: DevServerProject = {
			key: 'test-project',
			sourceEnvironmentKey: 'production',
			context: {},
			flagsState: {
				'target-flag': {
					key: 'target-flag',
					value: 'found',
					version: 1,
					variation: 0,
					trackEvents: false,
					trackReason: false,
					variations: [],
				},
			},
			availableVariations: {},
			lastSyncTime: '2024-01-01T00:00:00Z',
		};

		axiosStub = sinon.stub(axios, 'get').resolves({ data: mockProject });
		
		const result = await devServerApi.getFlagValue('target-flag');
		
		assert.strictEqual(result?.value, 'found');
	});

	test('getFlagValue returns null for non-existent flag', async () => {
		const mockProject: DevServerProject = {
			key: 'test-project',
			sourceEnvironmentKey: 'production',
			context: {},
			flagsState: {},
			availableVariations: {},
			lastSyncTime: '2024-01-01T00:00:00Z',
		};

		axiosStub = sinon.stub(axios, 'get').resolves({ data: mockProject });
		
		const result = await devServerApi.getFlagValue('non-existent');
		
		assert.strictEqual(result, null);
	});

	test('setOverride calls API with correct parameters', async () => {
		axiosStub = sinon.stub(axios, 'put').resolves({ status: 200 });
		
		const result = await devServerApi.setOverride('test-flag', 'new-value');
		
		assert.strictEqual(result, true);
		assert.ok(axiosStub.calledOnce);
		assert.ok(axiosStub.calledWith(
			'http://localhost:8765/dev/projects/test-project/overrides/test-flag',
			JSON.stringify('new-value')
		));
	});

	test('setOverride returns false on error', async () => {
		axiosStub = sinon.stub(axios, 'put').rejects(new Error('Server error'));
		
		const result = await devServerApi.setOverride('test-flag', 'new-value');
		
		assert.strictEqual(result, false);
	});

	test('removeOverride calls API with correct parameters', async () => {
		axiosStub = sinon.stub(axios, 'delete').resolves({ status: 200 });
		
		const result = await devServerApi.removeOverride('test-flag');
		
		assert.strictEqual(result, true);
		assert.ok(axiosStub.calledOnce);
	});

	test('removeOverride returns false on error', async () => {
		axiosStub = sinon.stub(axios, 'delete').rejects(new Error('Server error'));
		
		const result = await devServerApi.removeOverride('test-flag');
		
		assert.strictEqual(result, false);
	});

	test('syncProject calls API with correct parameters', async () => {
		axiosStub = sinon.stub(axios, 'patch').resolves({ status: 200 });
		
		const result = await devServerApi.syncProject();
		
		assert.strictEqual(result, true);
		assert.ok(axiosStub.calledOnce);
	});
});

suite('DevServerProvider tests', () => {
	let mockConfig: ILDExtensionConfiguration;
	let mockConfiguration: Configuration;
	let devServerProvider: DevServerProvider;
	let axiosStub: sinon.SinonStub;

	setup(() => {
		mockConfig = mock<ILDExtensionConfiguration>();
		mockConfiguration = mock(Configuration);
		
		when(mockConfig.getConfig()).thenReturn(instance(mockConfiguration));
		when(mockConfiguration.isDevServerEnabled()).thenReturn(true);
		when(mockConfiguration.getDevServerUri()).thenReturn('http://localhost:8765');
		when(mockConfiguration.project).thenReturn('test-project');
		
		devServerProvider = new DevServerProvider(instance(mockConfig));
	});

	teardown(() => {
		if (axiosStub) {
			axiosStub.restore();
		}
	});

	test('isConnected returns true when dev-server is enabled', () => {
		when(mockConfiguration.isDevServerEnabled()).thenReturn(true);
		
		const result = devServerProvider.isConnected();
		
		assert.strictEqual(result, true);
	});

	test('isConnected returns false when dev-server is disabled', () => {
		when(mockConfiguration.isDevServerEnabled()).thenReturn(false);
		
		const result = devServerProvider.isConnected();
		
		assert.strictEqual(result, false);
	});

	test('refresh builds flag cache with overrides', async () => {
		const mockProject: DevServerProject = {
			key: 'test-project',
			sourceEnvironmentKey: 'production',
			context: {},
			flagsState: {
				'flag1': {
					key: 'flag1',
					value: true,
					version: 1,
					variation: 0,
					trackEvents: false,
					trackReason: false,
					variations: [
						{ id: '1', name: 'True', description: 'On', value: true },
						{ id: '2', name: 'False', description: 'Off', value: false },
					],
				},
			},
			overrides: {
				'flag1': {
					value: false,
					version: 2,
				},
			},
			availableVariations: {
				'flag1': [
					{ id: '1', name: 'True', description: 'On', value: true },
					{ id: '2', name: 'False', description: 'Off', value: false },
				],
			},
			lastSyncTime: '2024-01-01T00:00:00Z',
		};

		axiosStub = sinon.stub(axios, 'get').resolves({ data: mockProject });
		
		const result = await devServerProvider.refresh();
		
		assert.strictEqual(result, true);
		
		// Check that flag is cached
		const flagInfo = devServerProvider.getFlag('flag1');
		assert.ok(flagInfo);
		assert.strictEqual(flagInfo.isOverridden, true);
		assert.strictEqual(flagInfo.override?.value, false);
		assert.strictEqual(flagInfo.flag.value, true);
		assert.strictEqual(flagInfo.flag.variations?.length, 2);
	});

	test('getFlagValue returns override value when flag is overridden', async () => {
		const mockProject: DevServerProject = {
			key: 'test-project',
			sourceEnvironmentKey: 'production',
			context: {},
			flagsState: {
				'overridden-flag': {
					key: 'overridden-flag',
					value: 'original',
					version: 1,
					variation: 0,
					trackEvents: false,
					trackReason: false,
					variations: [],
				},
			},
			overrides: {
				'overridden-flag': {
					value: 'overridden',
					version: 2,
				},
			},
			availableVariations: {},
			lastSyncTime: '2024-01-01T00:00:00Z',
		};

		axiosStub = sinon.stub(axios, 'get').resolves({ data: mockProject });
		await devServerProvider.refresh();
		
		const result = devServerProvider.getFlagValue('overridden-flag');
		
		assert.strictEqual(result, 'overridden');
	});

	test('getFlagValue returns base value when flag is not overridden', async () => {
		const mockProject: DevServerProject = {
			key: 'test-project',
			sourceEnvironmentKey: 'production',
			context: {},
			flagsState: {
				'normal-flag': {
					key: 'normal-flag',
					value: 'base-value',
					version: 1,
					variation: 0,
					trackEvents: false,
					trackReason: false,
					variations: [],
				},
			},
			overrides: {},
			availableVariations: {},
			lastSyncTime: '2024-01-01T00:00:00Z',
		};

		axiosStub = sinon.stub(axios, 'get').resolves({ data: mockProject });
		await devServerProvider.refresh();
		
		const result = devServerProvider.getFlagValue('normal-flag');
		
		assert.strictEqual(result, 'base-value');
	});

	test('isOverridden returns true for overridden flags', async () => {
		const mockProject: DevServerProject = {
			key: 'test-project',
			sourceEnvironmentKey: 'production',
			context: {},
			flagsState: {
				'flag1': {
					key: 'flag1',
					value: true,
					version: 1,
					variation: 0,
					trackEvents: false,
					trackReason: false,
					variations: [],
				},
			},
			overrides: {
				'flag1': {
					value: false,
					version: 2,
				},
			},
			availableVariations: {},
			lastSyncTime: '2024-01-01T00:00:00Z',
		};

		axiosStub = sinon.stub(axios, 'get').resolves({ data: mockProject });
		await devServerProvider.refresh();
		
		const result = devServerProvider.isOverridden('flag1');
		
		assert.strictEqual(result, true);
	});

	test('isOverridden returns false for non-overridden flags', async () => {
		const mockProject: DevServerProject = {
			key: 'test-project',
			sourceEnvironmentKey: 'production',
			context: {},
			flagsState: {
				'flag1': {
					key: 'flag1',
					value: true,
					version: 1,
					variation: 0,
					trackEvents: false,
					trackReason: false,
					variations: [],
				},
			},
			overrides: {},
			availableVariations: {},
			lastSyncTime: '2024-01-01T00:00:00Z',
		};

		axiosStub = sinon.stub(axios, 'get').resolves({ data: mockProject });
		await devServerProvider.refresh();
		
		const result = devServerProvider.isOverridden('flag1');
		
		assert.strictEqual(result, false);
	});

	test('getOverriddenFlags returns list of overridden flag keys', async () => {
		const mockProject: DevServerProject = {
			key: 'test-project',
			sourceEnvironmentKey: 'production',
			context: {},
			flagsState: {
				'flag1': { key: 'flag1', value: true, version: 1, variation: 0, trackEvents: false, trackReason: false, variations: [] },
				'flag2': { key: 'flag2', value: false, version: 1, variation: 0, trackEvents: false, trackReason: false, variations: [] },
				'flag3': { key: 'flag3', value: 'test', version: 1, variation: 0, trackEvents: false, trackReason: false, variations: [] },
			},
			overrides: {
				'flag1': { value: false, version: 2 },
				'flag3': { value: 'overridden', version: 2 },
			},
			availableVariations: {},
			lastSyncTime: '2024-01-01T00:00:00Z',
		};

		axiosStub = sinon.stub(axios, 'get').resolves({ data: mockProject });
		await devServerProvider.refresh();
		
		const result = devServerProvider.getOverriddenFlags();
		
		assert.strictEqual(result.length, 2);
		assert.ok(result.includes('flag1'));
		assert.ok(result.includes('flag3'));
		assert.ok(!result.includes('flag2'));
	});

	test('setOverride refreshes cache after setting', async () => {
		// Mock initial state
		const initialProject: DevServerProject = {
			key: 'test-project',
			sourceEnvironmentKey: 'production',
			context: {},
			flagsState: {
				'test-flag': { key: 'test-flag', value: 'original', version: 1, variation: 0, trackEvents: false, trackReason: false, variations: [] },
			},
			overrides: {},
			availableVariations: {},
			lastSyncTime: '2024-01-01T00:00:00Z',
		};

		// Mock updated state after override
		const updatedProject: DevServerProject = {
			...initialProject,
			overrides: {
				'test-flag': { value: 'new-value', version: 2 },
			},
		};

		axiosStub = sinon.stub(axios, 'get');
		axiosStub.onFirstCall().resolves({ data: initialProject });
		axiosStub.onSecondCall().resolves({ data: updatedProject });
		
		await devServerProvider.refresh();

		const putStub = sinon.stub(axios, 'put').resolves({ status: 200 });
		
		const result = await devServerProvider.setOverride('test-flag', 'new-value');
		
		assert.strictEqual(result, true);
		assert.strictEqual(devServerProvider.isOverridden('test-flag'), true);
		assert.strictEqual(devServerProvider.getFlagValue('test-flag'), 'new-value');
		
		putStub.restore();
	});

	test('onDidRefresh fires after successful refresh', async () => {
		const mockProject: DevServerProject = {
			key: 'test-project',
			sourceEnvironmentKey: 'production',
			context: {},
			flagsState: {
				'flag1': { key: 'flag1', value: true, version: 1, variation: 0, trackEvents: false, trackReason: false, variations: [] },
			},
			overrides: {},
			availableVariations: {},
			lastSyncTime: '2024-01-01T00:00:00Z',
		};

		axiosStub = sinon.stub(axios, 'get').resolves({ data: mockProject });

		let refreshFired = false;
		devServerProvider.onDidRefresh.event(() => {
			refreshFired = true;
		});

		await devServerProvider.refresh();

		assert.strictEqual(refreshFired, true, 'onDidRefresh should fire after successful refresh');
	});

	test('onDidRefresh does not fire on failed refresh', async () => {
		axiosStub = sinon.stub(axios, 'get').rejects(new Error('Connection refused'));

		let refreshFired = false;
		devServerProvider.onDidRefresh.event(() => {
			refreshFired = true;
		});

		await devServerProvider.refresh();

		assert.strictEqual(refreshFired, false, 'onDidRefresh should not fire on failed refresh');
	});

	test('onDidRefresh does not fire when disconnected', async () => {
		when(mockConfiguration.isDevServerEnabled()).thenReturn(false);

		let refreshFired = false;
		devServerProvider.onDidRefresh.event(() => {
			refreshFired = true;
		});

		await devServerProvider.refresh();

		assert.strictEqual(refreshFired, false, 'onDidRefresh should not fire when disconnected');
	});

	test('getProject returns cached project data', async () => {
		const mockProject: DevServerProject = {
			key: 'test-project',
			sourceEnvironmentKey: 'production',
			context: {},
			flagsState: {
				'flag1': { key: 'flag1', value: true, version: 1, variation: 0, trackEvents: false, trackReason: false, variations: [] },
			},
			overrides: {},
			availableVariations: {},
			lastSyncTime: '2024-01-01T00:00:00Z',
		};

		axiosStub = sinon.stub(axios, 'get').resolves({ data: mockProject });
		await devServerProvider.refresh();

		const project = devServerProvider.getProject();
		assert.ok(project);
		assert.strictEqual(project.key, 'test-project');
	});

	test('getAllFlags returns map of cached flags', async () => {
		const mockProject: DevServerProject = {
			key: 'test-project',
			sourceEnvironmentKey: 'production',
			context: {},
			flagsState: {
				'flag1': { key: 'flag1', value: true, version: 1, variation: 0, trackEvents: false, trackReason: false, variations: [] },
				'flag2': { key: 'flag2', value: 'hello', version: 1, variation: 0, trackEvents: false, trackReason: false, variations: [] },
			},
			overrides: {},
			availableVariations: {},
			lastSyncTime: '2024-01-01T00:00:00Z',
		};

		axiosStub = sinon.stub(axios, 'get').resolves({ data: mockProject });
		await devServerProvider.refresh();

		const allFlags = devServerProvider.getAllFlags();
		assert.strictEqual(allFlags.size, 2);
		assert.ok(allFlags.has('flag1'));
		assert.ok(allFlags.has('flag2'));
	});

	test('getLastRefreshTime returns time after refresh', async () => {
		const mockProject: DevServerProject = {
			key: 'test-project',
			sourceEnvironmentKey: 'production',
			context: {},
			flagsState: {},
			overrides: {},
			availableVariations: {},
			lastSyncTime: '2024-01-01T00:00:00Z',
		};

		axiosStub = sinon.stub(axios, 'get').resolves({ data: mockProject });

		assert.strictEqual(devServerProvider.getLastRefreshTime(), null);
		
		await devServerProvider.refresh();
		
		const lastRefresh = devServerProvider.getLastRefreshTime();
		assert.ok(lastRefresh instanceof Date);
	});

	test('onDidRefresh does not fire when data has not changed', async () => {
		const mockProject: DevServerProject = {
			key: 'test-project',
			sourceEnvironmentKey: 'production',
			context: {},
			flagsState: {
				'flag1': { key: 'flag1', value: true, version: 1, variation: 0, trackEvents: false, trackReason: false, variations: [] },
			},
			overrides: {},
			availableVariations: {},
			lastSyncTime: '2024-01-01T00:00:00Z',
		};

		axiosStub = sinon.stub(axios, 'get').resolves({ data: mockProject });

		// First refresh — should fire
		let fireCount = 0;
		devServerProvider.onDidRefresh.event(() => { fireCount++; });
		await devServerProvider.refresh();
		assert.strictEqual(fireCount, 1, 'Should fire on first refresh');

		// Second refresh with same data — should NOT fire
		await devServerProvider.refresh();
		assert.strictEqual(fireCount, 1, 'Should not fire again when data is unchanged');
	});

	test('onDidRefresh fires when data changes between refreshes', async () => {
		const projectV1: DevServerProject = {
			key: 'test-project',
			sourceEnvironmentKey: 'production',
			context: {},
			flagsState: {
				'flag1': { key: 'flag1', value: true, version: 1, variation: 0, trackEvents: false, trackReason: false, variations: [] },
			},
			overrides: {},
			availableVariations: {},
			lastSyncTime: '2024-01-01T00:00:00Z',
		};
		const projectV2: DevServerProject = {
			key: 'test-project',
			sourceEnvironmentKey: 'production',
			context: {},
			flagsState: {
				'flag1': { key: 'flag1', value: false, version: 2, variation: 1, trackEvents: false, trackReason: false, variations: [] },
			},
			overrides: {},
			availableVariations: {},
			lastSyncTime: '2024-01-01T00:00:00Z',
		};

		axiosStub = sinon.stub(axios, 'get');
		axiosStub.onFirstCall().resolves({ data: projectV1 });
		axiosStub.onSecondCall().resolves({ data: projectV2 });

		let fireCount = 0;
		devServerProvider.onDidRefresh.event(() => { fireCount++; });

		await devServerProvider.refresh();
		assert.strictEqual(fireCount, 1);

		await devServerProvider.refresh();
		assert.strictEqual(fireCount, 2, 'Should fire again when data changes');
	});

	test('onDidRefresh fires when override changes between refreshes', async () => {
		const projectNoOverride: DevServerProject = {
			key: 'test-project',
			sourceEnvironmentKey: 'production',
			context: {},
			flagsState: {
				'flag1': { key: 'flag1', value: true, version: 1, variation: 0, trackEvents: false, trackReason: false, variations: [] },
			},
			overrides: {},
			availableVariations: {},
			lastSyncTime: '2024-01-01T00:00:00Z',
		};
		const projectWithOverride: DevServerProject = {
			key: 'test-project',
			sourceEnvironmentKey: 'production',
			context: {},
			flagsState: {
				'flag1': { key: 'flag1', value: true, version: 1, variation: 0, trackEvents: false, trackReason: false, variations: [] },
			},
			overrides: {
				'flag1': { value: false, version: 2 },
			},
			availableVariations: {},
			lastSyncTime: '2024-01-01T00:00:00Z',
		};

		axiosStub = sinon.stub(axios, 'get');
		axiosStub.onFirstCall().resolves({ data: projectNoOverride });
		axiosStub.onSecondCall().resolves({ data: projectWithOverride });

		let fireCount = 0;
		devServerProvider.onDidRefresh.event(() => { fireCount++; });

		await devServerProvider.refresh();
		assert.strictEqual(fireCount, 1);

		await devServerProvider.refresh();
		assert.strictEqual(fireCount, 2, 'Should fire when override is added');
	});

	test('clearCache clears all cached data', async () => {
		const mockProject: DevServerProject = {
			key: 'test-project',
			sourceEnvironmentKey: 'production',
			context: {},
			flagsState: {
				'flag1': { key: 'flag1', value: true, version: 1, variation: 0, trackEvents: false, trackReason: false, variations: [] },
			},
			overrides: {},
			availableVariations: {},
			lastSyncTime: '2024-01-01T00:00:00Z',
		};

		axiosStub = sinon.stub(axios, 'get').resolves({ data: mockProject });
		await devServerProvider.refresh();
		
		assert.ok(devServerProvider.getFlag('flag1'));
		
		devServerProvider.clearCache();
		
		assert.strictEqual(devServerProvider.getFlag('flag1'), undefined);
		assert.strictEqual(devServerProvider.getLastRefreshTime(), null);
	});
});
