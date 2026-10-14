import { describe, expect, it } from 'vitest';
import { labChroma, rgbToLab } from './color-conversion.ts';
import { createSoftColorPathGradient, softenColorPathUiColor } from './color-path-ui.ts';

describe('Color Path UI colors', () => {
	it('softens chroma and gently lifts dark path colors without changing matching colors', () => {
		const original = [20, 30, 220] as [number, number, number];
		const softened = softenColorPathUiColor(original);
		const originalLab = rgbToLab(original);
		const softenedLab = rgbToLab(softened);

		expect(labChroma(softenedLab)).toBeLessThan(labChroma(originalLab));
		expect(softenedLab[0]).toBeGreaterThan(originalLab[0]);
		expect(original).toEqual([20, 30, 220]);
	});

	it('builds a continuous gradient from samples of the supplied path', () => {
		const gradient = createSoftColorPathGradient([
			{ x: -1, y: 0 },
			{ x: 0, y: 1 },
			{ x: 1, y: 0 },
		]);

		expect(gradient).toMatch(/^linear-gradient\(90deg, /);
		expect(gradient.match(/rgb\(/g)).toHaveLength(33);
		expect(gradient).toContain(' 0%');
		expect(gradient).toContain(' 100%');
	});
});
