# Contributing to LaunchDarkly for Visual Studio Code

LaunchDarkly for Visual Studio Code is an [open source project](https://github.com/launchdarkly/ld-vscode). We welcome community contributions and encourage you to report issues, request features, and submit pull requests.

## Submitting bug reports and feature requests

The team monitors the [issue tracker](https://github.com/launchdarkly/ld-vscode/issues) in this repository. File bugs, feature requests, and questions there.

## Security issues

Please **do not** file GitHub issues for security vulnerabilities. Instead, report them through LaunchDarkly's [HackerOne program](https://hackerone.com/launchdarkly?type=team). See [SECURITY.md](SECURITY.md) for more details.

## Setting up a development environment

### Prerequisites

- [Node.js](https://nodejs.org/) v22+
- [Yarn](https://classic.yarnpkg.com/) v1
- [Visual Studio Code](https://code.visualstudio.com/) v1.82+

### Getting started

1. Fork and clone the repository.

2. Install dependencies:

```bash
yarn
```

3. Run the initial build setup:

```bash
yarn build:setup
```

4. Build the extension:

```bash
yarn compile
```

5. Press **F5** (or **Run > Start Debugging**) in VS Code to launch an Extension Development Host with the extension loaded.

### Useful scripts

| Script | Description |
| --- | --- |
| `yarn compile` | One-time development build |
| `yarn watch` | Rebuild automatically on file changes |
| `yarn test` | Run the test suite (requires `yarn pretest` first) |
| `yarn lint` | Check for lint errors |
| `yarn lint:fix` | Auto-fix lint errors |
| `yarn run prettier:check` | Verify code formatting |
| `yarn run prettier:write` | Auto-format code |

### Debugging

- Set breakpoints in TypeScript source files under `src/`.
- Use the Debug Console in the host VS Code window to inspect variables.
- Open **Help > Toggle Developer Tools** in the Extension Development Host for console output.

## Coding conventions

### Formatting

This project uses [Prettier](https://prettier.io/) with the following settings:

- Tabs for indentation
- Single quotes
- Trailing commas
- 120-character print width

Run `yarn run prettier:write` to auto-format before committing, or configure your editor to format on save.

### Linting

[ESLint](https://eslint.org/) enforces code quality rules for all TypeScript files. Run `yarn lint` to check and `yarn lint:fix` to auto-fix issues.

### Testing

Tests use [Mocha](https://mochajs.org/) (TDD UI) with [Chai](https://www.chaijs.com/) assertions and run inside a VS Code test host via [`@vscode/test-cli`](https://github.com/nicolo-ribaudo/vscode-test-cli). Test files live alongside source code in `test/` and follow the `*.test.ts` naming convention.

Run the full suite with:

```bash
yarn pretest && yarn test
```

On Linux CI environments, tests run under `xvfb-run` to provide a virtual display.

## Submitting a pull request

1. Create a feature branch from the latest `main`.
2. Make your changes in small, focused commits.
3. Ensure all checks pass locally:

```bash
yarn lint && yarn run prettier:check && yarn pretest && yarn test
```

4. Push your branch and open a pull request against `main`.
5. Fill out the PR description with a summary of your changes and any relevant context.

CI will automatically run the build, tests, Prettier, and lint checks on every pull request.

## License

By contributing to this project you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE.txt).
