# LaunchDarkly VSCode Extension

The LaunchDarkly VSCode extension provides some quality-of-life enhancements for interacting with feature flags within VSCode.

## Features

- Flag details tooltip on hover
- Flag name autocomplete
- Open feature flags in LaunchDarkly (Default keybind: `ctrl+alt+g`/`⌘+alt+g`)
- Feature flag explorer: view a list of your feature flags and their settings in the explorer view.

The feature flag explorer will automatically refresh whenever environment-specific configuration updates are made, like turning on your flag or adding a rule. For any changes that affect all environments, such as adding tags, the explorer can be manually refreshed.

## Installation and configuration

On installation of the LaunchDarkly extension, VSCode will prompt you to configure the extension, selecting a LaunchDarkly project and environment for your workspace. To reconfigure the extension, run the "LaunchDarkly: Configure" command from your command pallete.
This extension contributes the following additional settings:

| Setting                           |                                            Description                                             |                     Default value |
| --------------------------------- | :------------------------------------------------------------------------------------------------: | --------------------------------: |
| `launchdarkly.project`            |       Your LaunchDarkly project key. Automatically configured by "LaunchDarkly: Configure".        |                       `undefined` |
| `launchdarkly.env`                |     Your LaunchDarkly environment key. Automatically configured by "LaunchDarkly: Configure".      |                       `undefined` |
| `launchdarkly.baseUri`            |                          The LaunchDarkly base uri to be used. Optional.                           |    `https://app.launchdarkly.com` |
| `launchdarkly.streamUri`          |                         The LaunchDarkly stream uri to be used. Optional.                          | `https://stream.launchdarkly.com` |
| `launchdarkly.enableHover`        |                  Enables flag info to be displayed on hover of a valid flag key.                   |                            `true` |
| `launchdarkly.enableAutocomplete` |                                  Enable flag key autocompletion.                                   |                            `true` |
| `launchdarkly.enableFlagExplorer`	|           Show all of the feature flags for the configured environment within the project.         |                            `true` |
| `launchdarkly.refreshRate`		|		How often in minutes to refresh feature flag metadata via API. If `0` global flag metadata does not update. Max is 1440 (1 Day). | `120` |
| `launchdarkly.sdkKey`             |      Your LaunchDarkly SDK key. OBSOLETE: Run the 'LaunchDarkly: Configure' command instead.       |                       `undefined` |
| `launchdarkly.accessToken`        | Your LaunchDarkly API access token. DEPRECATED: Run the 'LaunchDarkly: Configure' command instead. |                       `undefined` |

**Note:** If you use quick suggestions to autocomplete words, LaunchDarkly autocomplete functionality requires the `editor.quickSuggestions.strings` setting to be enabled. Otherwise, you'll need to press `Ctrl+Space` (default binding) to see your flag key suggestions.

Here's an example configuration with quick suggestions enabled:

```json
{
	"editor.quickSuggestions": {
		"other": true,
		"comments": false,
		"strings": true
	}
}
```
