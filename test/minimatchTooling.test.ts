import { strict as assert } from 'assert';
import { createRequire } from 'module';
import { resolve } from 'path';

suite('Minimatch tooling', () => {
	test('keeps file matching available to the test runner, coverage and linter', () => {
		const testCli = createRequire(require.resolve('@vscode/test-cli'));
		const coverage = createRequire(testCli.resolve('c8/package.json'));
		const testExclude = createRequire(coverage.resolve('test-exclude'));
		const mocha = createRequire(testCli.resolve('mocha'));
		const estree = createRequire(require.resolve('@typescript-eslint/typescript-estree'));

		for (const parent of [testCli, testExclude, mocha, estree]) {
			const { minimatch } = parent('minimatch');
			assert.equal(minimatch('test/providers.test.ts', 'test/*.test.ts'), true);
			assert.equal(minimatch('src/extension.ts', 'test/*.test.ts'), false);
		}
	});

	test('honors ignore patterns in the standalone Mocha runner', () => {
		const mocha = createRequire(require.resolve('mocha'));
		const collectFiles = mocha('./lib/cli/collect-files');
		const included = resolve(__dirname, 'minimatchTooling.test.js');
		const excluded = resolve(__dirname, 'providers.test.js');

		assert.deepEqual(
			collectFiles({ spec: [included, excluded], extension: ['js'], file: [], ignore: ['**/providers.test.js'] }).files,
			[included],
		);
	});
});
