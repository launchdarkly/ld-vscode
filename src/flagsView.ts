import * as vscode from 'vscode';
import { FeatureFlag } from './models';
import { LaunchDarklyAPI } from './api';
import { Configuration, getIsTreeviewEnabled } from './configuration';
import { FlagStore } from './flagStore';
import * as path from 'path';

export class ldFeatureFlagsProvider implements vscode.TreeDataProvider<FlagValue> {
  private readonly api: LaunchDarklyAPI;
  private config: Configuration;
  private flagStore: FlagStore;
  private flagValues: Array<FlagValue>;
  private ctx: vscode.ExtensionContext;
  private _onDidChangeTreeData: vscode.EventEmitter<FlagValue | undefined> = new vscode.EventEmitter<FlagValue | undefined>();
	readonly onDidChangeTreeData: vscode.Event<FlagValue | undefined> = this._onDidChangeTreeData.event;

  constructor(api: LaunchDarklyAPI, config: Configuration, flagStore: FlagStore, ctx: vscode.ExtensionContext) {
    this.api = api;
    this.config = config;
    this.ctx = ctx;
    this.flagStore = flagStore;
    this.start()
  }

	refresh(): void {
		this._onDidChangeTreeData.fire();
  }

  reload(): void {
    this.getFlags()
    this.refresh()
  }

  getTreeItem(element: FlagValue): vscode.TreeItem {
    return element;
  }

  getChildren(element?: FlagValue): Thenable<FlagValue[]> {
    if (!this.flagValues) {
      return Promise.resolve([new FlagValue(this.ctx, 'No Flags Found.',vscode.TreeItemCollapsibleState.None)]);
    }

    if (element) {
      return Promise.resolve(element.children)
    } else {
      return Promise.resolve(this.flagValues.map(function(flag) {
        return flag
      }));
    }
  }

  async getFlags() {
    const flags = await this.api.getFeatureFlags(this.config.project, this.config.env)
    let flagValues = []
    for (const flag of flags) {
      let item = this.flagToValues(flag)
      flagValues.push(item)
    }
    this.flagValues = flagValues
    this.refresh()
  }

  async start() {

    this.ctx.subscriptions.push(
      vscode.commands.registerCommand('ldFeatureFlags.copyKey', (node: FlagValue) => vscode.env.clipboard.writeText(node.label.split(":")[1].trim())),
      vscode.commands.registerCommand('ldFeatureFlags.openBrowser', (node: FlagValue) => vscode.env.openExternal(vscode.Uri.parse(node.uri))),
      vscode.commands.registerCommand('ldFeatureFlags.toggleFlag', (node: FlagValue) => this.toggleFlag(node)),
      vscode.commands.registerCommand('ldFeatureFlags.refreshEntry', () => this.refresh()),
      registerTreeviewRefreshCommand(this)

    )

    // Setup listener for flag changes
    var that = this;
    if (this.flagStore.ldClient === undefined) {
      setTimeout(function() {
      that.flagStore.ldClient.on('update', function (flags) {
        that.api.getFeatureFlagNew(that.config.project, flags.key, that.config.env).then((flag) => {
          for (let i = 0; i < that.flagValues.length; i++) {
            if (that.flagValues[i].label === flag.name) {
              that.flagValues[i] = that.flagToValues(flag)
              that.refresh()
              break
          }
        }
      })})
    }, 5000)}

    this.getFlags()
  }

  async toggleFlag(flag: FlagValue) {
    let curValue = JSON.parse(flag.label.split(":")[1].trim())
    try {
      var updatedFlag = await this.api.patchFeatureFlagOn(this.config.project, flag.flagKey, !curValue, this.config.env)
    } catch(e) {
      vscode.window.showInformationMessage("LaunchDarkly Toggle Flag Error: " + e);
    }
    for(let i = 0; i<this.flagValues.length; i++) {
      if (this.flagValues[i].label == flag.flagParentName) {
        this.flagValues[i] = this.flagToValues(updatedFlag)
        break
      }
    }
    this.refresh()
  }

  private flagToValues(flag: FeatureFlag): FlagValue {
    let flagUri = this.config.baseUri + flag.environments[this.config.env]._site.href
    var item = new FlagValue(this.ctx, flag.name, vscode.TreeItemCollapsibleState.Collapsed,
      [
        new FlagValue(this.ctx, `Open in Browser`, vscode.TreeItemCollapsibleState.None, [], "flagViewBrowser", flagUri),
        new FlagValue(this.ctx, `Key: ${flag.key}`, vscode.TreeItemCollapsibleState.None, [], "flagViewKey"),
        new FlagValue(this.ctx, `On: ${flag.environments[this.config.env].on}`, vscode.TreeItemCollapsibleState.None, [], "flagViewToggle", "", flag.key, flag.name),

      ],
      "flagParentItem"
    )
    if (flag.description) {
      item.children.push(new FlagValue(this.ctx, `Description: ${flag.description ? flag.description : ""}`, vscode.TreeItemCollapsibleState.None, [], "flagDescription"))
    }

    if (flag.tags) {
      let tags: Array<FlagValue> = []
      for(let i = 0; i<flag.tags.length; i++) {
        tags.push(new FlagValue(this.ctx, flag.tags[i], vscode.TreeItemCollapsibleState.None, tags, "flagTagItem"))
      }
      item.children.push(new FlagValue(this.ctx, `Tags:`, vscode.TreeItemCollapsibleState.Collapsed, tags, "flagTags"))
    }
    var prereqs: Array<FlagValue> = []
    let flagPrereqs = flag.environments[this.config.env].prerequisites
    if (typeof flagPrereqs !== "undefined" && flagPrereqs.length > 0) {
      for(let i = 0; i<flag.environments[this.config.env].prerequisites.length; i++) {
        prereqs.push(new FlagValue(this.ctx, `Flag: ${flag.environments[this.config.env].prerequisites[i].key}`, vscode.TreeItemCollapsibleState.None))
        prereqs.push(new FlagValue(this.ctx, `Variation: ${flag.environments[this.config.env].prerequisites[i].variation}`, vscode.TreeItemCollapsibleState.None))
      }
      item.children.push(new FlagValue(this.ctx, `Prerequisites: `, prereqs.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None, prereqs))
    }


    var targets: Array<FlagValue> = []
    var flagTargets = flag.environments[this.config.env].targets
    if (typeof flagTargets !== "undefined" && flagTargets.length > 0) {
    for(let i = 0; i<flagTargets.length; i++) {
        let curTarget = flagTargets[i]
          targets.push(new FlagValue(this.ctx, `Variation: ${flag.variations[curTarget.variation].name ? flag.variations[curTarget.variation].name : flag.variations[curTarget.variation].value}`, vscode.TreeItemCollapsibleState.None),
          new FlagValue(this.ctx, `Values: ${curTarget.values}`, vscode.TreeItemCollapsibleState.None),
        )
      }
    item.children.push(new FlagValue(this.ctx, `Targets:`, targets.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None, targets))
    }

    var variations: Array<FlagValue> = []
    for(let i = 0; i<flag.variations.length; i++) {
      variations.push(
        new FlagValue(this.ctx, `Name: ${flag.variations[i].name ? flag.variations[i].name : flag.variations[i].value}`, vscode.TreeItemCollapsibleState.None),
        new FlagValue(this.ctx, `Value: ${flag.variations[i].value}`, vscode.TreeItemCollapsibleState.None)
      )
      if (flag.variations[i].description) {
        variations.push(new FlagValue(this.ctx, `Description: ${flag.variations[i].description ? flag.variations[i].description : ""}`, vscode.TreeItemCollapsibleState.None, [], "flagDescription"))
      }
    }
    item.children.push(new FlagValue(this.ctx, `Variations:`, vscode.TreeItemCollapsibleState.Collapsed, variations))

    var rules: Array<FlagValue> = []
    let parseRules = flag.environments[this.config.env].rules
    if (typeof parseRules !== "undefined" && parseRules.length > 0) {
      for(let i = 0;i<parseRules.length;i++){
        let curRule = parseRules[i]
        var clauses: Array<FlagValue> = []
        if (curRule.clauses) {
          for (let j = 0; j<curRule.clauses.length;j++) {
            let clause = curRule.clauses[j]
            clauses.push(
              new FlagValue(this.ctx, `Attribute: ${clause.attribute}`, vscode.TreeItemCollapsibleState.None),
              new FlagValue(this.ctx, `Op: ${clause.op}`, vscode.TreeItemCollapsibleState.None, [], 'clauseOp'),
              new FlagValue(this.ctx, `Values: ${clause.values}`, vscode.TreeItemCollapsibleState.None),
              new FlagValue(this.ctx, `Negate: ${clause.negate}`, vscode.TreeItemCollapsibleState.None),
              )
          }
        }
        rules.push(new FlagValue(this.ctx, `Clauses:`, vscode.TreeItemCollapsibleState.Collapsed, clauses))
        if (typeof curRule.variation !== "undefined") {
          if (flag.variations[curRule.variation]) {
            rules.push(new FlagValue(this.ctx, `Variation: ${flag.variations[curRule.variation].name ? flag.variations[curRule.variation].name : flag.variations[curRule.variation].value}`, vscode.TreeItemCollapsibleState.None))
          } else {
            rules.push(new FlagValue(this.ctx, `Variation: ${curRule.variation}`, vscode.TreeItemCollapsibleState.None))
          }
        } else {
          let rollout: Array<FlagValue> = [new FlagValue(this.ctx, `BucketBy: ${curRule.rollout.bucketBy ? curRule.rollout.bucketBy : 'key'}`, vscode.TreeItemCollapsibleState.None)]
          rollout.push()
          for (let k = 0; k < curRule.rollout.variations.length; k++) {
            let weight = curRule.rollout.variations[k].weight / 1000
            rollout.push(
              new FlagValue(this.ctx, `Weight: ${weight}%`, vscode.TreeItemCollapsibleState.None, [], 'rolloutWeight'),
              new FlagValue(this.ctx, `Variation: ${flag.variations[curRule.rollout.variations[k].variation].name ? flag.variations[curRule.rollout.variations[k].variation].name : flag.variations[curRule.rollout.variations[k].variation].value}`, vscode.TreeItemCollapsibleState.None)
            )
          }

          rules.push(new FlagValue(this.ctx, `Rollout:`, vscode.TreeItemCollapsibleState.Collapsed, rollout))
        }
      }
      item.children.push(new FlagValue(this.ctx, `Rules:`, rules.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None, rules, "flagRules"))
    }

    let fallThrough = flag.environments[this.config.env].fallthrough
    if (fallThrough.variation !== undefined) {
      item.children.push(new FlagValue(this.ctx, `Default Variation: ${flag.variations[fallThrough.variation].name ? flag.variations[fallThrough.variation].name : flag.variations[fallThrough.variation].value }`, vscode.TreeItemCollapsibleState.None))
    } else if (fallThrough.rollout) {
      let fallThroughRollout: Array<FlagValue> = [new FlagValue(this.ctx, `BucketBy: ${fallThrough.rollout.bucketBy ? fallThrough.rollout.bucketBy : 'key'}`, vscode.TreeItemCollapsibleState.None)]
      for (let k = 0; k < fallThrough.rollout.variations.length; k++) {
        let weight = fallThrough.rollout.variations[k].weight / 1000
        fallThroughRollout.push(
          new FlagValue(this.ctx, `Weight: ${weight}%`, vscode.TreeItemCollapsibleState.None, [], 'rolloutWeight'),
          new FlagValue(this.ctx, `Variation: ${flag.variations[fallThrough.rollout.variations[k].variation].name ?  flag.variations[fallThrough.rollout.variations[k].variation].name : flag.variations[fallThrough.rollout.variations[k].variation].value }`, vscode.TreeItemCollapsibleState.None)
        )
      }
      item.children.push(new FlagValue(this.ctx, `Default Rollout:`, vscode.TreeItemCollapsibleState.Collapsed, fallThroughRollout))
    }

    if (flag.environments[this.config.env].offVariation !== undefined) {
      item.children.push(new FlagValue(this.ctx, `Off Variation: ${flag.variations[flag.environments[this.config.env].offVariation].name ? flag.variations[flag.environments[this.config.env].offVariation].name : flag.variations[flag.environments[this.config.env].offVariation].value}`, vscode.TreeItemCollapsibleState.None))
    }

    if (flag.defaults !== undefined) {
      item.children.push(new FlagValue(this.ctx, `Defaults:`, vscode.TreeItemCollapsibleState.Collapsed, [
        new FlagValue(this.ctx, `OnVariation: ${flag.variations[flag.defaults.onVariation].name ? flag.variations[flag.defaults.onVariation].name : flag.variations[flag.defaults.onVariation].value }`, vscode.TreeItemCollapsibleState.None),
        new FlagValue(this.ctx, `OffVariation: ${flag.variations[flag.defaults.offVariation].name ? flag.variations[flag.defaults.offVariation].name : flag.variations[flag.defaults.offVariation].value}`, vscode.TreeItemCollapsibleState.None),
        ])
      )
    }
    return item
  }
}


export class FlagValue extends vscode.TreeItem {
    children: FlagValue[]|undefined;
    contextValue?: string
    uri?: string
    flagKey?: string
    flagParentName?: string

    constructor(
      ctx: vscode.ExtensionContext,
      public readonly label: string,
      public readonly collapsibleState: vscode.TreeItemCollapsibleState,
      children?: FlagValue[],
      contextValue?: string,
      uri?: string,
      flagKey?: string,
      flagParentName?: string,
    ) {
      super(label, collapsibleState);
      this.contextValue = contextValue
      this.children = children
      this.uri = uri
      this.flagKey = flagKey
      this.flagParentName = flagParentName
      this.conditionalIcon(ctx, this.contextValue, this.label)
    }

    get tooltip(): string {
      return `${this.label}`
    };

    private conditionalIcon(ctx: vscode.ExtensionContext, contextValue: string, label: string) {
      if (contextValue == 'flagViewToggle' && label.split(":")[1].trim() == 'false') {
        this.setIcon(ctx, 'toggleoff_new.svg')
      } else if (this.contextValue == 'flagViewToggle') {
        this.setIcon(ctx, 'toggleon_new.svg')
      }
      switch (contextValue) {
        case 'flagViewBrowser':
          this.setIcon(ctx, 'link_external.svg')
          break
        case 'flagViewKey':
          this.setIcon(ctx, 'key.svg')
          break
        case 'flagDescription':
          this.setIcon(ctx, 'info.svg')
          break
        case 'flagRules':
          this.setIcon(ctx, 'list_tree.svg')
          break
        case 'clauseOp':
          this.setIcon(ctx, 'op.svg')
          break
        case 'flagTags':
          this.setIcon(ctx, 'tag.svg')
          break
        case 'flagParentItem':
          this.setIcon(ctx, 'rocket.svg')
          break
        case 'rolloutWeight':
          this.setIcon(ctx, 'weight.svg')
          break
      }
    }

    private setIcon(ctx: vscode.ExtensionContext, fileName: string): vscode.ThemeIcon {
      return this.iconPath = {
        light: ctx.asAbsolutePath(
          path.join('resources', 'light', fileName)
        ),
        dark: ctx.asAbsolutePath(
          path.join('resources', 'dark', fileName)
        ),
      }
    }
}

export function registerTreeviewRefreshCommand(
	treeDataProvider: ldFeatureFlagsProvider
  ): vscode.Disposable {
	return vscode.commands.registerCommand(
	  'launchdarkly.treeviewrefresh',
	  (): void => {
    treeDataProvider.reload();
		vscode.commands.executeCommand(
		  'setContext',
		  'launchdarkly:enableTreeview',
		  getIsTreeviewEnabled()
    );
	  }
	);
}
