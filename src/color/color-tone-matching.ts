import { labHue, rgbToLab } from './color-conversion.ts';
import { colorToneConfig } from './color-tone-config.ts';
import type { OverallColorMatchFeatures, RgbColor } from './color-types.ts';

export interface ColorToneCandidate {
	id: string;
	features: OverallColorMatchFeatures;
}

export interface ColorToneMatch {
	id: string;
	similarity: number;
}

export function findColorToneMatches(
	candidates: ColorToneCandidate[],
	color: RgbColor,
): ColorToneMatch[] {
	const queryHue = labHue(rgbToLab(color));
	return candidates
		.map((candidate) => ({
			id: candidate.id,
			similarity: scorePhotoHueMatch(queryHue, candidate.features),
		}))
		.filter((match) => match.similarity >= colorToneConfig.matchingThreshold)
		.sort((a, b) => b.similarity - a.similarity)
		.slice(0, colorToneConfig.resultSafetyCap);
}

export function scorePhotoHueMatch(hue: number, features: OverallColorMatchFeatures) {
	const histogram = features.hueHistogram;
	if (histogram.length === 0) return 0;
	const binWidth = 360 / histogram.length;
	const windowDegrees = binWidth * 3;
	const hueCoverage = histogram.reduce((sum, proportion, index) => {
		const binCenter = (index + 0.5) * binWidth;
		const distance = circularHueDistance(hue, binCenter);
		const weight = Math.max(0, 1 - distance / windowDegrees);
		return sum + proportion * weight;
	}, 0);
	const chromaticProportion = histogram.reduce((sum, proportion) => sum + proportion, 0);
	const hueShare = chromaticProportion > 0 ? hueCoverage / chromaticProportion : 0;
	const confidence = 0.25 + 0.75 * features.toneStrength;
	return round((0.7 * hueCoverage + 0.3 * hueShare) * confidence);
}

function circularHueDistance(first: number, second: number) {
	const difference = Math.abs(first - second) % 360;
	return Math.min(difference, 360 - difference);
}

function round(value: number) {
	return Math.round(value * 10_000) / 10_000;
}
