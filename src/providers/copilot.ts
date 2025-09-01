import * as vscode from 'vscode';
import {
	CancellationToken,
	ChatContext,
	ChatRequest,
	ChatRequestHandler,
	ChatResponseStream,
	ChatResult,
	tasks,
} from 'vscode';

import { CreateFlagMenu } from '../createFlagMenu';
import chooseFlagCmd from '../commands/chooseFlag';
import { FeatureFlag, IFlagStore, ILDExtensionConfiguration } from '../models';
import yaml from 'js-yaml';
import { flagSummaryInstructionsAssistantResponse } from '../prompts/flagSummaryInstructionsAssistantResponse';
import { flagSummaryInstructions } from '../prompts/flagSummaryInstructions';
import { LaunchDarklyReleaseProvider } from './releaseViewProvider';
import { isFlagReadyForCleanup } from '../utils/isFlagReadyForCleanup';
import { exampleFlag } from '../prompts/flagExample';
import { flagNamingConventions } from '../prompts/flagNamingConvention';
import { logDebugMessage } from '../utils/logDebugMessage';
import { generateHoverStringCopilot } from '../utils/hover';
import { CMD_LD_TOGGLE_CTX } from '../utils/commands';

export const LDCONST_CMD_CLEANUP = 'cleanup';
export const LDCONST_CMD_SUGGESTF = 'createFlag';
export const LDCONST_CMD_SUMMARIZE = 'explain';
export const RELATIVE_ROOT_DIR = '/';

const LANGUAGE_MODEL_ID = 'gpt-4o';

export interface LDChatAgentResult extends ChatResult {
	slashCommand: string;
}

export class CopilotProvider {
	private config: ILDExtensionConfiguration;
	private flagStore: IFlagStore;
	private debugEvents: unknown[];
	private releaseViewProvider: LaunchDarklyReleaseProvider;
	constructor(config: ILDExtensionConfiguration) {
		this.config = config;
		this.flagStore = config.getFlagStore();
		this.releaseViewProvider = new LaunchDarklyReleaseProvider(config);
	}

	private getModel = async () => {
		const models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: LANGUAGE_MODEL_ID });
		const gpt4Model = models.find((model) => model.family === LANGUAGE_MODEL_ID);
		return gpt4Model;
	};

	handler: ChatRequestHandler = async (
		request: ChatRequest,
		context: ChatContext,
		stream: ChatResponseStream,
		token: CancellationToken,
	): Promise<LDChatAgentResult> => {
		if (request.command === LDCONST_CMD_SUGGESTF) {
			this.config.getApi().logEvent('VSCode Copilot Chat', { command: LDCONST_CMD_SUGGESTF });
			if (request.prompt.length === 0) {
				stream.markdown('Please provide a description for the feature flag you want created.');
				return { slashCommand: '' };
			}
			const messages = [
				new vscode.LanguageModelChatMessage(
					vscode.LanguageModelChatMessageRole.User,
					`You are a feature flag naming assistant that helps users come up with good names for their feature flags. Your job is to suggest a good name for a feature flag based on the provided description.
						flagKey must only contain letters, numbers, ., _ or -. You cannot use "new" as a key, and a key cannot be changed after creation.
						The flagName and flagKey should resemble each other.
						${flagNamingConventions}
						
						
						You should respond using JSON in the form of
						{flagKey: <flagKey with no spaces>,
						flagName: <Human description name>,
						flagDescription: <flagDescription>}

						Do not wrap the JSON in a code block. Only the JSON object should be present in the response.
						
						Good Example:
						{"flagKey": "my-unique-flag-key",
						"flagName": "My Common flag",
						"flagDescription": "This is a unique description"}
						
						Bad Example:
						{"flagKey": "My Common flag",
						"flagName": "",
						"flagDescription": ""}
						`,
				),
				new vscode.LanguageModelChatMessage(vscode.LanguageModelChatMessageRole.User, request.prompt),
			];
			const getModel = await await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4' });
			const model = getModel[0];
			const chatResponse = await model.sendRequest(messages, {}, token);
			let reply = ``;
			try {
				// @ts-expect-error Cannot get Insider types
				for await (const fragment of chatResponse.text) {
					reply = reply.concat(fragment);
				}

				stream.progress(`Running LaunchDarkly Create Boolean Flag command`);

				const defaults = JSON.parse(reply);
				const menu = new CreateFlagMenu(this.config, defaults);
				const newFlag = await menu.collectInputs();
				stream.progress(`Flag successfully created!\n`);
				const newHover = generateHoverStringCopilot(newFlag, this.config);

				const md = new vscode.MarkdownString(`---\n${newHover.value}`);
				md.supportThemeIcons = true;
				md.appendMarkdown(`\n---\n`);
				stream.markdown(md);

				const toggleFlagCmd = {
					command: CMD_LD_TOGGLE_CTX,
					title: 'Toggle Flag',
					arguments: [newFlag.key],
				};

				stream.button(toggleFlagCmd);

				// See if there is a task call LDFlagGenerator in the task definitions and execute it.
				const getTasks = await tasks.fetchTasks();
				for (const t of getTasks) {
					if (t.name === 'LDFlagGenerator') {
						await tasks.executeTask(t);
					}
				}
				this.config.getCtx().workspaceState.update('LDFlagKey_Copilot', newFlag.key);

				return { slashCommand: 'LDCONST_CMD_SUGGESTF' };
			} catch (e) {
				console.log(e);
				stream.markdown(reply);
				stream.markdown('\n\nThere was an error processing your request. Please try again.');
				return { slashCommand: 'LDCONST_CMD_SUGGESTF' };
			}
		} else if (request.command === LDCONST_CMD_SUMMARIZE) {
			this.config.getApi().logEvent('VSCode Copilot Chat', { command: LDCONST_CMD_SUMMARIZE });
			stream.progress(`User Selecting LaunchDarkly flag`);
			let flagKey: string | undefined;
			if (request?.variables?.length > 0) {
				flagKey = request.variables[0].values[0].value as string;
			}

			const flagData = await chooseFlagCmd(this.config, flagKey);
			const messages = [
				new vscode.LanguageModelChatMessage(
					vscode.LanguageModelChatMessageRole.User,
					`
						Craft a summary that is detailed, thorough, in-depth, and complex, while maintaining clarity and conciseness.

						Incorporate main ideas and essential information, eliminating extraneous language and focusing on critical aspects.

						Rely strictly on the provided text, without including external information.

						References to variations should be resolved to their variation index Name value if one is present otherwise the variation Value value.

						If there is no data available on a specific section, omit it.
						`,
				),
				new vscode.LanguageModelChatMessage(
					vscode.LanguageModelChatMessageRole.User,
					`I'm going to provide you data about a feature flag. I want you to summarize that data. Write at least a paragraph summary of the metadata, you can use bullet points for targeting data(these you can explain a bit more in depth) you should explain the impact of the targeting using natural language. Be ready to answer questions I have about it`,
				),
				new vscode.LanguageModelChatMessage(
					vscode.LanguageModelChatMessageRole.Assistant,
					`Great. I will write at least a paragraph summary of the metadata, use bullet points for targeting data and explain the impact of the targeting using natural language. I'll be ready to answer any questions you.`,
				),
				new vscode.LanguageModelChatMessage(
					vscode.LanguageModelChatMessageRole.User,
					`Before I do give you the actual data, I'm going to give you a sample out in markdown for you to look at. For Flag Availability, Client is useEnvironmentId and Mobile is mobile. :
					Sample Output:
					"""
					${exampleFlag}
					"""`,
				),
				new vscode.LanguageModelChatMessage(
					vscode.LanguageModelChatMessageRole.Assistant,
					`Great, I'm ready to see the actual data.`,
				),
				new vscode.LanguageModelChatMessage(
					vscode.LanguageModelChatMessageRole.User,
					`Before that, there is one more thing I want you to understand. When referring to variations in the output, do not use numeric indexes. Instead, use the name field associated with each variation to indicate variation. Make sure to replace their numeric indexes with the exact names in your explanation or any output text you generate. Assume that the variations array contains detailed information about each variation in targeting, including a value, and a name. Your task is to interpret these details correctly and ensure that any reference to the variations in the output text explicitly mentions them by name, not by index.
					Sample Array:
					[
						{
								"_id": "1a878faa-39ea-4c01-b1ec-3ca89d4eec89",
								"description": "Kubernetes Cluster for Migration",
								"name": "K8",
								"value": true
						},
						{
								"_id": "ad80ab10-214b-4e45-8757-ad0e7a537c16",
								"description": "Existing Endpoint",
								"name": "Native",
								"value": false
						}
					]
					
					Bad Example:
					The flag has an off variation of index 1, corresponding to the "Native" variation, indicating that if the flag is turned off it will return variation 1, it will display the "Native" variation.

					Good Example:
					The flag has an off variation of "Native" with the value \`false\`, indicating that if the flag is turned off, it will display the "Native" variation.`,
				),
				new vscode.LanguageModelChatMessage(
					vscode.LanguageModelChatMessageRole.Assistant,
					`Understood. In this example when I'm summarizing data and it includes a reference to variation 0, I'd state that it's the \`Native\` variation. If the \`name\` key was empty I'd state the \`true\` variation.`,
				),
				new vscode.LanguageModelChatMessage(vscode.LanguageModelChatMessageRole.User, flagSummaryInstructions),
				new vscode.LanguageModelChatMessage(
					vscode.LanguageModelChatMessageRole.Assistant,
					flagSummaryInstructionsAssistantResponse,
				),
				new vscode.LanguageModelChatMessage(
					vscode.LanguageModelChatMessageRole.User,
					`Now that you've seen a sample output, here is the actual flag data:
					"""
					${yaml.dump(flagData)}`,
				),
			];
			try {
				const model = await this.getModel();
				const chatResponse = await model.sendRequest(messages, {}, token);
				// @ts-expect-error Cannot get Insider types
				for await (const fragment of chatResponse.text) {
					stream.markdown(fragment);
				}

				return { slashCommand: '' };
			} catch (e) {
				stream.markdown('There was an error processing your request. Please try again.');
				console.log(e);
			}
		} else if (request.command === LDCONST_CMD_CLEANUP) {
			this.config.getApi().logEvent('VSCode Copilot Chat', { command: LDCONST_CMD_CLEANUP });
			stream.progress(`User wants to clean up flag`);
			const flagData = await chooseFlagCmd(this.config);
			const isReadyForCleanup = await isFlagReadyForCleanup(
				this.config,
				(flagData.flagMetadata as FeatureFlag)?.key,
				this.releaseViewProvider,
				await this.config.getConfig().getStaleConfig(),
			);

			logDebugMessage(`isReadyForCleanup: ${JSON.stringify(isReadyForCleanup)}`);

			const messages = [
				new vscode.LanguageModelChatMessage(
					vscode.LanguageModelChatMessageRole.User,
					`
					Act as a LaunchDarkly flag cleanup assistant! Your goal is to identify whether or not this flag can be removed.
				`,
				),
				new vscode.LanguageModelChatMessage(
					vscode.LanguageModelChatMessageRole.User,
					`* You are about to evaluate whether a flag is ready to be cleaned up based on this result: ${JSON.stringify(isReadyForCleanup)}. 
					* Each top level key(Dependent Flags, Serving Single variation across critical environments, Last modified check, Temporary only) needs to be prefixed with one of the follow themicon values. Pass: "$(check)", Failed: "$(testing-failed-icon)", Unknown with "$(question)". 
					* If the flag data conditions meet the expected values then it is considered ready to cleanup.
					* "Dependent Flags": If there are NO dependent flags then it passes the check and should have $(checkmark) before the key. 
					* "isTemporary" is a configuration setting to let users know if this flag should only temporarily exist in code.
					* "Temporary": If "true" it passes the check.
					* "Release Pipeline": If the flag is released in the pipeline it passes the check: $(checkmark). If the status is "in progress": $(testing-failed-icon), "unknown": $(question)
					* You will receive all necessary information to make the determination. 
					* Your reply should cover each top level key of the object.
					* References keys should be in bold, and values should be in code blocks.
					* If the "passes the rules check is false" then "Serving single variation across critical environments" must be false.
					Partial Example: @@@"Based on the analysis of the flag <flag name> it is ready for cleanup\n* $(checkmark)**Dependent flags:** summary info..."@@@ 
					Full Example:
					@@@
					Below is an the analysis of the flag 02 - Release Wealth Management Module:

					$(heavy-check) Dependent flags: No dependent flags exist
					$(heavy-check) Serving single variation across critical environments: true
					$(heavy-check) Pass last modified check: true
					$(heavy-check) Temporary only: true

					Based on the above checks, the flag is ready to be cleaned up.
					@@@

					Take an extra look at your reply and make sure you are correctly formatting it.
					`,
				),
				new vscode.LanguageModelChatMessage(
					vscode.LanguageModelChatMessageRole.User,
					`Here is context that you will need to make the determination.
					flag: ${JSON.stringify(flagData)}
					isReadyForCleanup: ${JSON.stringify(isReadyForCleanup)}
				`,
				),
				new vscode.LanguageModelChatMessage(
					vscode.LanguageModelChatMessageRole.User,
					'Is this flag ready to cleanup based on the criteria?',
				),
			];
			try {
				const model = await this.getModel();
				const chatResponse = await model.sendRequest(messages, {}, token);
				// @ts-expect-error Cannot get Insider types
				for await (const fragment of chatResponse.text) {
					const md = new vscode.MarkdownString(fragment);
					md.supportThemeIcons = true;
					stream.markdown(md);
				}
				return { slashCommand: LDCONST_CMD_CLEANUP };
			} catch (e) {
				stream.markdown('There was an error processing your request. Please try again.');
				console.log(e);
			}
		} else {
			this.config.getApi().logEvent('VSCode Copilot Chat', { command: 'default' });
			stream.markdown(
				'Please use one of the three slash commands: `@LaunchDarkly /createFlag`,  `@LaunchDarkly /cleanup`,  or `@LaunchDarkly /explain`',
			);
			return { slashCommand: '' };
		}
	};
}
