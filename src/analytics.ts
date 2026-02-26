import * as LDClient from 'launchdarkly-node-client-sdk';
import { Disposable, env } from 'vscode';

const CLIENT_SIDE_ID = process.env.LD_ANALYTICS_CLIENT_ID;
const BASE_URL = process.env.LD_ANALYTICS_BASE_URL;
const STREAM_URL = process.env.LD_ANALYTICS_STREAM_URL;
const EVENTS_URL = process.env.LD_ANALYTICS_EVENTS_URL;

/**
 * Internal analytics client using the LaunchDarkly Node Client SDK.
 * Uses a client-side ID (safe to embed — not a secret) to send
 * usage telemetry events. Respects VS Code telemetry settings.
 */
class AnalyticsClient implements Disposable {
	private client: LDClient.LDClient | null = null;
	private enabled = false;
	private initPromise: Promise<void> | null = null;

	async initialize(extensionVersion: string): Promise<void> {
		console.log('env.isTelemetryEnabled', env.isTelemetryEnabled);
		console.log('LD_ANALYTICS_CLIENT_ID', CLIENT_SIDE_ID);
		console.log('LD_ANALYTICS_BASE_URL', BASE_URL);
		console.log('LD_ANALYTICS_STREAM_URL', STREAM_URL);
		console.log('LD_ANALYTICS_EVENTS_URL', EVENTS_URL);

		if (!CLIENT_SIDE_ID || !BASE_URL || !STREAM_URL || !EVENTS_URL || !env.isTelemetryEnabled) {
			return;
		}

		if (this.initPromise) {
			return this.initPromise;
		}

		this.initPromise = this.doInitialize(extensionVersion);
		return this.initPromise;
	}

	private async doInitialize(extensionVersion: string): Promise<void> {
		try {
			const context: LDClient.LDContext = {
				kind: 'ld-vscode-user',
				key: env.machineId,
				vscodeVersion: env.appName,
				extensionVersion,
			};

			this.client = LDClient.initialize(CLIENT_SIDE_ID, context, {
				baseUrl: BASE_URL,
				streamUrl: STREAM_URL,
				eventsUrl: EVENTS_URL,
			});
			await this.client.waitForInitialization();
			this.enabled = true;

			env.onDidChangeTelemetryEnabled((telemetryEnabled) => {
				this.enabled = telemetryEnabled;
			});
		} catch (err) {
			console.error('[LaunchDarkly Analytics] Failed to initialize:', err);
			this.client = null;
			this.enabled = false;
		}
	}

	track(event: string, data?: LDClient.LDFlagValue): void {
		if (!this.enabled || !this.client) {
			return;
		}
		try {
			this.client.track(event, data);
		} catch (err) {
			console.error(`[LaunchDarkly Analytics] Failed to track event "${event}":`, err);
		}
	}

	async dispose(): Promise<void> {
		if (this.client) {
			try {
				await this.client.flush();
			} catch {
				// Best-effort flush on shutdown
			}
			this.client.close();
			this.client = null;
		}
		this.enabled = false;
		this.initPromise = null;
	}
}

export const analytics = new AnalyticsClient();
