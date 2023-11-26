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
} from 'vscode';
import { v4 as uuid } from 'uuid';
import { PromiseAdapter, promiseFromEvent } from '../utils/common';
import fetch from 'node-fetch';
import { Team } from '../models';

export const AUTH_TYPE = `launchdarkly`;
const AUTH_NAME = `LaunchDarkly`;
const CLIENT_ID = `512d1733-ea07-4414-95e8-37e8e1b9716a`; // Replace with your LaunchDarkly Client ID
const LAUNCHDARKLY_OAUTH_DOMAIN = `hello-world-restless-violet-9097.dobrien-nj.workers.dev`; // Adjust if necessary
const SESSIONS_SECRET_KEY = `${AUTH_TYPE}.sessions`;

class UriEventHandler extends EventEmitter<Uri> implements UriHandler {
	public handleUri(uri: Uri) {
		this.fire(uri);
	}
}

export interface LaunchDarklyAuthenticationSession extends AuthenticationSession {
	refreshToken: string;
	baseUri: string;
	teams: Team[];
}

interface TokenInformation {
	access_token: string;
	refresh_token: string;
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

	get redirectUri() {
		const publisher = this.context.extension.packageJSON.publisher;
		const name = this.context.extension.packageJSON.name;
		return `${env.uriScheme}://${publisher}.${name}`;
	}

	/**
	 * Get the existing sessions
	 * @param scopes
	 * @returns
	 */
	public async getSessions(scopes?: string[]): Promise<readonly LaunchDarklyAuthenticationSession[]> {
		try {
			const allSessions = await this.context.secrets.get(SESSIONS_SECRET_KEY);
			if (allSessions.length === 2) {
				return [];
			}

			const sessions = JSON.parse(allSessions) as LaunchDarklyAuthenticationSession;
			const session = sessions[0];
			if (session && session.refreshToken) {
				const refreshToken = session.refreshToken;
				const { access_token } = await this.getAccessToken(refreshToken, CLIENT_ID);

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
			// eslint-disable-next-line @typescript-eslint/ban-ts-comment
			//@ts-ignore
			const { access_token, refresh_token, baseUri } = await this.login(scopes);
			if (!access_token) {
				throw new Error(`LaunchDarkly login failure`);
			}

			// eslint-disable-next-line @typescript-eslint/ban-ts-comment
			// @ts-ignore
			const userInfo: { firstName: string; lastName: string; email: string; teams: Team[] } = await this.getUserInfo(
				access_token,
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
		return await window.withProgress<string>(
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
				});
				let ldBaseUri;
				let appBaseUri;
				switch (pickInstance.label) {
					case 'Commercial':
						ldBaseUri = `${LAUNCHDARKLY_OAUTH_DOMAIN}`;
						appBaseUri = `app.launchdarkly.com`;
						break;
					case 'Federal':
						ldBaseUri = 'app.launchdarkly.us';
						appBaseUri = `app.launchdarkly.com`;
						break;
					case 'Other': {
						const baseUris = await window.showInputBox({
							title: 'LaunchDarkly Instance',
							placeHolder: 'Enter LaunchDarkly Instance',
						});
						[ldBaseUri, appBaseUri] = baseUris.split(',');
						break;
					}
				}

				const uri = Uri.parse(`https://${ldBaseUri}/login?bbb`);
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
	private async getUserInfo(token: string) {
		const response = await fetch(`https://app.launchdarkly.com/api/v2/members/me`, {
			headers: {
				Authorization: `Bearer ${token}`,
			},
		});
		return await response.json();
	}

	/**
	 * Retrieve a new access token by the refresh token
	 * @param refreshToken
	 * @param clientId
	 * @returns
	 */
	private async getAccessToken(refreshToken: string, clientId: string): Promise<TokenInformation> {
		try {
			// only token is needed for request but leaving rest if we fix in future.
			const body = {
				client_id: clientId,
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
