import { strict as assert } from 'assert';
import { createRequire } from 'module';
import { basename, resolve } from 'path';

suite('Glob tooling', () => {
	test('discovers files for the VS Code runner and coverage tooling', async () => {
		const testCli = createRequire(require.resolve('@vscode/test-cli'));
		const coverage = createRequire(testCli.resolve('c8/package.json'));
		const testExclude = createRequire(coverage.resolve('test-exclude'));
		const cwd = resolve(__dirname, '../../test');

		for (const parent of [testCli, testExclude]) {
			const { glob } = parent('glob');
			assert.deepEqual(await glob('globTooling.test.ts', { cwd }), ['globTooling.test.ts']);
		}
	});

	test('collects matching files through both Mocha runners', () => {
		const testCli = createRequire(require.resolve('@vscode/test-cli'));
		const cwd = resolve(__dirname, '../../test');

		for (const mochaEntry of [require.resolve('mocha'), testCli.resolve('mocha')]) {
			const mocha = createRequire(mochaEntry);
			const lookupFiles = mocha('./lib/cli/lookup-files');
			const files: string[] = lookupFiles(resolve(cwd, 'globTooling.*'), ['ts'], false);
			assert.deepEqual(
				files.map((file) => basename(file)),
				['globTooling.test.ts'],
			);
		}
	});
});
