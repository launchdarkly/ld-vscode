import * as LDClient from 'launchdarkly-node-client-sdk';
import { Disposable, env } from 'vscode';

export interface AnalyticsConfig {
	clientSideId: string;
	baseUrl: string;
	streamUrl: string;
	eventsUrl: string;
}

function getConfigFromEnv(): AnalyticsConfig | null {
	const clientSideId = process.env.LD_ANALYTICS_CLIENT_ID;
	const baseUrl = process.env.LD_ANALYTICS_BASE_URL;
	const streamUrl = process.env.LD_ANALYTICS_STREAM_URL;
	const eventsUrl = process.env.LD_ANALYTICS_EVENTS_URL;

	if (!clientSideId || !baseUrl || !streamUrl || !eventsUrl) {
		return null;
	}
	return { clientSideId, baseUrl, streamUrl, eventsUrl };
}

/**
 * Internal analytics client using the LaunchDarkly Node Client SDK.
 * Uses a client-side ID (safe to embed — not a secret) to send
 * usage telemetry events. Respects VS Code telemetry settings.
 */
export class AnalyticsClient implements Disposable {
	private client: LDClient.LDClient | null = null;
	private enabled = false;
	private initPromise: Promise<void> | null = null;
	private config: AnalyticsConfig | null;

	constructor(config?: AnalyticsConfig | null) {
		this.config = config ?? getConfigFromEnv();
	}

	async initialize(extensionVersion: string): Promise<void> {
		if (!this.config || !env.isTelemetryEnabled) {
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

			this.client = LDClient.initialize(this.config.clientSideId, context, {
				baseUrl: this.config.baseUrl,
				streamUrl: this.config.streamUrl,
				eventsUrl: this.config.eventsUrl,
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
