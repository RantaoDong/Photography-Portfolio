import { labToRgb, rgbToCss, rgbToLab } from './color-conversion.ts';
import { sampleColorPath, type ColorPathPoint } from './color-path.ts';
import type { LabColor, RgbColor } from './color-types.ts';

const ribbonSampleCount = 33;
const ribbonChromaScale = 0.32;
const ribbonLightnessTarget = 74;
const ribbonLightnessPull = 0.42;

export function createSoftColorPathGradient(points: ColorPathPoint[]) {
	const stops = sampleColorPath(points, ribbonSampleCount).map(({ position, rgb }) => {
		return `${rgbToCss(softenColorPathUiColor(rgb))} ${formatPercentage(position)}%`;
	});
	return `linear-gradient(90deg, ${stops.join(', ')})`;
}

export function softenColorPathUiColor(rgb: RgbColor): RgbColor {
	const lab = rgbToLab(rgb);
	const lightness = clamp(lab[0] + (ribbonLightnessTarget - lab[0]) * ribbonLightnessPull, 58, 82);
	return labToRgb([lightness, lab[1] * ribbonChromaScale, lab[2] * ribbonChromaScale] as LabColor);
}

function formatPercentage(position: number) {
	return Number((position * 100).toFixed(3));
}

function clamp(value: number, minimum: number, maximum: number) {
	return Math.min(maximum, Math.max(minimum, value));
}
