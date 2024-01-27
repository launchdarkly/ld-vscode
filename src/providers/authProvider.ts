import {
	authentication,
	AuthenticationProvider,
	AuthenticationProviderAuthenticationSessionsChangeEvent,
	AuthenticationSession,
	Disposable,
	env,
	EventEmitter,
	ExtensionContext,
	ProgressLocation,
	QuickPickItem,
	Uri,
	UriHandler,
	window,
	workspace,
} from 'vscode';
import { v4 as uuid } from 'uuid';
import { PromiseAdapter, promiseFromEvent } from '../utils/common';
import fetch from 'node-fetch';
import { Member, Team } from '../models';
import { legacyAuth } from '../utils';

export const AUTH_TYPE = `launchdarkly`;
const AUTH_NAME = `LaunchDarkly`;
const LAUNCHDARKLY_OAUTH_DOMAIN = `hello-world-restless-violet-9097.dobrien-nj.workers.dev`; // Adjust if necessary
//const LAUNCHDARKLY_OAUTH_DOMAIN = `ldprobotdevo.ngrok.io/vscode`; // Adjust if necessary
const SESSIONS_SECRET_KEY = `${AUTH_TYPE}.sessions`;

class UriEventHandler extends EventEmitter<Uri> implements UriHandler {
	public handleUri(uri: Uri) {
		this.fire(uri);
	}
}

export interface LaunchDarklyAuthenticationSession extends AuthenticationSession {
	refreshToken: string;
	baseUri: string;
	fullUri: string;
	teams: Team[];
	apiToken?: string;
}

interface TokenInformation {
	access_token: string;
	refresh_token: string;
}

interface TokenInformationWithBase extends TokenInformation {
	baseUri: string;
}
export class LaunchDarklyAuthenticationProvider implements AuthenticationProvider, Disposable {
	private _sessionChangeEmitter = new EventEmitter<AuthenticationProviderAuthenticationSessionsChangeEvent>();
	private _disposable: Disposable;
	private _pendingStates: string[] = [];
	private _codeExchangePromises = new Map<string, { promise: Promise<string>; cancel: EventEmitter<void> }>();
	private _uriHandler = new UriEventHandler();

	constructor(private readonly context: ExtensionContext) {
		this._disposable = Disposable.from(
			authentication.registerAuthenticationProvider(AUTH_TYPE, AUTH_NAME, this, { supportsMultipleAccounts: false }),
			window.registerUriHandler(this._uriHandler),
		);
	}

	get onDidChangeSessions() {
		return this._sessionChangeEmitter.event;
	}

	// get redirectUri() {
	// 	const publisher = this.context.extension.packageJSON.publisher;
	// 	const name = this.context.extension.packageJSON.name;
	// 	return `${env.uriScheme}://${publisher}.${name}`;
	// }

	/**
	 * Get the existing sessions
	 * @param scopes
	 * @returns
	 */
	public async getSessions(): Promise<readonly LaunchDarklyAuthenticationSession[]> {
		try {
			const allSessions = await this.context.secrets.get(SESSIONS_SECRET_KEY);
			if (allSessions.length === 2) {
				return [];
			}

			const sessions = JSON.parse(allSessions) as LaunchDarklyAuthenticationSession;
			const session = sessions[0];
			const useLegacy = legacyAuth();
			if (session && session.refreshToken && !useLegacy) {
				const refreshToken = session.refreshToken;
				const { access_token } = await this.getAccessToken(refreshToken);

				if (access_token) {
					const updatedSession = Object.assign({}, session, { accessToken: access_token, scopes: 'writer' });
					return [updatedSession];
				} else {
					this.removeSession(session.id);
				}
			} else {
				return [session];
			}
		} catch (e) {
			// Nothing to do
			console.log(e);
			console.log('Error in session');
			return [];
		}

		return [];
	}

	/**
	 * Create a new auth session
	 * @param scopes
	 * @returns
	 */
	public async createSession(scopes: string[]): Promise<AuthenticationSession> {
		try {
			const { access_token, refresh_token, baseUri } = await this.login(scopes);
			if (!access_token) {
				throw new Error(`LaunchDarkly login failure`);
			}
			const fullUri = `https://${baseUri}`;
			// eslint-disable-next-line @typescript-eslint/ban-ts-comment
			// @ts-ignore
			const userInfo: { firstName: string; lastName: string; email: string; teams: Team[] } = await this.getUserInfo(
				access_token,
				fullUri,
			);

			const session: LaunchDarklyAuthenticationSession = {
				id: uuid(),
				accessToken: access_token,
				refreshToken: refresh_token,
				account: {
					label: `${userInfo.firstName} ${userInfo.lastName}`,
					id: userInfo.email,
				},
				baseUri: baseUri,
				fullUri: fullUri,
				teams: userInfo.teams,
				scopes: ['writer'],
			};

			await this.context.secrets.store(SESSIONS_SECRET_KEY, JSON.stringify([session]));

			this._sessionChangeEmitter.fire({ added: [session], removed: [], changed: [] });

			return session;
		} catch (e) {
			window.showErrorMessage(`Sign in failed: ${e}`);
			throw e;
		}
	}

	/**
	 * Remove an existing session
	 * @param sessionId
	 */
	public async removeSession(sessionId: string): Promise<void> {
		const allSessions = await this.context.secrets.get(SESSIONS_SECRET_KEY);
		if (allSessions) {
			const sessions = JSON.parse(allSessions) as AuthenticationSession[];
			const sessionIdx = sessions.findIndex((s) => s.id === sessionId);
			const session = sessions[sessionIdx];
			sessions.splice(sessionIdx, 1);

			await this.context.secrets.store(SESSIONS_SECRET_KEY, JSON.stringify(sessions));

			if (session) {
				this._sessionChangeEmitter.fire({ added: [], removed: [session], changed: [] });
			}
		}
	}

	/**
	 * Dispose the registered services
	 */
	public async dispose() {
		this._disposable.dispose();
	}

	/**
	 * Log in to LaunchDarkly
	 */
	private async login(scopes: string[] = []) {
		return await window.withProgress<TokenInformationWithBase>(
			{
				location: ProgressLocation.Notification,
				title: 'Signing in to LaunchDarkly...',
				cancellable: true,
			},
			async (_, token) => {
				const stateId = uuid();
				this._pendingStates.push(stateId);
				const scopeString = scopes.join(' ');
				const instances: QuickPickItem[] = [{ label: 'Commercial' }, { label: 'Federal' }, { label: 'Other' }];
				const pickInstance = await window.showQuickPick(instances, {
					title: 'LaunchDarkly Instance',
					placeHolder: 'Select LaunchDarkly Instance',
					ignoreFocusOut: true,
				});
				if (!pickInstance.label) {
					window.showInformationMessage('No instance selected');
					return;
				}
				let ldBaseUri;
				let appBaseUri;
				switch (pickInstance.label) {
					case 'Commercial':
						ldBaseUri = `${LAUNCHDARKLY_OAUTH_DOMAIN}`;
						appBaseUri = `app.launchdarkly.com`;
						break;
					case 'Federal':
						ldBaseUri = 'app.launchdarkly.us';
						appBaseUri = `app.launchdarkly.us`;
						break;
					case 'Other': {
						let baseUris;
						if (workspace.getConfiguration('launchdarkly').get('baseUri', '')) {
							const base = workspace.getConfiguration('launchdarkly').get('baseUri', '').replace('https://', '');
							baseUris = `unused,${base}`;
						} else {
							baseUris = await window.showInputBox({
								title: 'LaunchDarkly Instance',
								placeHolder: 'Enter LaunchDarkly Instance',
								ignoreFocusOut: true,
							});
						}
						[ldBaseUri, appBaseUri] = baseUris.split(',');
						break;
					}
				}

				const useLegacy = legacyAuth();
				if (useLegacy) {
					let updatedToken;
					const existingToken = await this.context.secrets.get('launchdarkly_accessToken');
					const token = await window.showInputBox({
						title: 'LaunchDarkly API Token',
						placeHolder: 'Enter LaunchDarkly API Token',
						value: existingToken ? 'xxxx' + existingToken.substr(existingToken.length - 6) : '',
						ignoreFocusOut: true,
					});
					if (existingToken?.includes(token.substring(4))) {
						updatedToken = existingToken;
						await this.context.secrets.delete('launchdarkly.apiToken');
					} else {
						updatedToken = token;
					}
					// If secret existed in secret store, it's now moved to session.
					await this.context.secrets.delete('launchdarkly_accessToken');
					
					return { access_token: updatedToken, refresh_token: '', baseUri: appBaseUri };
				}

				const uri = Uri.parse(`https://${ldBaseUri}/login`);
				await env.openExternal(uri);

				let codeExchangePromise = this._codeExchangePromises.get(scopeString);
				if (!codeExchangePromise) {
					codeExchangePromise = promiseFromEvent(this._uriHandler.event, this.handleUri(scopes, appBaseUri));
					this._codeExchangePromises.set(scopeString, codeExchangePromise);
				}

				try {
					return await Promise.race([
						codeExchangePromise.promise,
						new Promise<string>((_, reject) => setTimeout(() => reject('Cancelled'), 60000)),
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						promiseFromEvent<any, any>(token.onCancellationRequested, (_, __, reject) => {
							reject('User Cancelled');
						}).promise,
					]);
				} finally {
					this._pendingStates = this._pendingStates.filter((n) => n !== stateId);
					codeExchangePromise?.cancel.fire();
					this._codeExchangePromises.delete(scopeString);
				}
			},
		);
	}

	/**
	 * Handle the redirect to VS Code (after sign in from LaunchDarkly)
	 * @param scopes
	 * @returns
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private handleUri: (scopes: readonly string[], baseUri: string) => PromiseAdapter<Uri, any> =
		(scopes, baseUri) => async (uri, resolve, reject) => {
			const query = new URLSearchParams(uri.query);
			const access_token = query.get('access_token');
			const refresh_token = query.get('refresh_token');
			if (!access_token) {
				reject(new Error('No token'));
				return;
			}
			// Check if it is a valid auth request started by the extension
			// if (!this._pendingStates.some(n => n === state)) {
			// reject(new Error('State not found'));
			// return;
			// }

			resolve({ access_token, refresh_token, baseUri });
		};

	/**
	 * Get the user info from LaunchDarkly
	 * @param token
	 * @returns
	 */
	private async getUserInfo(token: string, fullUri): Promise<Member> {
		const apiToken = legacyAuth() ? token : `Bearer ${token}`;
		const response = await fetch(`${fullUri}/api/v2/members/me`, {
			headers: {
				Authorization: apiToken,
			},
		});
		//const serviceTokenError = `reflexive member id 'me' is invalid when authenticated with a service token`;
		const res = await response;

		if (res.status == 404) {
			return { firstName: 'Service', lastName: 'Account', email: 'none', teams: [] };
		} else if (res.status !== 200 && res.status !== 201) {
			window.showErrorMessage(`[LaunchDarkly] Failed to get user info: ${res.status}`);
		}
		return (await response.json()) as Member;
	}

	/**
	 * Retrieve a new access token by the refresh token
	 * @param refreshToken
	 * @param clientId
	 * @returns
	 */
	private async getAccessToken(refreshToken: string): Promise<TokenInformation> {
		try {
			// only token is needed for request but leaving rest if we fix in future.
			const body = {
				grant_type: 'refresh_token',
				refresh_token: refreshToken,
			};
			const reqBody = {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
				},
				body: JSON.stringify(body),
			};
			const response = await fetch(`https://${LAUNCHDARKLY_OAUTH_DOMAIN}/refresh`, reqBody);

			const res = (await response.json()) as TokenInformation;
			return { access_token: res.access_token, refresh_token: '' };
		} catch (err) {
			console.log(err);
		}
	}
}
