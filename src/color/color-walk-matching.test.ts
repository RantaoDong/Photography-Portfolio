import { describe, expect, it } from 'vitest';
import { rgbToLab } from './color-conversion.ts';
import { colorWalkConfig } from './color-walk-config.ts';
import { findColorWalkMatches } from './color-walk-matching.ts';
import type { RgbColor, SpatialColorCell } from './color-types.ts';

describe('Color Walk matching', () => {
	it('selects a photograph when the color appears in one local region', () => {
		const candidates = [
			candidate('red-detail', [cell(0, 0, [45, 45, 45], 0.8), cell(1, 0, [220, 35, 35], 0.2)]),
			candidate('neutral', [cell(0, 0, [45, 45, 45], 1)]),
		];

		expect(findColorWalkMatches(candidates, [255, 0, 0]).map((match) => match.id)).toEqual([
			'red-detail',
		]);
	});

	it('allows a multicolor photograph to participate in more than one walk', () => {
		const rainbow = candidate('rainbow', [
			cell(0, 0, [220, 35, 35], 0.4),
			cell(1, 0, [25, 80, 225], 0.4),
		]);

		expect(findColorWalkMatches([rainbow], [255, 0, 0])).toHaveLength(1);
		expect(findColorWalkMatches([rainbow], [0, 80, 255])).toHaveLength(1);
	});

	it('keeps matching thresholds and the safety cap configurable', () => {
		expect(colorWalkConfig.matching.minimumPhotoEvidence).toBeGreaterThan(0);
		expect(colorWalkConfig.matching.maximumMatchDistance).toBeGreaterThan(
			colorWalkConfig.matching.fullMatchDistance,
		);
		const red = [220, 35, 35] satisfies RgbColor;
		const candidates = Array.from(
			{ length: colorWalkConfig.matching.resultSafetyCap + 5 },
			(_, index) => candidate(`red-${index}`, [cell(0, 0, red, 1)]),
		);

		expect(findColorWalkMatches(candidates, [255, 0, 0])).toHaveLength(
			colorWalkConfig.matching.resultSafetyCap,
		);
	});
});

function candidate(id: string, spatialCells: SpatialColorCell[]) {
	return { id, features: { spatialCells } };
}

function cell(x: number, y: number, rgb: RgbColor, proportion: number): SpatialColorCell {
	return {
		x,
		y,
		colors: [{ rgb, lab: rgbToLab(rgb), proportion }],
	};
}
