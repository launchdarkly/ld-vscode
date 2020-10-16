
import * as vscode from 'vscode';
import { LaunchDarklyAPI } from '../api';
import { Configuration } from '../configuration';
import { FeatureFlag } from '../models';
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

    public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {

        //if (vscode.workspace.getConfiguration("codelens-sample").get("enableCodeLens", true)) {
        this.codeLenses = [];
        const regex = new RegExp(this.regex);
        const text = document.getText();
        let matches;
        this.flagStore.allFlagsMetadata().then(flags => {
            while ((matches = regex.exec(text)) !== null) {
                const keys = Object.keys( flags )
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
                        const codeLens = new FlagCodeLens(range, flags[flag], this.config)
                        let preReq
                        if (codeLens.flag.environments[this.config.env].prerequisites && codeLens.flag.environments[this.config.env].prerequisites.length > 0) {
                            preReq = codeLens.flag.environments[this.config.env].prerequisites.length > 0 ? `\u2022 Prerequisites configured` : ``
                        }
                        codeLens.command = {
                            title: `LaunchDarkly Feature Flag \u2022 Targeting: ${codeLens.flag.environments[this.config.env].on ? 'on' : 'off'} ${preReq}`,
                            tooltip: "Feature Flag Variations",
                            command: "",
                            //command: "codelens-sample.codelensAction",
                            arguments: ["Argument 1", true]
                        };
                        console.log(codeLens.isResolved)
                        this.codeLenses.push(codeLens)
                    }

            }
        console.log(this.codeLenses[0])
        console.log(this.codeLenses.length)
        return this.codeLenses;
        })

        return [];
    }

    public resolveCodeLens(codeLens: FlagCodeLens, token: vscode.CancellationToken) {
        try {
        let preReq = ``

            if (codeLens.flag.environments[this.config.env].prerequisites && codeLens.flag.environments[this.config.env].prerequisites.length > 0) {
                preReq = codeLens.flag.environments[this.config.env].prerequisites.length > 0 ? `\u2022 Prerequisites configured` : ``
            }
            codeLens.command = {
                title: `LaunchDarkly Feature Flag \u2022 Targeting: ${codeLens.flag.environments[this.config.env].on ? 'on' : 'off'} ${preReq}`,
                tooltip: "Feature Flag Variations",
                command: "",
                //command: "codelens-sample.codelensAction",
                arguments: ["Argument 1", true]
            };
            console.log(codeLens.isResolved)
            return codeLens;
        } catch(err) {
            console.log(err)
        }
    }

}


export class FlagCodeLens extends vscode.CodeLens {
    public flag: FeatureFlag
    public config: Configuration
    constructor(
        range: vscode.Range,
        flag: FeatureFlag,
        config: Configuration,
        command?: vscode.Command | undefined
    ) {
        super(range, command);
        this.flag = flag
        this.config = config
    }
}
