import { describe, expect, it } from 'vitest';
import {
	colorWalkConfig,
	colorWalkRenderingDefaults,
	renderingParametersToTunerControls,
	tunerControlsToRenderingParameters,
	validateColorWalkRenderingParameters,
} from './color-walk-config.ts';
import {
	applyColorWalkEmphasis,
	brightnessRetentionForDistance,
	refineColorWalkMask,
	saturationRetentionForDistance,
} from './color-walk-rendering.ts';

describe('Color Walk saturation falloff', () => {
	it('keeps an unmodified plateau through the preserve radius', () => {
		expect(saturationRetentionForDistance(0)).toBe(1);
		expect(saturationRetentionForDistance(colorWalkConfig.rendering.preserveRadius)).toBe(1);
		expect(brightnessRetentionForDistance(colorWalkConfig.rendering.preserveRadius)).toBe(1);
		expect(applyColorWalkEmphasis([72, 138, 211], 8)).toEqual([72, 138, 211]);
	});

	it('falls quickly after the plateau and clamps distant colors above zero', () => {
		const { preserveRadius, fadeEnd, minimumSaturationRetention, minimumBrightnessRetention } =
			colorWalkConfig.rendering;
		const middleDistance = preserveRadius + (fadeEnd - preserveRadius) / 2;
		const middleSaturation = saturationRetentionForDistance(middleDistance);
		const middleBrightness = brightnessRetentionForDistance(middleDistance);
		const distantSaturation = saturationRetentionForDistance(Number.POSITIVE_INFINITY);
		const distantBrightness = brightnessRetentionForDistance(Number.POSITIVE_INFINITY);

		expect(middleSaturation).toBeLessThan((1 + minimumSaturationRetention) / 2);
		expect(middleSaturation).toBeGreaterThan(distantSaturation);
		expect(middleBrightness).toBeLessThan(1);
		expect(middleBrightness).toBeGreaterThan(distantBrightness);
		expect(distantSaturation).toBe(minimumSaturationRetention);
		expect(distantBrightness).toBe(minimumBrightnessRetention);
		expect(distantSaturation).toBeGreaterThan(0);
		expect(distantBrightness).toBeGreaterThan(0);
	});

	it('uses caller-supplied parameters without changing the shared defaults', () => {
		const custom = {
			...colorWalkRenderingDefaults,
			preserveRadius: 4,
			fadeEnd: 10,
			minimumSaturationRetention: 0.35,
			minimumBrightnessRetention: 0.9,
		};

		expect(applyColorWalkEmphasis([50, 120, 220], 4, custom)).toEqual([50, 120, 220]);
		expect(saturationRetentionForDistance(20, custom)).toBe(0.35);
		expect(brightnessRetentionForDistance(20, custom)).toBe(0.9);
		expect(colorWalkRenderingDefaults.preserveRadius).toBe(18);
	});

	it('round-trips the public defaults through the friendly tuner controls', () => {
		const controls = renderingParametersToTunerControls(colorWalkRenderingDefaults);
		const parameters = tunerControlsToRenderingParameters(
			controls,
			colorWalkRenderingDefaults.refinementMode,
		);

		expect(parameters.preserveRadius).toBeCloseTo(colorWalkRenderingDefaults.preserveRadius);
		expect(parameters.fadeEnd).toBeCloseTo(colorWalkRenderingDefaults.fadeEnd);
		expect(parameters.falloffSteepness).toBeCloseTo(colorWalkRenderingDefaults.falloffSteepness);
		expect(parameters.minimumSaturationRetention).toBeCloseTo(
			colorWalkRenderingDefaults.minimumSaturationRetention,
		);
		expect(parameters.minimumBrightnessRetention).toBeCloseTo(
			colorWalkRenderingDefaults.minimumBrightnessRetention,
		);
		expect(parameters.regionSmoothing).toBeCloseTo(colorWalkRenderingDefaults.regionSmoothing);
		expect(parameters.edgeSensitivity).toBeCloseTo(colorWalkRenderingDefaults.edgeSensitivity);
		expect(parameters.regionSupport).toBeCloseTo(colorWalkRenderingDefaults.regionSupport);
		expect(parameters.refinementMode).toBe('pixel');
	});

	it('rejects defaults outside the tuner-safe visual ranges', () => {
		expect(() =>
			validateColorWalkRenderingParameters({
				...colorWalkRenderingDefaults,
				minimumSaturationRetention: 0,
			}),
		).toThrow(/minimumSaturationRetention/);
		expect(() =>
			validateColorWalkRenderingParameters({
				...colorWalkRenderingDefaults,
				fadeEnd: colorWalkRenderingDefaults.preserveRadius + 100,
			}),
		).toThrow(/transition width/);
	});

	it('fills weak evidence inside a coherent region without crossing a visible edge', () => {
		const width = 11;
		const height = 3;
		const raw = new Float32Array(width * height);
		const guidance = new Float32Array(width * height * 3);
		for (let y = 0; y < height; y += 1) {
			for (let x = 0; x < 5; x += 1) raw[y * width + x] = 1;
		}
		raw[1 * width + 3] = 0;
		for (let y = 0; y < height; y += 1) {
			for (let x = 0; x < width; x += 1) {
				const offset = (y * width + x) * 3;
				const value = x < 5 ? 0.15 : 0.9;
				guidance[offset] = value;
				guidance[offset + 1] = value;
				guidance[offset + 2] = value;
			}
		}
		const refined = refineColorWalkMask(raw, guidance, width, height, {
			...colorWalkRenderingDefaults,
			refinementMode: 'edge-aware',
			regionSmoothing: 1,
			edgeSensitivity: 1,
			regionSupport: 0.2,
		});

		expect(refined[1 * width + 3]).toBeGreaterThan(0);
		expect(refined[1 * width + 7]).toBeLessThan(0.001);
		expect(refined[1 * width + 2]).toBe(1);
	});
});
