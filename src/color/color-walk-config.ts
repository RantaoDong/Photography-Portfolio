export interface ColorWalkRenderingParameters {
	refinementMode: ColorWalkRefinementMode;
	preserveRadius: number;
	fadeEnd: number;
	falloffSteepness: number;
	minimumSaturationRetention: number;
	minimumBrightnessRetention: number;
	regionSmoothing: number;
	edgeSensitivity: number;
	regionSupport: number;
}

export type ColorWalkRefinementMode = 'pixel' | 'edge-aware';

export interface ColorWalkTunerControls {
	preservedColorRange: number;
	transitionWidth: number;
	transitionSharpness: number;
	otherColorSaturation: number;
	otherColorBrightness: number;
	regionSmoothing: number;
	edgeSensitivity: number;
	regionSupport: number;
}

export const colorWalkRenderingDefaults: ColorWalkRenderingParameters = {
	refinementMode: 'edge-aware',
	preserveRadius: 13.02,
	fadeEnd: 39.02,
	falloffSteepness: 2.4,
	minimumSaturationRetention: 0.185,
	minimumBrightnessRetention: 0.856,
	regionSmoothing: 0.67,
	edgeSensitivity: 0.72,
	regionSupport: 0.332,
};

export const colorWalkTunerRanges = {
	preservedColorRange: { minimum: 6, maximum: 32 },
	transitionWidth: { minimum: 10, maximum: 60 },
	transitionSharpness: { minimum: 0.75, maximum: 5 },
	otherColorSaturation: { minimum: 0.15, maximum: 0.65 },
	otherColorBrightness: { minimum: 0.76, maximum: 1 },
	regionSmoothing: { minimum: 0, maximum: 1 },
	edgeSensitivity: { minimum: 0, maximum: 1 },
	regionSupport: { minimum: 0.2, maximum: 0.75 },
} as const;

export const colorWalkTunerPresets: Record<string, ColorWalkTunerControls> = {
	Subtle: {
		preservedColorRange: 58,
		transitionWidth: 72,
		transitionSharpness: 24,
		otherColorSaturation: 62,
		otherColorBrightness: 78,
		regionSmoothing: 45,
		edgeSensitivity: 65,
		regionSupport: 60,
	},
	Balanced: renderingParametersToTunerControls(colorWalkRenderingDefaults),
	Strong: {
		preservedColorRange: 38,
		transitionWidth: 28,
		transitionSharpness: 76,
		otherColorSaturation: 8,
		otherColorBrightness: 24,
		regionSmoothing: 85,
		edgeSensitivity: 82,
		regionSupport: 28,
	},
};

export function tunerControlsToRenderingParameters(
	controls: ColorWalkTunerControls,
	refinementMode: ColorWalkRefinementMode = 'pixel',
): ColorWalkRenderingParameters {
	const preserveRadius = mapControl(
		controls.preservedColorRange,
		colorWalkTunerRanges.preservedColorRange,
	);
	const transitionWidth = mapControl(
		controls.transitionWidth,
		colorWalkTunerRanges.transitionWidth,
	);
	return {
		refinementMode,
		preserveRadius,
		fadeEnd: preserveRadius + transitionWidth,
		falloffSteepness: mapControl(
			controls.transitionSharpness,
			colorWalkTunerRanges.transitionSharpness,
		),
		minimumSaturationRetention: mapControl(
			controls.otherColorSaturation,
			colorWalkTunerRanges.otherColorSaturation,
		),
		minimumBrightnessRetention: mapControl(
			controls.otherColorBrightness,
			colorWalkTunerRanges.otherColorBrightness,
		),
		regionSmoothing: mapControl(controls.regionSmoothing, colorWalkTunerRanges.regionSmoothing),
		edgeSensitivity: mapControl(controls.edgeSensitivity, colorWalkTunerRanges.edgeSensitivity),
		regionSupport: mapControl(100 - controls.regionSupport, colorWalkTunerRanges.regionSupport),
	};
}

export function renderingParametersToTunerControls(
	parameters: ColorWalkRenderingParameters,
): ColorWalkTunerControls {
	return {
		preservedColorRange: unmapControl(
			parameters.preserveRadius,
			colorWalkTunerRanges.preservedColorRange,
		),
		transitionWidth: unmapControl(
			parameters.fadeEnd - parameters.preserveRadius,
			colorWalkTunerRanges.transitionWidth,
		),
		transitionSharpness: unmapControl(
			parameters.falloffSteepness,
			colorWalkTunerRanges.transitionSharpness,
		),
		otherColorSaturation: unmapControl(
			parameters.minimumSaturationRetention,
			colorWalkTunerRanges.otherColorSaturation,
		),
		otherColorBrightness: unmapControl(
			parameters.minimumBrightnessRetention,
			colorWalkTunerRanges.otherColorBrightness,
		),
		regionSmoothing: unmapControl(parameters.regionSmoothing, colorWalkTunerRanges.regionSmoothing),
		edgeSensitivity: unmapControl(parameters.edgeSensitivity, colorWalkTunerRanges.edgeSensitivity),
		regionSupport: 100 - unmapControl(parameters.regionSupport, colorWalkTunerRanges.regionSupport),
	};
}

export function validateColorWalkRenderingParameters(
	parameters: ColorWalkRenderingParameters,
): ColorWalkRenderingParameters {
	if (parameters.refinementMode !== 'pixel' && parameters.refinementMode !== 'edge-aware') {
		throw new Error('refinementMode must be pixel or edge-aware.');
	}
	const values = Object.entries(parameters)
		.filter(([key]) => key !== 'refinementMode')
		.map(([, value]) => value as number);
	if (values.some((value) => !Number.isFinite(value))) {
		throw new Error('Every Color Walk rendering parameter must be a finite number.');
	}

	assertInRange(
		parameters.preserveRadius,
		colorWalkTunerRanges.preservedColorRange,
		'preserveRadius',
	);
	assertInRange(
		parameters.fadeEnd - parameters.preserveRadius,
		colorWalkTunerRanges.transitionWidth,
		'transition width',
	);
	assertInRange(
		parameters.falloffSteepness,
		colorWalkTunerRanges.transitionSharpness,
		'falloffSteepness',
	);
	assertInRange(
		parameters.minimumSaturationRetention,
		colorWalkTunerRanges.otherColorSaturation,
		'minimumSaturationRetention',
	);
	assertInRange(
		parameters.minimumBrightnessRetention,
		colorWalkTunerRanges.otherColorBrightness,
		'minimumBrightnessRetention',
	);
	assertInRange(
		parameters.regionSmoothing,
		colorWalkTunerRanges.regionSmoothing,
		'regionSmoothing',
	);
	assertInRange(
		parameters.edgeSensitivity,
		colorWalkTunerRanges.edgeSensitivity,
		'edgeSensitivity',
	);
	assertInRange(parameters.regionSupport, colorWalkTunerRanges.regionSupport, 'regionSupport');
	return parameters;
}

export const colorWalkConfig = {
	matching: {
		minimumLocalChroma: 9,
		lightnessWeight: 0.2,
		chromaWeight: 0.28,
		fullMatchDistance: 10,
		maximumMatchDistance: 48,
		minimumColorProportion: 0.025,
		minimumCellEvidence: 0.28,
		minimumPhotoEvidence: 0.46,
		minimumSupportingCells: 1,
		resultSafetyCap: 36,
	},
	rendering: {
		maxDisplayDimension: 1440,
		maxProcessingDimension: 1200,
		maxRefinementDimension: 360,
		refinementRadius: 4,
		...colorWalkRenderingDefaults,
		imageQuality: 82,
	},
} as const;

function mapControl(value: number, range: { minimum: number; maximum: number }) {
	return range.minimum + (clamp(value, 0, 100) / 100) * (range.maximum - range.minimum);
}

function unmapControl(value: number, range: { minimum: number; maximum: number }) {
	return clamp(((value - range.minimum) / (range.maximum - range.minimum)) * 100, 0, 100);
}

function assertInRange(value: number, range: { minimum: number; maximum: number }, label: string) {
	if (value < range.minimum || value > range.maximum) {
		throw new Error(`${label} must be between ${range.minimum} and ${range.maximum}.`);
	}
}

function clamp(value: number, minimum: number, maximum: number) {
	return Math.min(maximum, Math.max(minimum, value));
}
