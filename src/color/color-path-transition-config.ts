export interface ColorPathTransitionParameters {
	totalDurationMs: number;
	maximumBlurRadius: number;
	colorBiasStrength: number;
	grainAmount: number;
	grainScale: number;
	spreadIrregularity: number;
	spreadSoftness: number;
	middleInterpolationStart: number;
	middleInterpolationEnd: number;
	sharpeningStart: number;
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
	middleInterpolationStart: 0.28,
	middleInterpolationEnd: 0.68,
	sharpeningStart: 0.72,
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
	assertRange(value.middleInterpolationStart, 0.05, 0.6, 'middleInterpolationStart');
	assertRange(value.middleInterpolationEnd, 0.4, 0.9, 'middleInterpolationEnd');
	assertRange(value.sharpeningStart, 0.5, 0.95, 'sharpeningStart');
	assertRange(value.maximumRenderDimension, 320, 2000, 'maximumRenderDimension');
	if (value.middleInterpolationStart >= value.middleInterpolationEnd) {
		throw new Error('middleInterpolationStart must be before middleInterpolationEnd.');
	}
	if (value.middleInterpolationEnd > value.sharpeningStart) {
		throw new Error('middleInterpolationEnd must not be after sharpeningStart.');
	}
	return value;
}

function assertRange(value: number, minimum: number, maximum: number, label: string) {
	if (!Number.isFinite(value) || value < minimum || value > maximum) {
		throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
	}
}
