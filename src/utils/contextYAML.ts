import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { window } from 'vscode';
import { Clause } from '../models';

export type YAMLIndividualTarget = {
	name: string;
	contextKind: string;
	values: string | string[];
};

export type YAMLRuleTarget = {
	name: string;
	clauses: Clause[];
};

export class YamlContextReader {
	static read(filePath: string): YAMLIndividualTarget[] | YAMLRuleTarget[] {
		try {
			const fileContents = fs.readFileSync(filePath, 'utf8');
			const data = yaml.load(fileContents);
			//const ajv = new Ajv();
			//const validate = ajv.compile(schema);
			//const valid = validate(data);
			// if (!valid) {
			// 	throw validate.errors;
			// }
			return data;
		} catch (e) {
			window.showErrorMessage(`Error reading YAML file at ${filePath}: ${JSON.stringify(e)}`);
			console.error(`Error reading YAML file at ${filePath}:`, JSON.stringify(e));
		}
	}
}
