//write a class to read pubnub messages and make them available to the rest of the app
import PubNub from 'pubnub';
import { logDebugMessage } from '../utils/logDebugMessage';
import { ILDExtensionConfiguration } from '../models';

export class DebuggerHandler {
	private config: ILDExtensionConfiguration;
	private pubnub: PubNub;
	private featureEvents: unknown[];
	private identifyEvents: unknown[];
	private flagKey: string;
	private featureKeys = new Set();

	constructor(config: ILDExtensionConfiguration, flagKey?: string) {
		this.config = config;
		this.featureEvents = [];
		this.identifyEvents = [];
		this.featureKeys = new Set();
		this.flagKey = flagKey;
		this.pubnub = new PubNub({
			subscribeKey: 'sub-c-981becf0-a0e2-11e4-90a2-0619f8945a4f',
			userId: 'tester1',
			cryptoModule: PubNub.CryptoModule.legacyCryptoModule({
				cipherKey: config.getEnvironment()._pubnub.cipherKey,
				useRandomIVs: false,
			}),
		});

		this.pubnub.subscribe({
			channels: [this.config.getEnvironment()._pubnub.channel],
			withPresence: true,
		});
	}

	getFeatureEvents = () => {
		return this.featureEvents;
	};

	subscribe = () => {
		this.pubnub.subscribe({
			channels: [this.config.getEnvironment()._pubnub.channel],
			withPresence: true,
		});
		try {
			this.pubnub.addListener({
				message: (event) => {
					console.log('message');
					for (const message of event.message) {
						//console.log(message)
						if (message.kind == 'index' || message.kind == 'identify') {
							this.identifyEvents.push(message);
						} else if ((message.kind == 'debug' || message.kind == 'feature') && message.key == this.flagKey) {
							this.featureEvents.push(message);
							this.featureKeys.add(message.key);
						} else if (message.kind == 'summary') {
							console.log(message);
						}
					}
					//console.log(event.message);
					//}
				},
				presence: function (p) {
					console.log('presence');
					// handle presence
					console.log(p);
				},
				signal: function (s) {
					// handle signals
					console.log(s);
				},
				status: function (s) {
					console.log('status');
					console.log(s);
					// handle status
				},
			});
		} catch (e) {
			console.log(e);
		}

		const here = this.pubnub.hereNow({
			channels: [this.config.getEnvironment()._pubnub.channel],
			includeUUIDs: true,
			includeState: true,
		});

		console.log(here);
	};

	unsubscribe = () => {
		logDebugMessage('unsubscribing from debug channel');
		this.pubnub.unsubscribe({
			channels: [this.config.getEnvironment()._pubnub.channel],
		});
	};

	setFlagKey = (flagKey: string) => {
		this.flagKey = flagKey;
	};

	getFilteredIdentifyEvents = () => {
		// eslint-disable-next-line @typescript-eslint/ban-ts-comment
		// @ts-ignore
		return this.identifyEvents.filter((event) => this.featureKeys.has(event.key));
	};

	getIdentifyEvents = () => {
		return this.identifyEvents;
	};
}
