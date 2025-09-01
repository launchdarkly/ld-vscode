import Ajv from 'ajv';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { window } from 'vscode';

export class YamlReader {
	static read<T>(filePath: string, schema?: object, error = true): T {
		try {
			const fileContents = fs.readFileSync(filePath, 'utf8');
			const data = yaml.load(fileContents);
			if (schema) {
				const ajv = new Ajv();
				const validate = ajv.compile(schema);
				const valid = validate(data);
				if (!valid) {
					throw validate.errors;
				}
			}
			return data;
		} catch (e) {
			if (error) {
				window.showErrorMessage(`Error reading YAML file at ${filePath}: ${JSON.stringify(e)}`);
				console.error(`Error reading YAML file at ${filePath}:`, JSON.stringify(e));
			}
		}
	}
}
