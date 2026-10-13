import { rgbToLab } from './color-conversion.ts';
import {
	colorWalkConfig,
	colorWalkRenderingDefaults,
	type ColorWalkRenderingParameters,
} from './color-walk-config.ts';
import { colorWalkPerceptualDistance } from './color-walk-matching.ts';
import type { RgbColor } from './color-types.ts';

export interface PreparedColorWalkImage {
	width: number;
	height: number;
	pixels: Uint8ClampedArray;
	distances: Float32Array;
}

export interface ColorWalkMasks {
	raw: Float32Array;
	refined: Float32Array;
	refinementWidth: number;
	refinementHeight: number;
}

const refinementGuidanceCache = new WeakMap<
	PreparedColorWalkImage,
	{ width: number; height: number; guidance: Float32Array }
>();

export function renderColorWalkImage(
	image: HTMLImageElement,
	selectedColor: RgbColor,
	parameters: ColorWalkRenderingParameters = colorWalkRenderingDefaults,
): HTMLCanvasElement {
	const prepared = prepareColorWalkImage(image, selectedColor);
	return renderPreparedColorWalkImage(prepared, parameters);
}

export function prepareColorWalkImage(
	image: HTMLImageElement,
	selectedColor: RgbColor,
): PreparedColorWalkImage {
	const scale = Math.min(
		1,
		colorWalkConfig.rendering.maxProcessingDimension /
			Math.max(image.naturalWidth, image.naturalHeight),
	);
	const width = Math.max(1, Math.round(image.naturalWidth * scale));
	const height = Math.max(1, Math.round(image.naturalHeight * scale));
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('Canvas rendering is unavailable.');
	context.imageSmoothingEnabled = true;
	context.imageSmoothingQuality = 'high';
	context.drawImage(image, 0, 0, width, height);
	const pixels = context.getImageData(0, 0, width, height).data;
	const distances = new Float32Array(width * height);
	const selectedLab = rgbToLab(selectedColor);
	for (let offset = 0, pixelIndex = 0; offset < pixels.length; offset += 4, pixelIndex += 1) {
		const rgb: RgbColor = [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
		distances[pixelIndex] = colorWalkPerceptualDistance(selectedLab, rgbToLab(rgb));
	}
	return { width, height, pixels: new Uint8ClampedArray(pixels), distances };
}

export function computeColorWalkMasks(
	prepared: PreparedColorWalkImage,
	parameters: ColorWalkRenderingParameters = colorWalkRenderingDefaults,
): ColorWalkMasks {
	const raw = new Float32Array(prepared.distances.length);
	for (let index = 0; index < raw.length; index += 1)
		raw[index] = preservationStrengthForDistance(prepared.distances[index], parameters);
	if (parameters.refinementMode === 'pixel') {
		return {
			raw,
			refined: raw,
			refinementWidth: prepared.width,
			refinementHeight: prepared.height,
		};
	}
	const scale = Math.min(
		1,
		colorWalkConfig.rendering.maxRefinementDimension / Math.max(prepared.width, prepared.height),
	);
	const refinementWidth = Math.max(1, Math.round(prepared.width * scale));
	const refinementHeight = Math.max(1, Math.round(prepared.height * scale));
	const guidance = getRefinementGuidance(prepared, refinementWidth, refinementHeight);
	const reducedMask = downsampleMask(
		raw,
		prepared.width,
		prepared.height,
		refinementWidth,
		refinementHeight,
	);
	const supported = refineColorWalkMask(
		reducedMask,
		guidance,
		refinementWidth,
		refinementHeight,
		parameters,
	);
	const refined = upsampleMask(
		supported,
		refinementWidth,
		refinementHeight,
		prepared.width,
		prepared.height,
		raw,
	);
	return { raw, refined, refinementWidth, refinementHeight };
}

export function renderPreparedColorWalkImage(
	prepared: PreparedColorWalkImage,
	parameters: ColorWalkRenderingParameters = colorWalkRenderingDefaults,
	masks: ColorWalkMasks = computeColorWalkMasks(prepared, parameters),
): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = prepared.width;
	canvas.height = prepared.height;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('Canvas rendering is unavailable.');
	const imageData = context.createImageData(prepared.width, prepared.height);
	imageData.data.set(prepared.pixels);
	const pixels = imageData.data;
	for (let offset = 0, pixelIndex = 0; offset < pixels.length; offset += 4, pixelIndex += 1) {
		const rgb: RgbColor = [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
		const treated = applyColorWalkEmphasisWithStrength(rgb, masks.refined[pixelIndex], parameters);
		pixels[offset] = treated[0];
		pixels[offset + 1] = treated[1];
		pixels[offset + 2] = treated[2];
	}
	context.putImageData(imageData, 0, 0);
	return canvas;
}

export function renderColorWalkMask(
	mask: Float32Array,
	width: number,
	height: number,
): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('Canvas rendering is unavailable.');
	const imageData = context.createImageData(width, height);
	for (let index = 0, offset = 0; index < mask.length; index += 1, offset += 4) {
		const value = Math.round(clamp(mask[index], 0, 1) * 255);
		imageData.data[offset] = value;
		imageData.data[offset + 1] = value;
		imageData.data[offset + 2] = value;
		imageData.data[offset + 3] = 255;
	}
	context.putImageData(imageData, 0, 0);
	return canvas;
}

export function refineColorWalkMask(
	rawMask: Float32Array,
	guidance: Float32Array,
	width: number,
	height: number,
	parameters: ColorWalkRenderingParameters,
): Float32Array {
	const radius = colorWalkConfig.rendering.refinementRadius;
	const spatialSigma = Math.max(1, radius * 0.65);
	const colorSigma = lerp(0.3, 0.035, parameters.edgeSensitivity);
	const horizontal = jointBilateralPass(
		rawMask,
		guidance,
		width,
		height,
		radius,
		spatialSigma,
		colorSigma,
		true,
	);
	const localEvidence = jointBilateralPass(
		horizontal,
		guidance,
		width,
		height,
		radius,
		spatialSigma,
		colorSigma,
		false,
	);
	const output = new Float32Array(rawMask.length);
	const threshold = parameters.regionSupport;
	for (let index = 0; index < output.length; index += 1) {
		const support = smoothstep(threshold * 0.45, threshold, localEvidence[index]);
		const expanded = rawMask[index] + (1 - rawMask[index]) * support * parameters.regionSmoothing;
		output[index] = Math.max(rawMask[index], expanded);
	}
	return output;
}

export function applyColorWalkEmphasis(
	rgb: RgbColor,
	distance: number,
	parameters: ColorWalkRenderingParameters = colorWalkRenderingDefaults,
): RgbColor {
	return applyColorWalkEmphasisWithStrength(
		rgb,
		preservationStrengthForDistance(distance, parameters),
		parameters,
	);
}

export function preservationStrengthForDistance(
	distance: number,
	parameters: ColorWalkRenderingParameters = colorWalkRenderingDefaults,
) {
	if (distance <= parameters.preserveRadius) return 1;
	if (distance >= parameters.fadeEnd) return 0;
	const progress = clamp(
		(distance - parameters.preserveRadius) / (parameters.fadeEnd - parameters.preserveRadius),
		0,
		1,
	);
	return (1 - progress) ** parameters.falloffSteepness;
}

export function saturationRetentionForDistance(
	distance: number,
	parameters: ColorWalkRenderingParameters = colorWalkRenderingDefaults,
) {
	return retentionForStrength(preservationStrengthForDistance(distance, parameters), parameters)
		.saturation;
}

export function brightnessRetentionForDistance(
	distance: number,
	parameters: ColorWalkRenderingParameters = colorWalkRenderingDefaults,
) {
	return retentionForStrength(preservationStrengthForDistance(distance, parameters), parameters)
		.brightness;
}

function applyColorWalkEmphasisWithStrength(
	rgb: RgbColor,
	strength: number,
	parameters: ColorWalkRenderingParameters,
): RgbColor {
	if (strength >= 0.999_999) return rgb;
	const retention = retentionForStrength(strength, parameters);
	const [hue, saturation, lightness] = rgbToHsl(rgb);
	return hslToRgb(hue, saturation * retention.saturation, lightness * retention.brightness);
}

function retentionForStrength(strength: number, parameters: ColorWalkRenderingParameters) {
	const clamped = clamp(strength, 0, 1);
	return {
		saturation:
			parameters.minimumSaturationRetention + clamped * (1 - parameters.minimumSaturationRetention),
		brightness:
			parameters.minimumBrightnessRetention + clamped * (1 - parameters.minimumBrightnessRetention),
	};
}

function getRefinementGuidance(prepared: PreparedColorWalkImage, width: number, height: number) {
	const cached = refinementGuidanceCache.get(prepared);
	if (cached && cached.width === width && cached.height === height) return cached.guidance;
	const guidance = new Float32Array(width * height * 3);
	const counts = new Uint32Array(width * height);
	for (let y = 0; y < prepared.height; y += 1) {
		const targetY = Math.min(height - 1, Math.floor((y * height) / prepared.height));
		for (let x = 0; x < prepared.width; x += 1) {
			const targetX = Math.min(width - 1, Math.floor((x * width) / prepared.width));
			const sourceIndex = y * prepared.width + x;
			const targetIndex = targetY * width + targetX;
			const sourceOffset = sourceIndex * 4;
			const targetOffset = targetIndex * 3;
			counts[targetIndex] += 1;
			guidance[targetOffset] += prepared.pixels[sourceOffset] / 255;
			guidance[targetOffset + 1] += prepared.pixels[sourceOffset + 1] / 255;
			guidance[targetOffset + 2] += prepared.pixels[sourceOffset + 2] / 255;
		}
	}
	for (let index = 0; index < counts.length; index += 1) {
		const count = counts[index] || 1;
		const offset = index * 3;
		guidance[offset] /= count;
		guidance[offset + 1] /= count;
		guidance[offset + 2] /= count;
	}
	refinementGuidanceCache.set(prepared, { width, height, guidance });
	return guidance;
}

function downsampleMask(
	mask: Float32Array,
	sourceWidth: number,
	sourceHeight: number,
	width: number,
	height: number,
) {
	const output = new Float32Array(width * height);
	const counts = new Uint32Array(width * height);
	for (let y = 0; y < sourceHeight; y += 1) {
		const targetY = Math.min(height - 1, Math.floor((y * height) / sourceHeight));
		for (let x = 0; x < sourceWidth; x += 1) {
			const targetX = Math.min(width - 1, Math.floor((x * width) / sourceWidth));
			const sourceIndex = y * sourceWidth + x;
			const targetIndex = targetY * width + targetX;
			output[targetIndex] += mask[sourceIndex];
			counts[targetIndex] += 1;
		}
	}
	for (let index = 0; index < output.length; index += 1) {
		output[index] /= counts[index] || 1;
	}
	return output;
}

function jointBilateralPass(
	input: Float32Array,
	guidance: Float32Array,
	width: number,
	height: number,
	radius: number,
	spatialSigma: number,
	colorSigma: number,
	horizontal: boolean,
) {
	const output = new Float32Array(input.length);
	const spatialDenominator = 2 * spatialSigma * spatialSigma;
	const colorDenominator = 2 * colorSigma * colorSigma;
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const centerIndex = y * width + x;
			const centerOffset = centerIndex * 3;
			let weighted = 0;
			let weightTotal = 0;
			for (let delta = -radius; delta <= radius; delta += 1) {
				const sampleX = horizontal ? x + delta : x;
				const sampleY = horizontal ? y : y + delta;
				if (sampleX < 0 || sampleX >= width || sampleY < 0 || sampleY >= height) continue;
				const sampleIndex = sampleY * width + sampleX;
				const sampleOffset = sampleIndex * 3;
				const redDelta = guidance[centerOffset] - guidance[sampleOffset];
				const greenDelta = guidance[centerOffset + 1] - guidance[sampleOffset + 1];
				const blueDelta = guidance[centerOffset + 2] - guidance[sampleOffset + 2];
				const colorDistance = redDelta * redDelta + greenDelta * greenDelta + blueDelta * blueDelta;
				const weight =
					Math.exp(-(delta * delta) / spatialDenominator) *
					Math.exp(-colorDistance / colorDenominator);
				weighted += input[sampleIndex] * weight;
				weightTotal += weight;
			}
			output[centerIndex] = weightTotal ? weighted / weightTotal : input[centerIndex];
		}
	}
	return output;
}

function upsampleMask(
	mask: Float32Array,
	width: number,
	height: number,
	targetWidth: number,
	targetHeight: number,
	raw: Float32Array,
) {
	if (width === targetWidth && height === targetHeight) {
		const output = new Float32Array(mask.length);
		for (let index = 0; index < output.length; index += 1)
			output[index] = Math.max(raw[index], mask[index]);
		return output;
	}
	const output = new Float32Array(targetWidth * targetHeight);
	for (let y = 0; y < targetHeight; y += 1) {
		const sourceY = ((y + 0.5) * height) / targetHeight - 0.5;
		const y0 = clamp(Math.floor(sourceY), 0, height - 1);
		const y1 = Math.min(height - 1, y0 + 1);
		const yWeight = clamp(sourceY - y0, 0, 1);
		for (let x = 0; x < targetWidth; x += 1) {
			const sourceX = ((x + 0.5) * width) / targetWidth - 0.5;
			const x0 = clamp(Math.floor(sourceX), 0, width - 1);
			const x1 = Math.min(width - 1, x0 + 1);
			const xWeight = clamp(sourceX - x0, 0, 1);
			const top = lerp(mask[y0 * width + x0], mask[y0 * width + x1], xWeight);
			const bottom = lerp(mask[y1 * width + x0], mask[y1 * width + x1], xWeight);
			const index = y * targetWidth + x;
			output[index] = Math.max(raw[index], lerp(top, bottom, yWeight));
		}
	}
	return output;
}

function smoothstep(start: number, end: number, value: number) {
	const progress = clamp((value - start) / Math.max(0.000_001, end - start), 0, 1);
	return progress * progress * (3 - 2 * progress);
}

function rgbToHsl([red, green, blue]: RgbColor): [number, number, number] {
	const r = red / 255;
	const g = green / 255;
	const b = blue / 255;
	const maximum = Math.max(r, g, b);
	const minimum = Math.min(r, g, b);
	const lightness = (maximum + minimum) / 2;
	const delta = maximum - minimum;
	if (delta === 0) return [0, 0, lightness];
	const saturation = delta / (1 - Math.abs(2 * lightness - 1));
	const hue =
		maximum === r
			? ((g - b) / delta) % 6
			: maximum === g
				? (b - r) / delta + 2
				: (r - g) / delta + 4;
	return [((hue * 60 + 360) % 360) / 360, saturation, lightness];
}

function hslToRgb(hue: number, saturation: number, lightness: number): RgbColor {
	const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
	const segment = hue * 6;
	const intermediate = chroma * (1 - Math.abs((segment % 2) - 1));
	const [red, green, blue] =
		segment < 1
			? [chroma, intermediate, 0]
			: segment < 2
				? [intermediate, chroma, 0]
				: segment < 3
					? [0, chroma, intermediate]
					: segment < 4
						? [0, intermediate, chroma]
						: segment < 5
							? [intermediate, 0, chroma]
							: [chroma, 0, intermediate];
	const offset = lightness - chroma / 2;
	return [red, green, blue].map((channel) =>
		Math.round(clamp(channel + offset, 0, 1) * 255),
	) as RgbColor;
}

function lerp(start: number, end: number, amount: number) {
	return start + (end - start) * amount;
}

function clamp(value: number, minimum: number, maximum: number) {
	return Math.min(maximum, Math.max(minimum, value));
}
