// import { ChatVariableResolver, ChatVariableContext, CancellationToken, ChatVariableValue } from 'vscode';
// import flagVariableCmd from '../commands/flagVariable';
// import { ILDExtensionConfiguration } from '../models';

// export class CopilotChatVariableResolver implements ChatVariableResolver {
//     private config: ILDExtensionConfiguration;

//     constructor(config: ILDExtensionConfiguration) {
//         this.config = config;
//     }

//     async resolve(name: string, context: ChatVariableContext, token: CancellationToken): Promise<ChatVariableValue[]> {
//         // Use this.config to access the LDExtensionConfiguration
//         // Implement your logic here
// 				console.log('Resolving chat variable', name);
// 				console.log('Context:', context);
// 				console.log('Token:', token);
// 				const flagData = await flagVariableCmd(this.config);
// 				return flagData
//     }
// }
