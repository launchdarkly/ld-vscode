# LaunchDarkly VSCode Extension

This extension aims to provide an accessibility layer for LaunchDarkly's REST API and streaming platform.

## Features
Display a flag configuration

![flag config](https://github.com/launchdarkly/ld-vscode/blob/master/images/get-feature-flag.gif?raw=true "Display a flag Configuration")

LaunchDarkly language support
  * Flag details tooltip on hover
  * Flag name completion

## Extension Settings

This extension contributes the following settings:
* `launchdarkly.sdkKey`: Your LaunchDarkly SDK key.
* `launchdarkly.accessToken`: Your LaunchDarkly API access token.
* `launchdarkly.project`: Your LaunchDarkly project key.
* `launchdarkly.env`: Your LaunchDarkly environment key.
* `launchdarkly.clearOutputBeforeEveryCommand`: If `true`, the output channel is cleared between commands.

## Development

### TypeScript

This project uses [TypeScript](https://www.typescriptlang.org). There is
excellent editor support for it, so hopefully jumping in should be a little
easier thanks to IntelliSense™.

We rely on [prettier](https://github.com/prettier/prettier) for formatting. See their docs on details for running `prettier` automatically from your editor. If you're using WebStorm, you'll need to format manually for now:

```
$ yarn pretty
```

If you use VSCode, then you can add this to your workspace settings to format on save:

```json
{
  "editor.formatOnSave": true,
  "prettier.singleQuote": true,
  "prettier.useTabs": true,
  "prettier.trailingComma": "all",
  "prettier.printWidth": 80
}
```
