import {
	colorPathTransitionDefaults,
	type ColorPathTransitionParameters,
} from './color-path-transition-config.ts';
import type { RgbColor } from './color-types.ts';

export type ColorPathTransitionDirection = 'forward' | 'reverse';

export interface ColorPathImageBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface ColorPathTransitionFrame {
	currentSharp: number;
	currentBlurred: number;
	nextBlurred: number;
	nextSharp: number;
	biasColor: RgbColor;
	biasStrength: number;
	grainStrength: number;
	geometryProgress: number;
}

export interface ColorPathTransitionInput {
	canvas: HTMLCanvasElement;
	currentImage: HTMLImageElement;
	nextImage: HTMLImageElement;
	currentColor: RgbColor;
	nextColor: RgbColor;
	currentBounds?: ColorPathImageBounds;
	nextBounds?: ColorPathImageBounds;
	direction?: ColorPathTransitionDirection;
	parameters?: Partial<ColorPathTransitionParameters>;
}

export interface ColorPathTransitionRenderer {
	render(
		progress: number,
		parameters?: Partial<ColorPathTransitionParameters>,
		direction?: ColorPathTransitionDirection,
	): void;
}

interface PreparedPhoto {
	image: HTMLImageElement;
	sharp: HTMLCanvasElement;
	bounds: ColorPathImageBounds;
}

export class ColorPathImagePreloader {
	private readonly cache = new Map<string, Promise<HTMLImageElement>>();

	load(src: string) {
		const cached = this.cache.get(src);
		if (cached) return cached;
		const request = loadImage(src);
		this.cache.set(src, request);
		request.catch(() => this.cache.delete(src));
		return request;
	}

	clear() {
		this.cache.clear();
	}
}

export function createColorPathTransitionRenderer(
	input: Omit<ColorPathTransitionInput, 'parameters' | 'direction'>,
): ColorPathTransitionRenderer | null {
	const { canvas, currentImage, nextImage, currentColor, nextColor } = input;
	const bounds = canvas.parentElement?.getBoundingClientRect() ?? canvas.getBoundingClientRect();
	if (bounds.width <= 0 || bounds.height <= 0) return null;
	const renderScale = Math.min(
		window.devicePixelRatio || 1,
		colorPathTransitionDefaults.maximumRenderDimension / Math.max(bounds.width, bounds.height),
	);
	canvas.width = Math.max(1, Math.round(bounds.width * renderScale));
	canvas.height = Math.max(1, Math.round(bounds.height * renderScale));
	const context = canvas.getContext('2d');
	if (!context) return null;

	const current = preparePhoto(currentImage, canvas.width, canvas.height, input.currentBounds);
	const next = preparePhoto(nextImage, canvas.width, canvas.height, input.nextBounds);
	const blurredCache = new Map<string, HTMLCanvasElement>();
	const grainCache = new Map<string, HTMLCanvasElement>();
	const transitionSurface = createCanvas(canvas.width, canvas.height);
	const transitionContext = transitionSurface.getContext('2d');
	const background = resolveStageBackground(canvas);
	if (!transitionContext) return null;

	return {
		render(progress, overrides, direction = 'forward') {
			const parameters = resolveColorPathTransitionParameters(overrides);
			const source = direction === 'forward' ? current : next;
			const target = direction === 'forward' ? next : current;
			const sourceColor = direction === 'forward' ? currentColor : nextColor;
			const targetColor = direction === 'forward' ? nextColor : currentColor;
			const frame = getColorPathTransitionFrame(progress, sourceColor, targetColor, parameters);
			const activeBounds = interpolateBounds(source.bounds, target.bounds, frame.geometryProgress);
			const blurRadius = Math.max(0, parameters.maximumBlurRadius * renderScale);
			const sourceBlurred = getBlurredSurface(
				blurredCache,
				direction === 'forward' ? 'current' : 'next',
				source.sharp,
				blurRadius,
			);
			const targetBlurred = getBlurredSurface(
				blurredCache,
				direction === 'forward' ? 'next' : 'current',
				target.sharp,
				blurRadius,
			);

			context.clearRect(0, 0, canvas.width, canvas.height);
			context.fillStyle = background;
			context.fillRect(0, 0, canvas.width, canvas.height);
			drawWeighted(context, source.sharp, frame.currentSharp);

			transitionContext.clearRect(0, 0, canvas.width, canvas.height);
			drawTransformedSurface(
				transitionContext,
				sourceBlurred,
				source.bounds,
				activeBounds,
				frame.currentBlurred,
			);
			drawTransformedSurface(
				transitionContext,
				targetBlurred,
				target.bounds,
				activeBounds,
				frame.nextBlurred,
			);
			if (frame.biasStrength > 0) {
				transitionContext.save();
				transitionContext.globalCompositeOperation = 'source-atop';
				transitionContext.globalAlpha = frame.biasStrength;
				transitionContext.fillStyle = `rgb(${frame.biasColor.join(' ')})`;
				transitionContext.fillRect(0, 0, canvas.width, canvas.height);
				transitionContext.restore();
			}
			if (frame.grainStrength > 0) {
				const grain = getGrainSurface(
					grainCache,
					canvas.width,
					canvas.height,
					parameters.grainScale * renderScale,
				);
				transitionContext.save();
				transitionContext.globalCompositeOperation = 'soft-light';
				transitionContext.globalAlpha = frame.grainStrength;
				transitionContext.imageSmoothingEnabled = false;
				transitionContext.drawImage(grain, 0, 0, canvas.width, canvas.height);
				transitionContext.restore();
			}
			if (frame.currentBlurred + frame.nextBlurred > 0) {
				applyOrganicMask(transitionContext, activeBounds, frame.geometryProgress, parameters);
			}
			drawWeighted(context, transitionSurface, 1);
			drawWeighted(context, target.sharp, frame.nextSharp);
		},
	};
}

export async function runColorPathTransition(input: ColorPathTransitionInput) {
	const parameters = resolveColorPathTransitionParameters(input.parameters);
	const renderer = createColorPathTransitionRenderer(input);
	if (!renderer) return;
	const direction = input.direction ?? 'forward';
	renderer.render(0, parameters, direction);
	input.canvas.hidden = false;
	const startedAt = performance.now();
	await new Promise<void>((resolve) => {
		const animate = (now: number) => {
			const progress = clamp((now - startedAt) / parameters.totalDurationMs, 0, 1);
			renderer.render(progress, parameters, direction);
			if (progress < 1) requestAnimationFrame(animate);
			else resolve();
		};
		requestAnimationFrame(animate);
	});
}

export function finishColorPathTransition(canvas: HTMLCanvasElement) {
	canvas.hidden = true;
	const context = canvas.getContext('2d');
	context?.clearRect(0, 0, canvas.width, canvas.height);
}

export function getColorPathTransitionFrame(
	progress: number,
	currentColor: RgbColor,
	nextColor: RgbColor,
	parameters: ColorPathTransitionParameters = colorPathTransitionDefaults,
): ColorPathTransitionFrame {
	const value = clamp(progress, 0, 1);
	const {
		colorBiasStrength,
		grainAmount,
		middleInterpolationStart,
		middleInterpolationEnd,
		sharpeningStart,
	} = parameters;
	const geometryProgress = ease(value);
	if (value <= middleInterpolationStart) {
		const phase = ease(value / middleInterpolationStart);
		return {
			currentSharp: 1 - phase,
			currentBlurred: phase,
			nextBlurred: 0,
			nextSharp: 0,
			biasColor: currentColor,
			biasStrength: colorBiasStrength * phase,
			grainStrength: grainAmount * phase,
			geometryProgress,
		};
	}
	if (value <= middleInterpolationEnd) {
		const phase = ease(
			(value - middleInterpolationStart) / (middleInterpolationEnd - middleInterpolationStart),
		);
		return {
			currentSharp: 0,
			currentBlurred: 1 - phase,
			nextBlurred: phase,
			nextSharp: 0,
			biasColor: interpolateRgb(currentColor, nextColor, phase),
			biasStrength: colorBiasStrength,
			grainStrength: grainAmount,
			geometryProgress,
		};
	}
	if (value < sharpeningStart) {
		return {
			currentSharp: 0,
			currentBlurred: 0,
			nextBlurred: 1,
			nextSharp: 0,
			biasColor: nextColor,
			biasStrength: colorBiasStrength,
			grainStrength: grainAmount,
			geometryProgress,
		};
	}
	const phase = ease((value - sharpeningStart) / (1 - sharpeningStart));
	return {
		currentSharp: 0,
		currentBlurred: 0,
		nextBlurred: 1 - phase,
		nextSharp: phase,
		biasColor: nextColor,
		biasStrength: colorBiasStrength * (1 - phase),
		grainStrength: grainAmount * (1 - phase),
		geometryProgress,
	};
}

export function resolveColorPathTransitionParameters(
	overrides?: Partial<ColorPathTransitionParameters>,
): ColorPathTransitionParameters {
	return { ...colorPathTransitionDefaults, ...overrides };
}

export function getContainedImageBounds(
	imageWidth: number,
	imageHeight: number,
	stageWidth: number,
	stageHeight: number,
): ColorPathImageBounds {
	const scale = Math.min(stageWidth / imageWidth, stageHeight / imageHeight);
	const width = imageWidth * scale;
	const height = imageHeight * scale;
	return {
		x: (stageWidth - width) / 2,
		y: (stageHeight - height) / 2,
		width,
		height,
	};
}

function preparePhoto(
	image: HTMLImageElement,
	width: number,
	height: number,
	providedBounds?: ColorPathImageBounds,
): PreparedPhoto {
	const imageBounds =
		providedBounds ??
		getContainedImageBounds(image.naturalWidth, image.naturalHeight, width, height);
	const sharp = createCanvas(width, height);
	const context = sharp.getContext('2d');
	context?.drawImage(image, imageBounds.x, imageBounds.y, imageBounds.width, imageBounds.height);
	return { image, sharp, bounds: imageBounds };
}

function getBlurredSurface(
	cache: Map<string, HTMLCanvasElement>,
	key: string,
	source: HTMLCanvasElement,
	radius: number,
) {
	const cacheKey = `${key}:${Math.round(radius * 10)}`;
	const cached = cache.get(cacheKey);
	if (cached) return cached;
	const surface = createCanvas(source.width, source.height);
	const context = surface.getContext('2d');
	if (context) {
		context.filter = `blur(${radius}px)`;
		context.drawImage(source, 0, 0);
		context.filter = 'none';
	}
	cache.set(cacheKey, surface);
	return surface;
}

function drawTransformedSurface(
	context: CanvasRenderingContext2D,
	surface: HTMLCanvasElement,
	sourceBounds: ColorPathImageBounds,
	targetBounds: ColorPathImageBounds,
	weight: number,
) {
	if (weight <= 0 || sourceBounds.width <= 0 || sourceBounds.height <= 0) return;
	context.save();
	context.globalCompositeOperation = 'lighter';
	context.globalAlpha = weight;
	context.translate(targetBounds.x, targetBounds.y);
	context.scale(targetBounds.width / sourceBounds.width, targetBounds.height / sourceBounds.height);
	context.translate(-sourceBounds.x, -sourceBounds.y);
	context.drawImage(surface, 0, 0);
	context.restore();
}

function applyOrganicMask(
	context: CanvasRenderingContext2D,
	bounds: ColorPathImageBounds,
	progress: number,
	parameters: ColorPathTransitionParameters,
) {
	const reduction = Math.max(
		1,
		Math.ceil(Math.max(context.canvas.width, context.canvas.height) / 360),
	);
	const width = Math.max(1, Math.ceil(context.canvas.width / reduction));
	const height = Math.max(1, Math.ceil(context.canvas.height / reduction));
	const mask = createCanvas(width, height);
	const maskContext = mask.getContext('2d');
	if (!maskContext) return;
	const pixels = maskContext.createImageData(width, height);
	const scaledBounds = {
		x: bounds.x / reduction,
		y: bounds.y / reduction,
		width: bounds.width / reduction,
		height: bounds.height / reduction,
	};
	const minimumDimension = Math.max(1, Math.min(scaledBounds.width, scaledBounds.height));
	const softness = Math.max(1, parameters.spreadSoftness * minimumDimension);
	const irregularity = parameters.spreadIrregularity * minimumDimension * 0.18;
	const radius = minimumDimension * 0.1;

	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const distance = roundedBoxDistance(x + 0.5, y + 0.5, scaledBounds, radius);
			const noise = organicNoise(x, y, progress);
			const alpha = 1 - smoothstep(-softness, softness, distance + noise * irregularity);
			const offset = (y * width + x) * 4;
			pixels.data[offset] = 255;
			pixels.data[offset + 1] = 255;
			pixels.data[offset + 2] = 255;
			pixels.data[offset + 3] = Math.round(alpha * 255);
		}
	}
	maskContext.putImageData(pixels, 0, 0);
	context.save();
	context.globalCompositeOperation = 'destination-in';
	context.imageSmoothingEnabled = true;
	context.drawImage(mask, 0, 0, context.canvas.width, context.canvas.height);
	context.restore();
}

function roundedBoxDistance(x: number, y: number, bounds: ColorPathImageBounds, radius: number) {
	const centerX = bounds.x + bounds.width / 2;
	const centerY = bounds.y + bounds.height / 2;
	const halfWidth = Math.max(radius, bounds.width / 2) - radius;
	const halfHeight = Math.max(radius, bounds.height / 2) - radius;
	const distanceX = Math.abs(x - centerX) - halfWidth;
	const distanceY = Math.abs(y - centerY) - halfHeight;
	const outside = Math.hypot(Math.max(distanceX, 0), Math.max(distanceY, 0));
	const inside = Math.min(Math.max(distanceX, distanceY), 0);
	return outside + inside - radius;
}

function organicNoise(x: number, y: number, progress: number) {
	const drift = progress * Math.PI * 1.7;
	return (
		Math.sin(x * 0.082 + Math.sin(y * 0.031 + drift) * 2.1 + drift) * 0.5 +
		Math.sin(y * 0.057 - Math.cos(x * 0.027 - drift) * 1.8 - drift * 0.7) * 0.3 +
		Math.sin((x + y) * 0.023 + drift * 0.45) * 0.2
	);
}

function getGrainSurface(
	cache: Map<string, HTMLCanvasElement>,
	width: number,
	height: number,
	scale: number,
) {
	const blockSize = Math.max(1, Math.round(scale));
	const cacheKey = String(blockSize);
	const cached = cache.get(cacheKey);
	if (cached) return cached;
	const grain = createCanvas(
		Math.max(1, Math.ceil(width / blockSize)),
		Math.max(1, Math.ceil(height / blockSize)),
	);
	const context = grain.getContext('2d');
	if (context) {
		const pixels = context.createImageData(grain.width, grain.height);
		let seed = 0x2f6e2b1;
		for (let index = 0; index < pixels.data.length; index += 4) {
			seed = (seed * 1664525 + 1013904223) >>> 0;
			const value = 52 + ((seed >>> 24) % 152);
			pixels.data[index] = value;
			pixels.data[index + 1] = value;
			pixels.data[index + 2] = value;
			pixels.data[index + 3] = 255;
		}
		context.putImageData(pixels, 0, 0);
	}
	cache.set(cacheKey, grain);
	return grain;
}

function drawWeighted(
	context: CanvasRenderingContext2D,
	surface: HTMLCanvasElement,
	weight: number,
) {
	if (weight <= 0) return;
	context.save();
	context.globalCompositeOperation = 'source-over';
	context.globalAlpha = weight;
	context.drawImage(surface, 0, 0);
	context.restore();
}

function resolveStageBackground(canvas: HTMLCanvasElement) {
	let element: Element | null = canvas.parentElement;
	while (element) {
		const color = getComputedStyle(element).backgroundColor;
		if (color && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return color;
		element = element.parentElement;
	}
	return 'white';
}

function interpolateBounds(
	first: ColorPathImageBounds,
	second: ColorPathImageBounds,
	progress: number,
): ColorPathImageBounds {
	return {
		x: lerp(first.x, second.x, progress),
		y: lerp(first.y, second.y, progress),
		width: lerp(first.width, second.width, progress),
		height: lerp(first.height, second.height, progress),
	};
}

function loadImage(src: string) {
	return new Promise<HTMLImageElement>((resolve, reject) => {
		const image = new Image();
		image.decoding = 'async';
		image.addEventListener(
			'load',
			() => {
				if (typeof image.decode === 'function') {
					void image
						.decode()
						.catch(() => undefined)
						.finally(() => resolve(image));
				} else resolve(image);
			},
			{ once: true },
		);
		image.addEventListener('error', () => reject(new Error('Image failed to load.')), {
			once: true,
		});
		image.src = src;
	});
}

function createCanvas(width: number, height: number) {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	return canvas;
}

function interpolateRgb(first: RgbColor, second: RgbColor, progress: number): RgbColor {
	const stableProgress = Math.round(clamp(progress, 0, 1) * 1_000_000) / 1_000_000;
	return first.map((channel, index) =>
		Math.round(channel + (second[index] - channel) * stableProgress),
	) as RgbColor;
}

function ease(value: number) {
	const progress = clamp(value, 0, 1);
	return progress * progress * (3 - 2 * progress);
}

function smoothstep(edge0: number, edge1: number, value: number) {
	const progress = clamp((value - edge0) / (edge1 - edge0), 0, 1);
	return progress * progress * (3 - 2 * progress);
}

function lerp(start: number, end: number, progress: number) {
	return start + (end - start) * progress;
}

function clamp(value: number, minimum: number, maximum: number) {
	return Math.min(maximum, Math.max(minimum, value));
}
