import { describe, expect, it } from 'vitest';
import {
	colorPathTransitionDefaults,
	validateColorPathTransitionParameters,
} from './color-path-transition-config.ts';

describe('color path transition configuration', () => {
	it('keeps the approved public defaults exactly', () => {
		expect(colorPathTransitionDefaults).toMatchObject({
			totalDurationMs: 740,
			maximumBlurRadius: 68,
			colorBiasStrength: 0.11,
			grainAmount: 0.225,
			grainScale: 2.5,
			abstractHold: 0.54,
			revealStart: 0.82,
		});
	});

	it('rejects a hold that leaves no time to lose current detail', () => {
		expect(() =>
			validateColorPathTransitionParameters({
				...colorPathTransitionDefaults,
				abstractHold: 0.8,
				revealStart: 0.82,
			}),
		).toThrow(/abstractHold/);
	});
});
