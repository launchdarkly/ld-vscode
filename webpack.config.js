/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-var-requires */
//@ts-check

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { DefinePlugin } = require('webpack');
const { generateFonts } = require('@twbs/fantasticon');
const { validate } = require('schema-utils');

function getExtensionConfig(mode) {
	const plugins = [
		new DefinePlugin({ 'global.GENTLY': false }),
		new FantasticonPlugin({
			configPath: '.fantasticonrc.js',
			onBefore:
				mode !== 'production'
					? undefined
					: () =>
							spawnSync('yarn', ['run', 'icons:svgo'], {
								cwd: __dirname,
								encoding: 'utf8',
								shell: true,
							}),
			onComplete: () =>
				spawnSync('yarn', ['run', 'icons:apply'], {
					cwd: __dirname,
					encoding: 'utf8',
					shell: true,
				}),
		})
	]
	return {
		target: 'node', // vscode extensions run in a Node.js-context 📖 -> https://webpack.js.org/configuration/node/
		entry: './src/extension.ts', // the entry point of this extension, 📖 -> https://webpack.js.org/configuration/entry-context/
		output: {
			// the bundle is stored in the 'dist' folder (check package.json), 📖 -> https://webpack.js.org/configuration/output/
			path: path.resolve(__dirname, 'dist'),
			filename: 'extension.js',
			libraryTarget: 'commonjs2',
			devtoolModuleFilenameTemplate: '../[resource-path]',
		},
		plugins,
		devtool: 'source-map',
		externals: {
			vscode: 'commonjs vscode', // the vscode-module is created on-the-fly and must be excluded. Add other modules that cannot be webpack'ed, 📖 -> https://webpack.js.org/configuration/externals/
		},
		resolve: {
			// support reading TypeScript and JavaScript files, 📖 -> https://github.com/TypeStrong/ts-loader
			extensions: ['.ts', '.js'],
		},
		module: {
			rules: [
				{
					test: /\.ts$/,
					exclude: /node_modules/,
					use: [
						{
							loader: 'ts-loader',
						},
					],
				},
			],
		},
	};
}

const schema = {
	type: 'object',
	properties: {
		config: {
			type: 'object',
		},
		configPath: {
			type: 'string',
		},
		onBefore: {
			instanceof: 'Function',
		},
		onComplete: {
			instanceof: 'Function',
		},
	},
};

class FantasticonPlugin {
	alreadyRun = false;

	constructor(options = {}) {
		this.pluginName = 'fantasticon';
		this.options = options;

		validate(
			// eslint-disable-next-line @typescript-eslint/ban-ts-comment
			// @ts-ignore
			schema,
			options,
			{
				name: this.pluginName,
				baseDataPath: 'options',
			},
		);
	}

	/**
	 * @param {import("webpack").Compiler} compiler
	 */
	apply(compiler) {
		const {
			config = undefined,
			configPath = undefined,
			onBefore = undefined,
			onComplete = undefined,
		} = this.options;

		let loadedConfig;
		if (configPath) {
			try {
				loadedConfig = require(path.join(__dirname, configPath));
			} catch (ex) {
				console.error(`[${this.pluginName}] Error loading configuration: ${ex}`);
			}
		}

		if (!loadedConfig && !config) {
			console.error(`[${this.pluginName}] Error loading configuration: no configuration found`);
			return;
		}

		const fontConfig = { ...loadedConfig, ...config };

		// TODO@eamodio: Figure out how to add watching for the fontConfig.inputDir
		// Maybe something like: https://github.com/Fridus/webpack-watch-files-plugin

		/**
		 * @this {FantasticonPlugin}
		 * @param {import("webpack").Compiler} compiler
		 */
		async function generate(compiler) {
			if (compiler.watchMode) {
				if (this.alreadyRun) return;
				this.alreadyRun = true;
			}

			const logger = compiler.getInfrastructureLogger(this.pluginName);
			logger.log(`Generating '${compiler.name}' icon font...`);

			const start = Date.now();

			let onBeforeDuration = 0;
			if (onBefore != null) {
				const start = Date.now();
				await onBefore(fontConfig);
				onBeforeDuration = Date.now() - start;
			}

			await generateFonts(fontConfig);

			let onCompleteDuration = 0;
			if (onComplete != null) {
				const start = Date.now();
				await onComplete(fontConfig);
				onCompleteDuration = Date.now() - start;
			}

			let suffix = '';
			if (onBeforeDuration > 0 || onCompleteDuration > 0) {
				suffix = ` (${onBeforeDuration > 0 ? `onBefore: ${onBeforeDuration}ms` : ''}${
					onCompleteDuration > 0
						? `${onBeforeDuration > 0 ? ', ' : ''}onComplete: ${onCompleteDuration}ms`
						: ''
				})`;
			}

			logger.log(`Generated '${compiler.name}' icon font in \x1b[32m${Date.now() - start}ms\x1b[0m${suffix}`);
		}

		const generateFn = generate.bind(this);
		compiler.hooks.beforeRun.tapPromise(this.pluginName, generateFn);
		compiler.hooks.watchRun.tapPromise(this.pluginName, generateFn);
	}
}

module.exports = function (env, argv) {
	const mode = argv.mode || 'none';

	// env = {
	// 	analyzeBundle: false,
	// 	analyzeDeps: false,
	// 	esbuild: true,
	// 	...env,
	// };

	return [
		getExtensionConfig(mode),
	]
}