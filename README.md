# LaunchDarkly for Visual Studio Code

The LaunchDarkly VSCode extension provides handy utilities that make it easier to use LaunchDarkly while you're coding. Now, you can see details about feature flags defined in your code, toggle them on or off, search for usage, see all possible flag variations and more.

<img src="https://github.com/launchdarkly/ld-vscode/raw/beta/images/screenshot.png?raw=true" alt="screenshot" width="100%">

## Features

- Feature flag details tooltip on hover
- Flag name autocomplete
- Open feature flags in LaunchDarkly (Default keybind: `ctrl+alt+g`/`⌘+alt+g`)
- Feature flag explorer: view a list of your feature flags and their settings in the explorer view

The feature flag explorer will automatically refresh whenever environment-specific configuration updates are made, like turning on your flag or adding a rule. For any changes that affect all environments, such as adding tags, the explorer can be manually refreshed.

Read our official documentation about this extension at <https://docs.launchdarkly.com/integrations/vscode>

## Contributing

LaunchDarkly for Visual Studio Code is an [open source project](https://github.com/launchdarkly/ld-vscode). If you experience any issues, please [log an issue on our issue tracker](https://github.com/launchdarkly/ld-vscode/issues). If you'd like to contribute, we're happily taking pull requests.
