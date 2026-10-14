export interface ColorPathTransitionParameters {
	totalDurationMs: number;
	maximumBlurRadius: number;
	colorBiasStrength: number;
	grainAmount: number;
	grainScale: number;
	spreadIrregularity: number;
	spreadSoftness: number;
	abstractHold: number;
	revealStart: number;
	maximumRenderDimension: number;
}

export const colorPathTransitionDefaults: ColorPathTransitionParameters = {
	totalDurationMs: 740,
	maximumBlurRadius: 68,
	colorBiasStrength: 0.11,
	grainAmount: 0.225,
	grainScale: 2.5,
	spreadIrregularity: 0,
	spreadSoftness: 0.38,
	abstractHold: 0.54,
	revealStart: 0.82,
	maximumRenderDimension: 960,
};

export function validateColorPathTransitionParameters(
	value: ColorPathTransitionParameters,
): ColorPathTransitionParameters {
	assertRange(value.totalDurationMs, 120, 3000, 'totalDurationMs');
	assertRange(value.maximumBlurRadius, 0, 120, 'maximumBlurRadius');
	assertRange(value.colorBiasStrength, 0, 0.8, 'colorBiasStrength');
	assertRange(value.grainAmount, 0, 0.5, 'grainAmount');
	assertRange(value.grainScale, 1, 12, 'grainScale');
	assertRange(value.spreadIrregularity, 0, 1, 'spreadIrregularity');
	assertRange(value.spreadSoftness, 0.01, 0.4, 'spreadSoftness');
	assertRange(value.abstractHold, 0.12, 0.8, 'abstractHold');
	assertRange(value.revealStart, 0.35, 0.95, 'revealStart');
	assertRange(value.maximumRenderDimension, 320, 2000, 'maximumRenderDimension');
	if (value.revealStart - value.abstractHold < 0.08) {
		throw new Error('abstractHold must leave time for the current photograph to lose detail.');
	}
	return value;
}

function assertRange(value: number, minimum: number, maximum: number, label: string) {
	if (!Number.isFinite(value) || value < minimum || value > maximum) {
		throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
	}
}
