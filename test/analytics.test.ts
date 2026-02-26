import * as assert from 'assert';
import * as sinon from 'sinon';
import { AnalyticsClient, AnalyticsConfig } from '../src/analytics';

const TEST_CONFIG: AnalyticsConfig = {
	clientSideId: 'test-client-side-id',
	baseUrl: 'http://localhost:8080',
	streamUrl: 'http://localhost:8080',
	eventsUrl: 'http://localhost:8080',
};

suite('AnalyticsClient tests', () => {
	teardown(() => {
		sinon.restore();
	});

	test('initialize skips when config is null', async () => {
		const client = new AnalyticsClient(null);
		await client.initialize('1.0.0');

		// No error thrown, track is a no-op
		client.track('test-event');

		await client.dispose();
	});

	test('track is a no-op when not initialized', () => {
		const client = new AnalyticsClient(TEST_CONFIG);

		// Should not throw even though SDK was never initialized
		assert.doesNotThrow(() => {
			client.track('test-event');
		});
	});

	test('track is a no-op when config is null', async () => {
		const client = new AnalyticsClient(null);
		await client.initialize('1.0.0');

		assert.doesNotThrow(() => {
			client.track('test-event');
			client.track('another-event', { key: 'value' });
		});

		await client.dispose();
	});

	test('dispose is safe to call when not initialized', async () => {
		const client = new AnalyticsClient(TEST_CONFIG);

		await assert.doesNotReject(async () => {
			await client.dispose();
		});
	});

	test('dispose is safe to call multiple times', async () => {
		const client = new AnalyticsClient(null);

		await assert.doesNotReject(async () => {
			await client.dispose();
			await client.dispose();
		});
	});

	test('track does not throw after dispose', async () => {
		const client = new AnalyticsClient(TEST_CONFIG);
		await client.dispose();

		assert.doesNotThrow(() => {
			client.track('test-event');
		});
	});

	test('constructor accepts null config gracefully', () => {
		assert.doesNotThrow(() => {
			const client = new AnalyticsClient(null);
			assert.ok(client);
		});
	});

	test('constructor accepts valid config', () => {
		assert.doesNotThrow(() => {
			const client = new AnalyticsClient(TEST_CONFIG);
			assert.ok(client);
		});
	});

	test('initialize is idempotent before resolution', async () => {
		// With null config, both calls should resolve immediately without error
		const client = new AnalyticsClient(null);

		const p1 = client.initialize('1.0.0');
		const p2 = client.initialize('1.0.0');

		await assert.doesNotReject(async () => {
			await Promise.all([p1, p2]);
		});

		await client.dispose();
	});

	test('can reinitialize after dispose with null config', async () => {
		const client = new AnalyticsClient(null);
		await client.initialize('1.0.0');
		await client.dispose();

		// After dispose, initPromise is cleared, so initialize can be called again
		await assert.doesNotReject(async () => {
			await client.initialize('2.0.0');
		});
	});
});
