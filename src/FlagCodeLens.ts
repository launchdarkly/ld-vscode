import * as vscode from 'vscode';
import { Configuration } from './configuration';
import { FeatureFlag, FlagConfiguration, IConfiguration } from './models';

export class FlagCodeLens extends vscode.CodeLens {
	public readonly flag: FeatureFlag;
	public readonly env: FlagConfiguration;
	public config: IConfiguration;
	constructor(
		range: vscode.Range,
		flag: FeatureFlag,
		env: FlagConfiguration,
		config: Configuration,
		command?: vscode.Command | undefined,
	) {
		super(range, command);
		this.flag = flag;
		this.env = env;
		this.config = config;
	}
}
