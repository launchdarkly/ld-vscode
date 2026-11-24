import { strict as assert } from 'assert';
import { createRequire } from 'module';

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
});
