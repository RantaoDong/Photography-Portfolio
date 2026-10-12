import { describe, expect, it } from 'vitest';
import { analyzePixels } from './color-analysis.ts';
import { colorToneConfig } from './color-tone-config.ts';
import { findColorToneMatches } from './color-tone-matching.ts';
import type { RgbColor } from './color-types.ts';

describe('public Color Tone matching', () => {
	it('keeps the public matching threshold in one configurable place', () => {
		expect(colorToneConfig.matchingThreshold).toBeGreaterThan(0);
		expect(colorToneConfig.matchingThreshold).toBeLessThan(1);
	});

	it('returns only threshold-qualified matches instead of filling a fixed result count', () => {
		const blue = features(Array.from({ length: 16 }, () => [30, 70, 220]));
		const mostlyNeutral = features(
			Array.from({ length: 16 }, (_, index) => (index < 4 ? [30, 70, 220] : [30, 30, 30])),
		);
		const orange = features(Array.from({ length: 16 }, () => [225, 110, 25]));
		const candidates = [
			{ id: 'blue', features: blue },
			{ id: 'small-blue-area', features: mostlyNeutral },
			{ id: 'orange', features: orange },
		];
		const matches = findColorToneMatches(candidates, [30, 70, 220]);

		expect(matches.map((match) => match.id)).toEqual(['blue']);
		expect(matches.some((match) => match.id === 'orange')).toBe(false);
	});

	it('rejects a matching-looking hue that exists only in near-black pixels', () => {
		const blue = features(Array.from({ length: 16 }, () => [30, 70, 220]));
		const nearBlackBlue = features(Array.from({ length: 16 }, () => [0, 0, 18]));
		const matches = findColorToneMatches(
			[
				{ id: 'blue', features: blue },
				{ id: 'near-black-blue', features: nearBlackBlue },
			],
			[30, 70, 220],
		);

		expect(matches.map((match) => match.id)).toEqual(['blue']);
	});

	it('applies the safety cap only after threshold filtering and sorting', () => {
		const blue = features(Array.from({ length: 16 }, () => [30, 70, 220]));
		const candidates = Array.from({ length: 35 }, (_, index) => ({
			id: `blue-${index}`,
			features: blue,
		}));
		expect(findColorToneMatches(candidates, [30, 70, 220])).toHaveLength(
			colorToneConfig.resultSafetyCap,
		);
	});
});

function features(pixels: RgbColor[]) {
	return analyzePixels(pixels, 4, 4);
}
