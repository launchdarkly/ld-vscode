import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { window } from 'vscode';
import Ajv from 'ajv';
import { Clause } from '../models';

export type YAMLIndividualTarget = {
	name: string;
	contextKind: string;
	values: string | string[];
	type: string;
};

export type YAMLRuleTarget = {
	name: string;
	clauses: Clause[];
	type: string;
};

export class YamlReader {
	static read(filePath: string): YAMLIndividualTarget[] | YAMLRuleTarget[] {
		try {
			const fileContents = fs.readFileSync(filePath, 'utf8');
			const data = yaml.load(fileContents);
			const ajv = new Ajv();
			const validate = ajv.compile(schema);
			const valid = validate(data);
			if (!valid) {
				throw validate.errors;
			}
			return data;
		} catch (e) {
			window.showErrorMessage(`Error reading YAML file at ${filePath}: ${JSON.stringify(e)}`);
			console.error(`Error reading YAML file at ${filePath}:`, JSON.stringify(e));
		}
	}
}

const schema = {
	anyOf: [
		{
			type: 'object',
			properties: {
				targets: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							name: {
								type: 'string',
							},
							values: {
								anyOf: [
									{
										type: 'string',
									},
									{
										type: 'array',
										items: {
											type: 'string',
										},
									},
								],
							},
							contextKind: {
								type: 'string',
							},
						},
						required: ['name', 'values'],
					},
				},
			},
			required: ['targets'],
		},
		{
			type: 'object',
			properties: {
				rules: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							name: {
								type: 'string',
							},
							clauses: {
								type: 'array',
								items: {
									type: 'object',
									properties: {
										attribute: {
											type: 'string',
										},
										op: {
											type: 'string',
										},
										values: {
											type: 'array',
										},
										negate: {
											type: 'boolean',
										},
										contextKind: {
											type: 'string',
										},
										_key: {
											type: 'string',
										},
									},
								},
							},
						},
					},
				},
			},
			required: ['rules'],
		},
	],
};
