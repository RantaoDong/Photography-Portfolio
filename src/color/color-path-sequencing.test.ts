import { describe, expect, it } from 'vitest';
import { labChroma, labHue, rgbToLab } from './color-conversion.ts';
import { createColorPathSequence } from './color-path-sequencing.ts';
import { sampleColorPath, type ColorPathPoint } from './color-path.ts';
import type { ColorToneCandidate } from './color-tone-matching.ts';

describe('color path sequencing', () => {
	it('creates a unique, ordered, endpoint-anchored adaptive sequence', () => {
		const points: ColorPathPoint[] = [
			{ x: 0, y: -0.95 },
			{ x: -0.8, y: 0.45 },
			{ x: 0.85, y: 0.35 },
		];
		const candidates = sampleColorPath(points, 24).map((sample, index) =>
			candidateForColor(`photo-${index}`, sample.rgb),
		);
		const sequence = createColorPathSequence(candidates, points);

		expect(sequence.length).toBeGreaterThanOrEqual(5);
		expect(sequence.length).toBeLessThanOrEqual(15);
		expect(new Set(sequence.map((entry) => entry.id)).size).toBe(sequence.length);
		expect(sequence.map((entry) => entry.pathPosition)).toEqual(
			[...sequence].map((entry) => entry.pathPosition).sort((a, b) => a - b),
		);
		expect(sequence[0].pathPosition).toBeLessThanOrEqual(0.08);
		expect(sequence.at(-1)!.pathPosition).toBeGreaterThanOrEqual(0.92);
	});

	it('requires the configured minimum number of control points', () => {
		const points: ColorPathPoint[] = [
			{ x: -1, y: 0 },
			{ x: 1, y: 0 },
		];
		expect(createColorPathSequence([candidateForColor('one', [255, 0, 0])], points)).toEqual([]);
	});
});

function candidateForColor(id: string, rgb: [number, number, number]): ColorToneCandidate {
	const lab = rgbToLab(rgb);
	const histogram = Array.from({ length: 24 }, () => 0);
	const neutral = labChroma(lab) < 8;
	if (!neutral) histogram[Math.min(23, Math.floor(labHue(lab) / 15))] = 1;
	return {
		id,
		features: {
			averageLab: lab,
			dominantColors: [{ lab, proportion: 1 }],
			hueHistogram: histogram,
			neutralProportion: neutral ? 1 : 0,
			toneStrength: 1,
			neutralStrength: 1,
		},
	};
}
