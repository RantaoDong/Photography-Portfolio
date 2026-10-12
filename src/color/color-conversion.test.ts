import { describe, expect, it } from 'vitest';
import { labToRgb, rgbToLab } from './color-conversion.ts';
import type { RgbColor } from './color-types.ts';

describe('color conversion', () => {
	it.each<[RgbColor]>([[[0, 0, 0]], [[255, 255, 255]], [[220, 40, 90]], [[30, 120, 230]]])(
		'round-trips RGB %j through Lab',
		(rgb) => {
			const result = labToRgb(rgbToLab(rgb));
			expect(result[0]).toBeCloseTo(rgb[0], 0);
			expect(result[1]).toBeCloseTo(rgb[1], 0);
			expect(result[2]).toBeCloseTo(rgb[2], 0);
		},
	);
});
