import { describe, expect, it } from 'vitest';
import { replaceRenderingDefaults } from './color-walk-tuner-server.ts';

describe('Color Walk tuner default persistence', () => {
	it('replaces only the shared defaults block with formatted values', () => {
		const source = [
			'const before = true;',
			'export const colorWalkRenderingDefaults: ColorWalkRenderingParameters = {',
			"\trefinementMode: 'pixel',",
			'\tpreserveRadius: 18,',
			'\tfadeEnd: 44,',
			'\tfalloffSteepness: 2.4,',
			'\tminimumSaturationRetention: 0.2,',
			'\tminimumBrightnessRetention: 0.84,',
			'\tregionSmoothing: 0.7,',
			'\tedgeSensitivity: 0.72,',
			'\tregionSupport: 0.45,',
			'};',
			'const after = true;',
		].join('\n');

		const updated = replaceRenderingDefaults(source, {
			refinementMode: 'edge-aware',
			preserveRadius: 15.88,
			fadeEnd: 39.88,
			falloffSteepness: 3.98,
			minimumSaturationRetention: 0.19,
			minimumBrightnessRetention: 0.817_64,
			regionSmoothing: 0.77,
			edgeSensitivity: 0.81,
			regionSupport: 0.38,
		});

		expect(updated).toContain('\tpreserveRadius: 15.88,');
		expect(updated).toContain('\tminimumBrightnessRetention: 0.8176,');
		expect(updated).toContain("\trefinementMode: 'edge-aware',");
		expect(updated).toContain('const before = true;');
		expect(updated).toContain('const after = true;');
	});

	it('fails instead of writing an unexpected source structure', () => {
		expect(() =>
			replaceRenderingDefaults('export const unrelated = {};', {
				refinementMode: 'pixel',
				preserveRadius: 18,
				fadeEnd: 44,
				falloffSteepness: 2.4,
				minimumSaturationRetention: 0.2,
				minimumBrightnessRetention: 0.84,
				regionSmoothing: 0.7,
				edgeSensitivity: 0.72,
				regionSupport: 0.45,
			}),
		).toThrow(/Could not locate/);
	});
});
