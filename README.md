# LaunchDarkly VSCode Extension

The LaunchDarkly VSCode extension provides some quality-of-life enhancements for interacting with feature flags within VSCode.

## Features

- Flag details tooltip on hover
- Flag name autocomplete
- Open feature flags in LaunchDarkly (Default keybind: `ctrl+alt+g`/`⌘+alt+g`)

## Extension Settings

This extension contributes the following settings:

| Setting                           | Description                                                                     | Default value                     |
| --------------------------------- |:-------------------------------------------------------------------------------:| --------------------------------: |
| `launchdarkly.sdkKey`             | Your LaunchDarkly SDK key. Required.                                            | undefined                         |
| `launchdarkly.accessToken`        | Your LaunchDarkly API access token. Required.                                   | undefined                         |
| `launchdarkly.project`            | Your LaunchDarkly project key, should match the provided SDK key. Required.     | undefined                         |
| `launchdarkly.env`                | Your LaunchDarkly environment key, should match the provided SDK key.           | first environment                 |
| `launchdarkly.baseUri`            | The LaunchDarkly base uri to be used. Optional.                                 | `https://app.launchdarkly.com`    |
| `launchdarkly.streamUri`          | The LaunchDarkly stream uri to be used. Optional.                               | `https://stream.launchdarkly.com` |
| `launchdarkly.enableHover`        | Enables flag info to be displayed on hover of a valid flag key.                 | `https://app.launchdarkly.com`    |
| `launchdarkly.enableAutocomplete` | Enable flag key autocompletion.                                                 | `https://stream.launchdarkly.com` |

Changing settings requires a VSCode window reload.

**Note:** If you use quick suggestions to autocomplete words, LaunchDarkly autocomplete functionality requires the `editor.quickSuggestions.strings` setting to be enabled. Otherwise, you'll need to press `Ctrl+Space` (default binding) to see your flag key suggestions.

Here's an example setting configuration with quick suggestions enabled:

```javascript
{
  "launchdarkly.accessToken": "api-xxx",
  "launchdarkly.sdkKey": "sdk-xxx",
  "launchdarkly.project": "default",
  "launchdarkly.env": "production",
  "editor.quickSuggestions": {
    "other": true,
    "comments": false,
    "strings": true
  },
}
```
