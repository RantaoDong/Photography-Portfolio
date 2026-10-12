import { labChroma, labDistance, labHue, rgbToLab } from './color-conversion.ts';
import type { ColorMatchResult, OverallColorMatchFeatures, RgbColor } from './color-types.ts';

export function scorePhotoColorMatch(
	queryRgb: RgbColor,
	features: OverallColorMatchFeatures,
): ColorMatchResult {
	const queryLab = rgbToLab(queryRgb);
	const paletteDistance = Math.min(
		...features.dominantColors.map(
			(color) => labDistance(queryLab, color.lab) + (1 - color.proportion) * 18,
		),
	);
	const averageDistance = labDistance(queryLab, features.averageLab);
	const neutralQuery = labChroma(queryLab) < 8;
	const selectedHueCoverage = neutralQuery
		? features.neutralProportion
		: selectedHueProportion(queryLab, features);
	const confidence = neutralQuery ? features.neutralStrength : features.toneStrength;
	const colorFit = neutralQuery
		? Math.exp(-averageDistance / 25)
		: 0.55 * Math.exp(-paletteDistance / 30) +
			0.35 * Math.exp(-averageDistance / 35) +
			0.1 * selectedHueCoverage;
	const similarity = colorFit * confidence;
	return {
		score: round(100 * (1 - similarity)),
		similarity: round(similarity),
		confidence: round(confidence),
		paletteDistance: round(paletteDistance),
		averageDistance: round(averageDistance),
		selectedHueCoverage: round(selectedHueCoverage),
	};
}

function selectedHueProportion(
	queryLab: ReturnType<typeof rgbToLab>,
	features: OverallColorMatchFeatures,
) {
	const bin = Math.min(
		features.hueHistogram.length - 1,
		Math.floor((labHue(queryLab) / 360) * features.hueHistogram.length),
	);
	return features.hueHistogram[bin] ?? 0;
}

export function hexToRgb(value: string): RgbColor {
	const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(value);
	if (!match) throw new Error(`Invalid RGB hex color: ${value}`);
	return [
		Number.parseInt(match[1], 16),
		Number.parseInt(match[2], 16),
		Number.parseInt(match[3], 16),
	];
}

function round(value: number) {
	return Math.round(value * 100) / 100;
}
