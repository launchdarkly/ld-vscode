# Change Log

All notable changes to the "launchdarkly" extension will be documented in this file.

## [5.0.0] - 2024-02-06

### Fixed

- Numerous performance issues related to code lens
- Initial setup now recovers better if there's been a problem

## Changed
- Initial setup is now split into Sign in and Configuration.
- Updated CLI version of Code References

## Added
- Code lens and hover now show SDK availability of a flag
- Sign via through AuthProvider API
- `LaunchDarkly: Flag Actions` command
- Quick Targeting allows you to add/remove single context or rule from a flag.
- Flags in File now has inline commands on entry.
- Status bar icon that tells you current configured project and environment.

## [4.0.2] - 2023-02-15

### Fixed

- Fixed error switching instance urls
- Fixed alias support on hover
- Fixed handling of project and environment configuration

## Changed

- Added additional guards on validation of API calls

## [4.0.1] - 2023-02-09

### Fixed

- Fixed readiness check
- Fixed error with automatic migration of API tokens

## [4.0.0] - 2023-02-09

### Changed

- Moved Flag tree view to new LaunchDarkly Explorer view
- API Tokens are now stored using Secrets API

### Added

- Quick Links to various LaunchDarkly pages
- Create flags from VS Code
- Find flags in file view
- New command `LaunchDarkly: Toggle Flag` to toggle flags from command palette

### Fixed

- Various fixes for streaming connections

## [3.0.6] - 2021-09-14

### Changed

- Updates for Marketplace

## [3.0.5] - 2021-09-14

### Changed

- Update icon

## [2.4.0] - 2020-11-10

### Changed

- Show flag status(on/off) at top level of treeview
- Only update flags on refresh schedule for global metadata

## [2.3.0] - 2020-05-29

### Added

- Added "Feature Flag Explorer" to Explorer Container. Provides a list view of all feature flags and their targeting in current environment.

## [2.2.3] - 2020-03-24

### Added

- Added "Open in browser" link to hover display

## [2.2.2] - 2020-02-24

### Changed

- Improved formatting and readability of hover display
- Feature flag metadata used for hover is now cached

## [2.2.1] - 2020-02-21

### Added

- The hover display surfaces the feature flag's name

## [2.2.0] - 2020-01-06

### Added

- The extension now contributes a `LaunchDarkly: Configure` command to configure or reconfigure the extension. The extension will prompt users to configure on installation or update, or on obsolete configurations (see Changed section)

### Changed

- It is now possible to configure the extension without storing secrets in `settings.json`. Use the `LaunchDarkly: Configure` command to configure the extension. With this change, the `accessToken` configuration option is now deprecated, and will be automatically cleared when the `LaunchDarkly: Configure` is ran and completed.
- The `sdkKey` configuration option is now obsolete. The SDK key will now be inferred from the configured project and environment.

## [2.1.2] - 2019-12-26

### Fixed

- Fixed an error log when cursor position was in an invalid state

### Changed

- Cleaned up debug logging
- The extension will no longer initially display a warning message when not configured.

## [2.1.1] - 2019-06-24

### Changed

- The extension is now bundled with webpack to reduce artifact size (5.8mb -> 800kb)

## [2.1.0] - 2019-06-21

### Changed

- Updated dependencies to resolve security vulnerabilities with transitive dependencies.
- Fixed error message typo. Thanks @InTheCloudDan

## [2.0.4] - 2019-02-07

### Changed

- Locked indirect dependency `node.extend` to versions ^1.1.7.

## [2.0.3] - 2018-11-26

### Fixed

- The previous version of ld-vscode had shipped with a potentially vulnerable version of `event-stream`, a dependency used by the vscode api. This version downgrades `event-stream` to a previous version that did not contain this vulnerability. More information on this vulnerability can be found here: https://github.com/dominictarr/event-stream/issues/116.

## [2.0.2] - 2018-10-04

### ⚠ PSA: Version 2.0.2 contains a dependency vulnerability in `event-stream` and should not be used.

### Fixed

- Fixed a bug causing hovers on non-flag string literals to indefinitely display loading text

## [2.0.1] - 2018-09-28

### Fixed

- Configuration settings no longer require manually editing the json settings file
- The extension no longer requires a restart to apply configuration changes

## [2.0.0] - 2018-09-27

### Added

- The LaunchDarkly base and stream uris are now configurable
- Added configuration options to disable flag key autocomplete and hover
- A new "Open in LaunchDarkly" command which opens the feature flag key at the current editor position in the LaunchDarkly dashboard.

### Removed

- Removed the "Get feature flag" command

### Fixed

- Flag keys with non-letter characters are now correctly discovered by the extension
- Flag autocomplete suggestions will now only be generated when inside of a string literal
- Server connections generated by the extension will now correctly be identified as generated by the extension

## [1.0.0] - 2017-08-10

- Initial release
