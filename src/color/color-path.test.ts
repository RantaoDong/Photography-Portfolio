import { describe, expect, it } from 'vitest';
import {
	colorPathPointToRgb,
	getColorPathLength,
	interpolateColorPath,
	sampleColorPath,
	type ColorPathPoint,
} from './color-path.ts';

describe('color path geometry', () => {
	it('uses radius as saturation and keeps the disk center neutral', () => {
		expect(colorPathPointToRgb({ x: 0, y: 0 })).toEqual([128, 128, 128]);
		const edge = colorPathPointToRgb({ x: 0, y: -1 });
		expect(edge[0]).toBeGreaterThan(240);
		expect(edge[1]).toBeLessThan(15);
		expect(edge[2]).toBeLessThan(15);
	});

	it('interpolates by cumulative segment length through the disk interior', () => {
		const points: ColorPathPoint[] = [
			{ x: -1, y: 0 },
			{ x: 1, y: 0 },
			{ x: 1, y: 1 },
		];
		expect(getColorPathLength(points)).toBeCloseTo(3);
		expect(interpolateColorPath(points, 1 / 3)).toEqual({ x: 0, y: 0 });
		expect(interpolateColorPath(points, 1)).toEqual({ x: 1, y: 1 });
	});

	it('samples endpoints and intermediate positions across the full path', () => {
		const samples = sampleColorPath(
			[
				{ x: -1, y: 0 },
				{ x: 1, y: 0 },
				{ x: 0, y: -1 },
			],
			9,
		);
		expect(samples).toHaveLength(9);
		expect(samples[0].position).toBe(0);
		expect(samples.at(-1)?.position).toBe(1);
		expect(samples.some((sample) => Math.hypot(sample.point.x, sample.point.y) < 0.2)).toBe(true);
	});
});
