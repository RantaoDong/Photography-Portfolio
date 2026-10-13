export interface ColorWalkRankingWeights {
	presenceWeight: number;
	coherenceWeight: number;
	colorSeparationWeight: number;
	revealImpactWeight: number;
	overspreadPenaltyStrength: number;
}

export const colorWalkRankingDefaults: ColorWalkRankingWeights = {
	presenceWeight: 0.9,
	coherenceWeight: 0.56,
	colorSeparationWeight: 0.26,
	revealImpactWeight: 0.78,
	overspreadPenaltyStrength: 0.48,
};

export const colorWalkRankingWeightRange = { minimum: 0, maximum: 2 } as const;

export function validateColorWalkRankingWeights(weights: ColorWalkRankingWeights) {
	for (const [key, value] of Object.entries(weights)) {
		if (!Number.isFinite(value)) throw new Error(`${key} must be a finite number.`);
		if (
			value < colorWalkRankingWeightRange.minimum ||
			value > colorWalkRankingWeightRange.maximum
		) {
			throw new Error(
				`${key} must be between ${colorWalkRankingWeightRange.minimum} and ${colorWalkRankingWeightRange.maximum}.`,
			);
		}
	}
	if (
		weights.presenceWeight +
			weights.coherenceWeight +
			weights.colorSeparationWeight +
			weights.revealImpactWeight ===
		0
	) {
		throw new Error('At least one positive ranking weight is required.');
	}
	return weights;
}
