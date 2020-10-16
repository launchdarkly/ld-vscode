
import * as vscode from 'vscode';
import { LaunchDarklyAPI } from '../api';
import { Configuration } from '../configuration';
import { FeatureFlag, FlagConfiguration } from '../models';
import { FlagStore } from '../flagStore';

/**
 * CodelensProvider
 */
export class FlagCodeLensProvider implements vscode.CodeLensProvider {
    private readonly api: LaunchDarklyAPI;
    private config: Configuration;
    private codeLenses: vscode.CodeLens[] = [];
    private regex: RegExp;
    private flagStore: FlagStore
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    constructor(api: LaunchDarklyAPI, config: Configuration, flagStore: FlagStore) {
        this.api = api;
        this.config = config;
        this.flagStore = flagStore;
        this.regex = /(.+)/g;
        vscode.workspace.onDidChangeConfiguration((_) => {
            this._onDidChangeCodeLenses.fire(null);
        });
        this.start()
    }

    refresh(): void {
        this._onDidChangeCodeLenses.fire(null);
    }

    public async start(): Promise<void> {
        await this.flagUpdateListener()
    }

    private async flagUpdateListener() {
        // Setup listener for flag changes
        console.log("setting up lens listener")
        this.flagStore.on('update', async flag => {
            try {
                const updatedFlag = await this.flagStore.getFeatureFlag(flag);
                this.refresh()
            } catch (err) {
                console.error('Failed to update LaunchDarkly flag lens:', err);
            }
        });
    }

    public async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {

        if (vscode.workspace.getConfiguration("launchdarkly").get("enableCodeLens", true)) {
        this.codeLenses = [];
        const regex = new RegExp(this.regex);
        const text = document.getText();
        let matches;
        const flags = await this.flagStore.allFlagsMetadata()
        const env = await this.flagStore.allFlags()
        const keys = Object.keys( flags )
        while ((matches = regex.exec(text)) !== null) {
            const line = document.lineAt(document.positionAt(matches.index).line);
            const indexOf = line.text.indexOf(matches[0]);
            const position = new vscode.Position(line.lineNumber, indexOf);
            const range = document.getWordRangeAtPosition(position, new RegExp(this.regex));
            const prospect = document.getText(range)
            const flag = keys.find(element => {
                if (prospect.includes(element)) {
                    return element
                }
            });

            if (range && flag !== undefined && flags[flag]) {
                    const codeLens = new FlagCodeLens(range, flags[flag], env[flag], this.config)
                    this.codeLenses.push(codeLens)
                }

        }

        return this.codeLenses;
        }
    }

    public resolveCodeLens(codeLens: FlagCodeLens, token: vscode.CancellationToken): FlagCodeLens {
        try {
        let preReq = ""
            if (codeLens.env.prerequisites && codeLens.env.prerequisites.length > 0) {
                preReq = codeLens.env.prerequisites.length > 0 ? `\u2022 Prerequisites configured` : ``
            } else {
                preReq = ""
            }
            codeLens.command = {
                title: `LaunchDarkly Feature Flag \u2022 Targeting: ${codeLens.flag.environments[this.config.env].on ? 'on' : 'off'} ${preReq}`,
                tooltip: "Feature Flag Variations",
                command: "",
                arguments: ["Argument 1", true]
            };
            return codeLens;
        } catch(err) {
            console.log(err)
        }
    }

}


export class FlagCodeLens extends vscode.CodeLens {
    public readonly flag: FeatureFlag
    public readonly env: FlagConfiguration
    public config: Configuration
    constructor(
        range: vscode.Range,
        flag: FeatureFlag,
        env: FlagConfiguration,
        config: Configuration,
        command?: vscode.Command | undefined
    ) {
        super(range, command);
        this.flag = flag
        this.env = env
        this.config = config
    }
}
