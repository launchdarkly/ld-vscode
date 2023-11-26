import * as fs from 'fs';
import * as yaml from 'js-yaml';

export class YamlReader {
	static read(filePath: string): any {
		try {
			const fileContents = fs.readFileSync(filePath, 'utf8');
			const data = yaml.load(fileContents);
			return data;
		} catch (e) {
			console.error(`Error reading YAML file at ${filePath}:`, e);
			throw e;
		}
	}
}
