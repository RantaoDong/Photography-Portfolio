import { describe, expect, it } from 'vitest';
import {
	getColorPathRenderScale,
	getColorPathTransitionFrame,
	getContainedImageBounds,
} from './color-path-transition.ts';

const current: [number, number, number] = [255, 0, 0];
const next: [number, number, number] = [0, 0, 255];

describe('color path transition timeline', () => {
	it('moves from clear current to blurred current', () => {
		const start = getColorPathTransitionFrame(0, current, next);
		const blurred = getColorPathTransitionFrame(0.28, current, next);
		expect(start.currentSharp).toBe(1);
		expect(start.biasStrength).toBe(0);
		expect(start.grainStrength).toBe(0);
		expect(blurred.currentBlurred).toBe(1);
		expect(blurred.biasColor).toEqual(current);
		expect(blurred.grainStrength).toBeGreaterThan(0);
	});

	it('holds a fully abstract target before the late reveal', () => {
		const held = getColorPathTransitionFrame(0.75, current, next);
		expect(held.currentSharp).toBe(0);
		expect(held.currentBlurred).toBe(0);
		expect(held.nextBlurred).toBe(1);
		expect(held.nextSharp).toBe(0);
	});

	it('interpolates both blurred structure and path color through the middle', () => {
		const middle = getColorPathTransitionFrame(0.48, current, next);
		expect(middle.currentBlurred).toBeGreaterThan(0);
		expect(middle.nextBlurred).toBeGreaterThan(0);
		expect(middle.currentBlurred + middle.nextBlurred).toBeCloseTo(1);
		expect(middle.biasColor[0]).toBeGreaterThan(0);
		expect(middle.biasColor[2]).toBeGreaterThan(0);
	});

	it('finishes on a clear next photograph without color bias', () => {
		const end = getColorPathTransitionFrame(1, current, next);
		expect(end.nextSharp).toBe(1);
		expect(end.nextBlurred).toBe(0);
		expect(end.biasStrength).toBe(0);
		expect(end.grainStrength).toBe(0);
	});

	it('computes centered contain bounds without changing the stage', () => {
		expect(getContainedImageBounds(600, 900, 1200, 800)).toEqual({
			x: 333.33333333333337,
			y: 0,
			width: 533.3333333333333,
			height: 800,
		});
		expect(getContainedImageBounds(1600, 900, 1200, 800)).toEqual({
			x: 0,
			y: 62.5,
			width: 1200,
			height: 675,
		});
	});

	it('bounds high-density mobile rendering without changing the timeline', () => {
		expect(getColorPathRenderScale(390, 520, 3)).toBe(1.5);
		expect(getColorPathRenderScale(1200, 800, 2)).toBe(0.8);
	});
});
