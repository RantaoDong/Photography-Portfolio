import { labChroma, rgbToLab } from './color-conversion.ts';
import { colorWalkConfig } from './color-walk-config.ts';
import type { LabColor, RgbColor, SpatialColorCell } from './color-types.ts';

export interface ColorWalkCandidate {
	id: string;
	features: {
		spatialCells: SpatialColorCell[];
	};
}

export interface ColorWalkMatch {
	id: string;
	score: number;
}

export function findColorWalkMatches(
	candidates: ColorWalkCandidate[],
	selectedColor: RgbColor,
): ColorWalkMatch[] {
	const queryLab = rgbToLab(selectedColor);
	return candidates
		.map((candidate) => scoreCandidate(candidate, queryLab))
		.filter((match): match is ColorWalkMatch => match !== null)
		.sort((first, second) => second.score - first.score)
		.slice(0, colorWalkConfig.matching.resultSafetyCap);
}

export function colorWalkPerceptualDistance(query: LabColor, sample: LabColor) {
	const queryChroma = labChroma(query);
	const sampleChroma = labChroma(sample);
	const queryHue = Math.atan2(query[2], query[1]);
	const sampleHue = Math.atan2(sample[2], sample[1]);
	const hueDelta = Math.atan2(Math.sin(queryHue - sampleHue), Math.cos(queryHue - sampleHue));
	const hueDistance = 2 * Math.sqrt(queryChroma * sampleChroma) * Math.sin(Math.abs(hueDelta) / 2);
	const lightnessDistance = (query[0] - sample[0]) * colorWalkConfig.matching.lightnessWeight;
	const chromaDistance = (queryChroma - sampleChroma) * colorWalkConfig.matching.chromaWeight;
	return Math.hypot(lightnessDistance, chromaDistance, hueDistance);
}

function scoreCandidate(candidate: ColorWalkCandidate, queryLab: LabColor): ColorWalkMatch | null {
	const cellScores = candidate.features.spatialCells.map((cell) => scoreCell(cell, queryLab));
	const supportingCells = cellScores.filter(
		(score) => score >= colorWalkConfig.matching.minimumCellEvidence,
	).length;
	const strongestEvidence = Math.max(0, ...cellScores);

	if (
		strongestEvidence < colorWalkConfig.matching.minimumPhotoEvidence ||
		supportingCells < colorWalkConfig.matching.minimumSupportingCells
	) {
		return null;
	}

	const strongestCells = [...cellScores].sort((first, second) => second - first).slice(0, 3);
	const supportingEvidence =
		strongestCells.reduce((total, score) => total + score, 0) / strongestCells.length;
	const score = strongestEvidence * 0.82 + supportingEvidence * 0.18;
	return { id: candidate.id, score };
}

function scoreCell(cell: SpatialColorCell, queryLab: LabColor) {
	return cell.colors.reduce((best, color) => {
		if (
			color.proportion < colorWalkConfig.matching.minimumColorProportion ||
			labChroma(color.lab) < colorWalkConfig.matching.minimumLocalChroma
		) {
			return best;
		}

		const distance = colorWalkPerceptualDistance(queryLab, color.lab);
		const closeness =
			1 -
			smoothstep(
				colorWalkConfig.matching.fullMatchDistance,
				colorWalkConfig.matching.maximumMatchDistance,
				distance,
			);
		const presenceWeight = 0.45 + 0.55 * Math.sqrt(color.proportion);
		return Math.max(best, closeness * presenceWeight);
	}, 0);
}

function smoothstep(start: number, end: number, value: number) {
	const progress = clamp((value - start) / (end - start), 0, 1);
	return progress * progress * (3 - 2 * progress);
}

function clamp(value: number, minimum: number, maximum: number) {
	return Math.min(maximum, Math.max(minimum, value));
}
