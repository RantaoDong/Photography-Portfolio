import type { LabColor, RgbColor } from './color-types.ts';

const referenceWhite = [0.95047, 1, 1.08883] as const;

export function rgbToLab(rgb: RgbColor): LabColor {
	const [r, g, b] = rgb.map((channel) => {
		const value = channel / 255;
		return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	});
	const x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375;
	const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
	const z = r * 0.0193339 + g * 0.119192 + b * 0.9503041;
	const [fx, fy, fz] = [x / referenceWhite[0], y / referenceWhite[1], z / referenceWhite[2]].map(
		(value) => (value > 216 / 24389 ? Math.cbrt(value) : (24389 / 27 / 116) * value + 16 / 116),
	);
	return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToRgb(lab: LabColor): RgbColor {
	const fy = (lab[0] + 16) / 116;
	const fx = lab[1] / 500 + fy;
	const fz = fy - lab[2] / 200;
	const convert = (value: number) => {
		const cube = value ** 3;
		return cube > 216 / 24389 ? cube : (116 * value - 16) / (24389 / 27);
	};
	const x = referenceWhite[0] * convert(fx);
	const y = referenceWhite[1] * convert(fy);
	const z = referenceWhite[2] * convert(fz);
	const linear = [
		x * 3.2404542 + y * -1.5371385 + z * -0.4985314,
		x * -0.969266 + y * 1.8760108 + z * 0.041556,
		x * 0.0556434 + y * -0.2040259 + z * 1.0572252,
	];
	return linear.map((value) => {
		const encoded = value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
		return Math.round(clamp(encoded, 0, 1) * 255);
	}) as RgbColor;
}

export function labDistance(a: LabColor, b: LabColor) {
	return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function labChroma(lab: LabColor) {
	return Math.hypot(lab[1], lab[2]);
}

export function labHue(lab: LabColor) {
	const angle = (Math.atan2(lab[2], lab[1]) * 180) / Math.PI;
	return angle < 0 ? angle + 360 : angle;
}

export function rgbToCss(rgb: RgbColor) {
	return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
}

function clamp(value: number, minimum: number, maximum: number) {
	return Math.min(maximum, Math.max(minimum, value));
}
