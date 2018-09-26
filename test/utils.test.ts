import * as assert from 'assert';
import * as utils from '../src/utils';

const flag = {
	key: 'test',
	on: true,
	variations: ['SomeVariation', { thisIsJson: 'AnotherVariation' }],
	fallthrough: {
		variation: 0,
	},
	offVariation: 1,
	prerequisites: ['something'],
	targets: [{ values: ['user', 'anotheruser'] }, { values: ['someotheruser'] }],
	rules: [],
};

suite('Utils tests', () => {
	test('generateHoverString', () => {
		assert.equal(
			`**LaunchDarkly feature flag**\n\n\tKey: test\n\tEnabled: true\n\tDefault variation: "SomeVariation"\n\tOff variation: {"thisIsJson":"AnotherVariation"}\n\t1 prerequisite\n\t3 user targets\n\t0 rules`,
			utils.generateHoverString(flag),
		);
	});
});
