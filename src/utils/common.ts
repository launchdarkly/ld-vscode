import { commands } from 'vscode';
import { Disposable, Event, EventEmitter } from 'vscode';
import { startOfDay, subWeeks, subMonths, subYears, closestTo } from 'date-fns';
import { filters } from '../models';

export interface PromiseAdapter<T, U> {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(value: T, resolve: (value: U | PromiseLike<U>) => void, reject: (reason: any) => void): any;
}

export default async function checkExistingCommand(commandName: string): Promise<boolean> {
	const checkCommands = await commands.getCommands(false);
	if (checkCommands.includes(commandName)) {
		return true;
	}
	return false;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const passthrough = (value: any, resolve: (value?: any) => void) => resolve(value);

/**
 * Return a promise that resolves with the next emitted event, or with some future
 * event as decided by an adapter.
 *
 * If specified, the adapter is a function that will be called with
 * `(event, resolve, reject)`. It will be called once per event until it resolves or
 * rejects.
 *
 * The default adapter is the passthrough function `(value, resolve) => resolve(value)`.
 *
 * @param event the event
 * @param adapter controls resolution of the returned promise
 * @returns a promise that resolves or rejects as specified by the adapter
 */
export function promiseFromEvent<T, U>(
	event: Event<T>,
	adapter: PromiseAdapter<T, U> = passthrough,
): { promise: Promise<U>; cancel: EventEmitter<void> } {
	let subscription: Disposable;
	const cancel = new EventEmitter<void>();

	return {
		promise: new Promise<U>((resolve, reject) => {
			cancel.event(() => reject('Cancelled'));
			subscription = event((value: T) => {
				try {
					Promise.resolve(adapter(value, resolve, reject)).catch(reject);
				} catch (error) {
					reject(error);
				}
			});
		}).then(
			(result: U) => {
				subscription.dispose();
				return result;
			},
			(error) => {
				subscription.dispose();
				throw error;
			},
		),
		cancel,
	};
}

export function filtersObjToQueryString(obj: filters, prefix: string = ''): string {
	const params = new URLSearchParams();

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	function addParams(obj: any, prefix: string) {
		for (const key in obj) {
			// eslint-disable-next-line no-prototype-builtins
			if (obj.hasOwnProperty(key)) {
				const value = obj[key];
				const paramKey = prefix ? `${prefix}[${key}]` : key;
				switch (key) {
					case 'codeReferences': {
						const refCount = value['min'] ? value['min'] : value['max'];
						if (refCount > 0) {
							params.append(paramKey, 'true');
						} else {
							params.append(paramKey, 'false');
						}
						break;
					}
					case 'contextKindsEvaluated':
						if (value.length > 0) {
							value.map((context: string) => params.append('contextKindsEvaluated', context));
						}
						break;
					case 'creationDate': {
						const parsedDate = creationDateToReferenceDate(new Date(value['before']).getTime(), Date.now());
						params.append('created', parsedDate);
						break;
					}
					case 'tags':
						if (value.length > 0) {
							value.map((tag: string) => params.append('tag', tag));
						}
						break;
					default:
						params.append(paramKey, value);
						break;
				}
			}
		}
	}

	addParams(obj, prefix);
	return params.toString();
}

export function creationDateToReferenceDate(timestamp: number, referenceTimestamp: number) {
	const referenceDate = startOfDay(referenceTimestamp);
	const optionsToDate: Record<string, number> = {
		'1-week-ago': subWeeks(referenceDate, 1).getTime(),
		'1-month-ago': subMonths(referenceDate, 1).getTime(),
		'2-months-ago': subMonths(referenceDate, 2).getTime(),
		'3-months-ago': subMonths(referenceDate, 3).getTime(),
		'6-months-ago': subMonths(referenceDate, 6).getTime(),
		'1-year-ago': subYears(referenceDate, 1).getTime(),
	};

	const closestDateToEvalDate = closestTo(timestamp, Object.values(optionsToDate))?.getTime();
	return typedObjectKeys(optionsToDate).find((key) => optionsToDate[key] === closestDateToEvalDate);
}

function typedObjectKeys<Key extends string>(record: Record<Key, unknown>): Key[] {
	return Object.keys(record) as Key[];
}
