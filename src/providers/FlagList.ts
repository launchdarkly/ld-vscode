import { Range, Command } from 'vscode';
import { Configuration } from '../configuration';
import { SimpleCodeLens } from './flagLens';

export class FlagList extends SimpleCodeLens {
	public list?: Array<Range>;
	public readonly name: string;
	public config: Configuration;
	constructor(range: Range, flag: string, name: string, list?: Array<Range>, command?: Command | undefined) {
		super(range, flag, command);
		this.list = list;
		this.name = name;
	}
}
