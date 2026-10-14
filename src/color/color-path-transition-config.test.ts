import { describe, expect, it } from 'vitest';
import {
	colorPathTransitionDefaults,
	validateColorPathTransitionParameters,
} from './color-path-transition-config.ts';

describe('color path transition configuration', () => {
	it('keeps the approved public defaults exactly', () => {
		expect(colorPathTransitionDefaults).toMatchObject({
			totalDurationMs: 860,
			maximumBlurRadius: 68,
			colorBiasStrength: 0.11,
			grainAmount: 0.225,
			grainScale: 2.5,
		});
	});

	it('rejects invalid saved timing order', () => {
		expect(() =>
			validateColorPathTransitionParameters({
				...colorPathTransitionDefaults,
				middleInterpolationStart: 0.8,
				middleInterpolationEnd: 0.7,
			}),
		).toThrow(/middleInterpolationStart/);
	});
});
