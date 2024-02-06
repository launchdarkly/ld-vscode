// .vscode-test.js
const { defineConfig } = require('@vscode/test-cli');

module.exports = defineConfig([
  {
    label: 'unitTests',
    files: ['out/test/*.test.js', 'out/test/**/*.test.js'],
    version: 'insiders',
    workspaceFolder: './sampleWorkspace',
    mocha: {
      ui: 'tdd',
      timeout: 20000
    }
  }]
  );