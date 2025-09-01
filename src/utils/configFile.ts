import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { logDebugMessage } from './logDebugMessage';

async function readCLIConfigFile(): Promise<Record<string, unknown> | null> {
	try {
		const configPath = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
		const filePath = path.join(configPath, 'ldcli', 'config.yml');

		const fileContent = await fs.readFile(filePath, 'utf8');
		return yaml.load(fileContent) as Record<string, unknown>;
	} catch (error) {
		logDebugMessage(`Error reading config file: ${error}`);
		return null;
	}
}

export async function getCLIAccessToken(): Promise<string | null> {
	const config = await readCLIConfigFile();
	if (config && typeof config['access-token'] === 'string') {
		return config['access-token'];
	}
	logDebugMessage('No access token found in config file');
	return null;
}

export async function getBaseUri(): Promise<string | null> {
	const config = await readCLIConfigFile();
	if (config && typeof config['base-uri'] === 'string') {
		return config['base-uri'];
	}
	logDebugMessage('No baseUri found in config file');
	return null;
}
