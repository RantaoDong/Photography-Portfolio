export const colorPathSequenceConfig = {
	minimumLength: 5,
	maximumLength: 15,
	preferredMinimumProgress: 0.13,
	preferredMaximumProgress: 0.42,
	redundancyPenalty: 0.12,
	candidateQualityThreshold: 0.03,
	endpointWindow: 0.08,
	sampleSpacing: 0.04,
} as const;

export const colorPathConfig = {
	controlPoints: {
		minimum: 3,
		maximum: 5,
	},
	sequence: colorPathSequenceConfig,
} as const;
