import { describe, expect, it } from 'vitest';
import { analyzePixels, defaultColorAnalysisSettings } from './color-analysis.ts';
import { scorePhotoColorMatch } from './color-similarity.ts';
import type { RgbColor } from './color-types.ts';

describe('color analysis', () => {
	it('extracts global, distribution, and spatial color features', () => {
		const pixels: RgbColor[] = [];
		for (let index = 0; index < 64; index += 1) {
			pixels.push(index < 48 ? [230, 30, 30] : [20, 50, 220]);
		}
		const features = analyzePixels(pixels, 8, 8);

		expect(features.dominantColors[0].proportion).toBeCloseTo(0.75, 2);
		expect(features.hueHistogram).toHaveLength(24);
		expect(features.spatialCells).toHaveLength(16);
		expect(features.spatialCells.every((cell) => cell.colors.length <= 3)).toBe(true);
		expect(
			features.hueHistogram.reduce((sum, value) => sum + value, features.neutralProportion),
		).toBeCloseTo(1, 2);
	});

	it('keeps up to three local colors in a spatial cell', () => {
		const pixels: RgbColor[] = [];
		const colors: RgbColor[] = [
			[240, 20, 20],
			[20, 220, 40],
			[30, 50, 230],
		];
		for (let y = 0; y < 12; y += 1) {
			for (let x = 0; x < 12; x += 1) pixels.push(colors[(x + y) % colors.length]);
		}
		const features = analyzePixels(pixels, 12, 12, {
			...defaultColorAnalysisSettings,
			spatialGridSize: [1, 1],
		});
		expect(features.spatialCells[0].colors).toHaveLength(3);
		expect(features.spatialCells[0].colors.map((color) => color.proportion)).toEqual([
			0.3333, 0.3333, 0.3333,
		]);
	});

	it('ranks a photograph containing the selected color ahead of a distant palette', () => {
		const blue = analyzePixels(
			Array.from({ length: 16 }, () => [20, 60, 220]),
			4,
			4,
		);
		const orange = analyzePixels(
			Array.from({ length: 16 }, () => [230, 100, 20]),
			4,
			4,
		);
		expect(scorePhotoColorMatch([30, 70, 230], blue).score).toBeLessThan(
			scorePhotoColorMatch([30, 70, 230], orange).score,
		);
	});

	it('reduces overall-tone confidence for a balanced multicolor palette', () => {
		const blue = analyzePixels(
			Array.from({ length: 96 }, () => [20, 60, 220]),
			12,
			8,
		);
		const paradeColors: RgbColor[] = [
			[235, 30, 45],
			[245, 135, 20],
			[240, 220, 25],
			[25, 190, 60],
			[30, 75, 225],
			[155, 45, 205],
		];
		const multicolor = analyzePixels(
			Array.from({ length: 96 }, (_, index) => paradeColors[index % paradeColors.length]),
			12,
			8,
		);

		expect(blue.colorDiversity).toBeLessThan(0.1);
		expect(blue.toneStrength).toBeGreaterThan(0.9);
		expect(multicolor.colorDiversity).toBeGreaterThan(0.5);
		expect(multicolor.toneStrength).toBeLessThan(0.25);
		expect(scorePhotoColorMatch([30, 70, 230], blue).score).toBeLessThan(
			scorePhotoColorMatch([30, 70, 230], multicolor).score,
		);
	});

	it('uses neutral coverage when matching a gray selection', () => {
		const gray = analyzePixels(
			Array.from({ length: 16 }, () => [120, 120, 120]),
			4,
			4,
		);
		const red = analyzePixels(
			Array.from({ length: 16 }, () => [200, 30, 30]),
			4,
			4,
		);
		expect(gray.neutralStrength).toBeGreaterThan(0.9);
		expect(gray.toneStrength).toBe(0);
		expect(scorePhotoColorMatch([128, 128, 128], gray).score).toBeLessThan(
			scorePhotoColorMatch([128, 128, 128], red).score,
		);
	});

	it('does not assign a reliable hue to near-black color casts', () => {
		const nearBlackBlue = analyzePixels(
			Array.from({ length: 16 }, () => [0, 0, 18]),
			4,
			4,
		);

		expect(nearBlackBlue.neutralProportion).toBe(1);
		expect(nearBlackBlue.hueHistogram.reduce((sum, value) => sum + value, 0)).toBe(0);
		expect(nearBlackBlue.toneStrength).toBe(0);
	});

	it('rejects mismatched pixel dimensions', () => {
		expect(() => analyzePixels([[0, 0, 0]], 2, 2)).toThrow('Pixel data');
	});
});
