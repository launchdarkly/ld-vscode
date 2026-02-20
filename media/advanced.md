# Advanced Examples
`LaunchDarkly: Quick Targeting` command will look in your home directory for a `.launchdarkly` subdirectory.
[Flags in File](command:workbench.action.quickOpen,'Hello World')
### Code References Setup
[Check for .launchdarkly/coderefs.yaml]

Setup:
* [Integrating ld-find-code-refs with your toolchain](https://docs.launchdarkly.com/home/code/code-references#integrating-ld-find-code-refs-with-your-toolchain)
* [Setup Aliases](https://docs.launchdarkly.com/home/code/code-references#finding-flag-aliases)

Code References configuration powers the Extension Flag Lens and Flags in File.

### Add Targets/Rules

Example rules.yaml
```
targets:
  - name: Target Me in Context
    values: context-key-123abc
  - name: Target Me in Organization Context
    contextKind: organization
    values: my-org-1234
rules:
  - name: Test Organization
    clauses:
      - contextKind: user
        attribute: organization
        op: in
        negate: false
        values:
          - my-org-1234
  - contextKind: user
    attribute: beta
    op: in
    negate: true
    values: 1234
```

[Create files using example](command:launchdarkly.exampleRules)

### Evaluating a flag

Example context.yaml