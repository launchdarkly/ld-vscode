import { extensions } from 'vscode';

export const checkCopilotInstalled = () => {
	const extension = extensions.getExtension('github.copilot-chat');
	if (isTestEnvSet()) {
		return true;
	}

	if (!extension) {
		return false;
	}

	return true;
};

const isTestEnvSet = (): boolean => {
	return process.env.TEST_MODE !== undefined;
};
