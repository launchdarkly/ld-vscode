import * as vscode from 'vscode';
import * as request from 'request';
import { kebabCase } from 'lodash';
import { LDFlagValue } from 'ldclient-node';
import * as url from 'url';

export const FLAG_KEY_REGEX = /[A-Za-z0-9][\.A-Za-z_\-0-9]*/;
const STRING_DELIMETERS = ['"', "'", '`'];

export function getProject(settings: vscode.WorkspaceConfiguration) {
	return settings.get<string>('project');
}

export function getEnvironment(settings: vscode.WorkspaceConfiguration) {
	if (settings.get<string>('env')) {
		return settings.get<string>('env');
	}
	vscode.window.showWarningMessage('[LaunchDarkly] env is not set. Falling back to first environment.');
	return '';
}

export function getFeatureFlag(settings: vscode.WorkspaceConfiguration, flagKey: string, cb: Function) {
	let baseUri = settings.get<string>('baseUri');
	let project = getProject(settings);
	let env = getEnvironment(settings);
	let envParam = env ? '?env=' + env : '';
	let options = {
		url: url.resolve(baseUri, `api/v2/flags/${project}/${flagKey + envParam}`),
		headers: {
			Authorization: settings.get('accessToken'),
		},
	};
	request(options, (error, response, body) => {
		if (!error) {
			if (response.statusCode == 200) {
				cb(JSON.parse(body));
			} else if (response.statusCode == 404) {
				// Try resolving the flag key to kebab case
				options.url = url.resolve(baseUri, `api/v2/flags/${project}/${kebabCase(flagKey) + envParam}`);
				request(options, (error, response, body) => {
					if (!error) {
						if (response.statusCode == 200) {
							cb(JSON.parse(body));
						} else if (response.statusCode == 404) {
							vscode.window.showErrorMessage(`[LaunchDarkly] Could not find the flag ${flagKey}`);
							return;
						} else {
							vscode.window.showErrorMessage(`[LaunchDarkly] Encountered an unexpected retrieving the flag ${flagKey}`);
						}
					} else {
						vscode.window.showErrorMessage(
							`[LaunchDarkly] Encountered an unexpected error retrieving the flag ${flagKey}`,
						);
					}
				});
			} else {
				vscode.window.showErrorMessage(response.statusCode);
			}
		} else {
			vscode.window.showErrorMessage(`[LaunchDarkly] Encountered an unexpected error retrieving the flag ${flagKey}`);
		}
	});
}

export function generateHoverString(flag: LDFlagValue) {
	return `**LaunchDarkly feature flag**\n
	Key: ${flag.key}
	Enabled: ${flag.on}
	Default variation: ${JSON.stringify(flag.variations[flag.fallthrough.variation])}
	Off variation: ${JSON.stringify(flag.variations[flag.offVariation])}
	${plural(flag.prerequisites.length, 'prerequisite', 'prerequisites')}
	${plural(flag.targets.reduce((acc, curr) => acc + curr.values.length, 0), 'user target', 'user targets')}
	${plural(flag.rules.length, 'rule', 'rules')}`;
}

function plural(count: number, singular: string, plural: string) {
	return count === 1 ? `1 ${singular}` : `${count} ${plural}`;
}

export function isPrecedingCharStringDelimeter(document: vscode.TextDocument, position: vscode.Position) {
	const range = document.getWordRangeAtPosition(position, FLAG_KEY_REGEX);
	const c = new vscode.Range(
		range.start.line,
		candidateTextStartLocation(range.start.character),
		range.start.line,
		range.start.character,
	);
	const candidate = document.getText(c).trim();
	return STRING_DELIMETERS.indexOf(candidate) >= 0;
}

const candidateTextStartLocation = (char: number) => (char === 1 ? 0 : char - 2);