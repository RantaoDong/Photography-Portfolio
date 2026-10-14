import { labDistance } from './color-conversion.ts';
import { colorPathConfig } from './color-path-config.ts';
import { getColorPathLength, sampleColorPath, type ColorPathPoint } from './color-path.ts';
import { scorePhotoColorMatch } from './color-similarity.ts';
import type { ColorToneCandidate } from './color-tone-matching.ts';

export interface ColorPathSequenceEntry {
	id: string;
	pathPosition: number;
	similarity: number;
}

interface ScoredCandidate extends ColorToneCandidate {
	scores: number[];
}

export function createColorPathSequence(
	candidates: ColorToneCandidate[],
	controlPoints: ColorPathPoint[],
): ColorPathSequenceEntry[] {
	if (controlPoints.length < colorPathConfig.controlPoints.minimum || candidates.length === 0) {
		return [];
	}

	const pathLength = getColorPathLength(controlPoints);
	const sampleCount = clamp(
		Math.ceil(pathLength / colorPathConfig.sequence.sampleSpacing) + 1,
		49,
		121,
	);
	const samples = sampleColorPath(controlPoints, sampleCount);
	const scored: ScoredCandidate[] = candidates.map((candidate) => ({
		...candidate,
		scores: samples.map(
			(sample) => scorePhotoColorMatch(sample.rgb, candidate.features).similarity,
		),
	}));
	const targetMaximum = clamp(
		Math.round(colorPathConfig.sequence.minimumLength + pathLength * 3.5),
		colorPathConfig.sequence.minimumLength,
		colorPathConfig.sequence.maximumLength,
	);

	const selected: Array<ColorPathSequenceEntry & { sampleIndex: number }> = [];
	const usedIds = new Set<string>();
	const start = chooseEndpoint(scored, samples.length, false, usedIds);
	if (start) {
		selected.push(start);
		usedIds.add(start.id);
	}
	const end = chooseEndpoint(scored, samples.length, true, usedIds);
	if (end) {
		selected.push(end);
		usedIds.add(end.id);
	}
	selected.sort((first, second) => first.sampleIndex - second.sampleIndex);

	while (selected.length < targetMaximum) {
		const belowMinimum = selected.length < colorPathConfig.sequence.minimumLength;
		const option = chooseIntermediate(scored, selected, usedIds, pathLength, belowMinimum);
		if (!option) break;
		selected.push(option);
		selected.sort((first, second) => first.sampleIndex - second.sampleIndex);
		usedIds.add(option.id);
	}

	return selected.map(({ id, pathPosition, similarity }) => ({ id, pathPosition, similarity }));
}

function chooseEndpoint(
	candidates: ScoredCandidate[],
	sampleCount: number,
	atEnd: boolean,
	usedIds: Set<string>,
) {
	const maximumOffset = Math.max(
		1,
		Math.round((sampleCount - 1) * colorPathConfig.sequence.endpointWindow),
	);
	let best: (ColorPathSequenceEntry & { sampleIndex: number; utility: number }) | null = null;
	for (const candidate of candidates) {
		if (usedIds.has(candidate.id)) continue;
		for (let offset = 0; offset <= maximumOffset; offset += 1) {
			const sampleIndex = atEnd ? sampleCount - 1 - offset : offset;
			const similarity = candidate.scores[sampleIndex];
			const utility = similarity - (offset / maximumOffset) * 0.12;
			if (!best || utility > best.utility) {
				best = {
					id: candidate.id,
					pathPosition: sampleIndex / (sampleCount - 1),
					sampleIndex,
					similarity,
					utility,
				};
			}
		}
	}
	return best;
}

function chooseIntermediate(
	candidates: ScoredCandidate[],
	selected: Array<ColorPathSequenceEntry & { sampleIndex: number }>,
	usedIds: Set<string>,
	pathLength: number,
	belowMinimum: boolean,
) {
	if (selected.length < 2) return null;
	const sampleCount = candidates[0]?.scores.length ?? 0;
	const minimumQuality = belowMinimum ? 0 : colorPathConfig.sequence.candidateQualityThreshold;
	let best: (ColorPathSequenceEntry & { sampleIndex: number; utility: number }) | null = null;

	for (let gapIndex = 0; gapIndex < selected.length - 1; gapIndex += 1) {
		const left = selected[gapIndex];
		const right = selected[gapIndex + 1];
		const gapProgress = (right.pathPosition - left.pathPosition) * pathLength;
		if (!belowMinimum && gapProgress <= colorPathConfig.sequence.preferredMaximumProgress) continue;
		for (
			let sampleIndex = left.sampleIndex + 1;
			sampleIndex < right.sampleIndex;
			sampleIndex += 1
		) {
			const position = sampleIndex / (sampleCount - 1);
			const leftProgress = (position - left.pathPosition) * pathLength;
			const rightProgress = (right.pathPosition - position) * pathLength;
			if (
				!belowMinimum &&
				(leftProgress < colorPathConfig.sequence.preferredMinimumProgress ||
					rightProgress < colorPathConfig.sequence.preferredMinimumProgress)
			) {
				continue;
			}
			const midpoint = (left.pathPosition + right.pathPosition) / 2;
			const halfGap = Math.max(Number.EPSILON, (right.pathPosition - left.pathPosition) / 2);
			const centrality = 1 - Math.abs(position - midpoint) / halfGap;

			for (const candidate of candidates) {
				if (usedIds.has(candidate.id)) continue;
				const similarity = candidate.scores[sampleIndex];
				if (similarity < minimumQuality) continue;
				const redundancy = Math.max(
					redundancyPenalty(candidate, left, candidates),
					redundancyPenalty(candidate, right, candidates),
				);
				const shortStepPenalty =
					progressPenalty(leftProgress, true) + progressPenalty(rightProgress, true);
				const longStepPenalty =
					progressPenalty(leftProgress, false) + progressPenalty(rightProgress, false);
				const utility =
					similarity + centrality * 0.025 - shortStepPenalty - longStepPenalty - redundancy;
				if (!best || utility > best.utility) {
					best = {
						id: candidate.id,
						pathPosition: position,
						sampleIndex,
						similarity,
						utility,
					};
				}
			}
		}
	}

	if (!best) return null;
	if (!belowMinimum && best.utility < colorPathConfig.sequence.candidateQualityThreshold)
		return null;
	return best;
}

function redundancyPenalty(
	candidate: ScoredCandidate,
	neighbor: ColorPathSequenceEntry,
	candidates: ScoredCandidate[],
) {
	const neighborCandidate = candidates.find((item) => item.id === neighbor.id);
	if (!neighborCandidate) return 0;
	const distance = labDistance(
		candidate.features.averageLab,
		neighborCandidate.features.averageLab,
	);
	const similarity = 1 - clamp(distance / 14, 0, 1);
	return similarity * colorPathConfig.sequence.redundancyPenalty;
}

function progressPenalty(progress: number, penalizeShort: boolean) {
	if (penalizeShort) {
		const minimum = colorPathConfig.sequence.preferredMinimumProgress;
		return progress >= minimum ? 0 : ((minimum - progress) / minimum) * 0.05;
	}
	const maximum = colorPathConfig.sequence.preferredMaximumProgress;
	return progress <= maximum ? 0 : ((progress - maximum) / maximum) * 0.035;
}

function clamp(value: number, minimum: number, maximum: number) {
	return Math.min(maximum, Math.max(minimum, value));
}
