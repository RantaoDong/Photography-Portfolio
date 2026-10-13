import { labChroma, rgbToLab } from './color-conversion.ts';
import { colorWalkConfig } from './color-walk-config.ts';
import {
	colorWalkRankingDefaults,
	type ColorWalkRankingWeights,
} from './color-walk-ranking-config.ts';
import type { LabColor, RgbColor, SpatialColorCell } from './color-types.ts';

export interface ColorWalkCandidate {
	id: string;
	features: {
		spatialCells: SpatialColorCell[];
	};
}

export interface ColorWalkRankingDiagnostics {
	presence: number;
	coherence: number;
	boundaryClarity: number;
	colorSeparation: number;
	revealImpact: number;
	overspreadPenalty: number;
	supportingCellRatio: number;
}

export interface ColorWalkMatch {
	id: string;
	score: number;
	diagnostics: ColorWalkRankingDiagnostics;
}

export function findColorWalkMatches(
	candidates: ColorWalkCandidate[],
	selectedColor: RgbColor,
	weights: ColorWalkRankingWeights = colorWalkRankingDefaults,
): ColorWalkMatch[] {
	const queryLab = rgbToLab(selectedColor);
	return candidates
		.map((candidate) => scoreCandidate(candidate, queryLab, weights))
		.filter((match): match is ColorWalkMatch => match !== null)
		.sort((first, second) => second.score - first.score || first.id.localeCompare(second.id))
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

function scoreCandidate(
	candidate: ColorWalkCandidate,
	queryLab: LabColor,
	weights: ColorWalkRankingWeights,
): ColorWalkMatch | null {
	const cells = candidate.features.spatialCells.map((cell) => analyzeCell(cell, queryLab));
	const supporting = cells.filter(
		(cell) => cell.evidence >= colorWalkConfig.matching.minimumCellEvidence,
	);
	const strongestEvidence = Math.max(0, ...cells.map((cell) => cell.evidence));
	if (
		strongestEvidence < colorWalkConfig.matching.minimumPhotoEvidence ||
		supporting.length < colorWalkConfig.matching.minimumSupportingCells
	) {
		return null;
	}

	const strongestCells = [...cells]
		.sort((first, second) => second.evidence - first.evidence)
		.slice(0, 3);
	const supportingEvidence = average(strongestCells.map((cell) => cell.evidence));
	const presence = strongestEvidence * 0.82 + supportingEvidence * 0.18;
	const supportingKeys = new Set(supporting.map((cell) => cell.key));
	const coherence = largestConnectedRegion(supportingKeys) / Math.max(1, supporting.length);
	const nonSupporting = cells.filter((cell) => !supportingKeys.has(cell.key));
	const boundaryClarity = nonSupporting.length
		? clamp(
				average(supporting.map((cell) => cell.evidence)) -
					average(nonSupporting.map((cell) => cell.evidence)),
				0,
				1,
			)
		: 0;
	const colorSeparation = average(
		supporting.map((cell) => cell.separation * (0.35 + 0.65 * cell.evidence)),
	);
	const supportingCellRatio = supporting.length / Math.max(1, cells.length);
	const overspreadPenalty = smoothstep(0.45, 0.9, supportingCellRatio);
	const revealImpact = clamp(
		presence * (0.35 + 0.65 * boundaryClarity) * (0.45 + 0.55 * colorSeparation),
		0,
		1,
	);
	const positiveWeight =
		weights.presenceWeight +
		weights.coherenceWeight +
		weights.colorSeparationWeight +
		weights.revealImpactWeight;
	const positiveScore =
		(presence * weights.presenceWeight +
			coherence * weights.coherenceWeight +
			colorSeparation * weights.colorSeparationWeight +
			revealImpact * weights.revealImpactWeight) /
		Math.max(Number.EPSILON, positiveWeight);
	const score = clamp(positiveScore - overspreadPenalty * weights.overspreadPenaltyStrength, 0, 1);

	return {
		id: candidate.id,
		score,
		diagnostics: {
			presence,
			coherence,
			boundaryClarity,
			colorSeparation,
			revealImpact,
			overspreadPenalty,
			supportingCellRatio,
		},
	};
}

function analyzeCell(cell: SpatialColorCell, queryLab: LabColor) {
	let evidence = 0;
	let matchedMass = 0;
	let unrelatedMass = 0;
	for (const color of cell.colors) {
		if (
			color.proportion < colorWalkConfig.matching.minimumColorProportion ||
			labChroma(color.lab) < colorWalkConfig.matching.minimumLocalChroma
		) {
			unrelatedMass += color.proportion;
			continue;
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
		evidence = Math.max(evidence, closeness * presenceWeight);
		matchedMass += closeness * color.proportion;
		unrelatedMass += (1 - closeness) * color.proportion;
	}
	return {
		key: `${cell.x}:${cell.y}`,
		evidence,
		separation: matchedMass / Math.max(Number.EPSILON, matchedMass + unrelatedMass),
	};
}

function largestConnectedRegion(keys: Set<string>) {
	let largest = 0;
	const remaining = new Set(keys);
	for (const start of keys) {
		if (!remaining.has(start)) continue;
		remaining.delete(start);
		const queue = [start];
		let size = 0;
		while (queue.length > 0) {
			const current = queue.pop()!;
			size += 1;
			const [x, y] = current.split(':').map(Number);
			for (const neighbor of [`${x - 1}:${y}`, `${x + 1}:${y}`, `${x}:${y - 1}`, `${x}:${y + 1}`]) {
				if (!remaining.delete(neighbor)) continue;
				queue.push(neighbor);
			}
		}
		largest = Math.max(largest, size);
	}
	return largest;
}

function average(values: number[]) {
	return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function smoothstep(start: number, end: number, value: number) {
	const progress = clamp((value - start) / (end - start), 0, 1);
	return progress * progress * (3 - 2 * progress);
}

function clamp(value: number, minimum: number, maximum: number) {
	return Math.min(maximum, Math.max(minimum, value));
}
