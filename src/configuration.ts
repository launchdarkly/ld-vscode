import * as vscode from 'vscode';

export const DEFAULT_BASE_URI = 'https://app.launchdarkly.com';
export const DEFAULT_STREAM_URI = 'https://stream.launchdarkly.com';

export interface IConfiguration {
	/**
   * Your LaunchDarkly API access token with reader-level permissions. Required.
   */
	accessToken: string;

	/**
   * Your LaunchDarkly SDK key. Required.
   */
	sdkKey: string;

	/**
   * Your LaunchDarkly project key, should match the provided SDK key. Required.
   */
	project: string;

	/**
   * Your LaunchDarkly environment key, should match the provided SDK key.
   */
	env: string;

	/**
   * Enables flag info to be displayed on hover of a valid flag key.
   */
	enableHover: boolean;

	/**
   * Enable flag key autocompletion.
   */
	enableAutocomplete: boolean;

	/**
   * The LaunchDarkly base uri to be used. Optional.
   */
	baseUri: string;

	/**
   * The LaunchDarkly stream uri to be used. Optional.
   */
	streamUri: string;
}

class Configuration implements IConfiguration {
  constructor() {
    this.reload();
  }

  reload() {
    let config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration('launchdarkly');
    for (const option in this) {
      this[option] = config[option];
    }
  }

	accessToken = '';
  sdkKey = '';
  project = '';
  env = '';
  enableHover = true;
  enableAutocomplete = true;
  baseUri = DEFAULT_BASE_URI;
  streamUri = DEFAULT_STREAM_URI;
}

export const configuration = new Configuration();