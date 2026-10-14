import type { RgbColor } from './color-types.ts';
import { normalizeHue } from './color-wheel.ts';

export interface ColorPathPoint {
	x: number;
	y: number;
}

export interface ColorPathSample {
	position: number;
	point: ColorPathPoint;
	rgb: RgbColor;
}

export function clampToColorDisk(point: ColorPathPoint): ColorPathPoint {
	const radius = Math.hypot(point.x, point.y);
	if (radius <= 1) return point;
	return { x: point.x / radius, y: point.y / radius };
}

export function colorPathPointToRgb(point: ColorPathPoint): RgbColor {
	const bounded = clampToColorDisk(point);
	const saturation = Math.min(1, Math.hypot(bounded.x, bounded.y));
	const hue = normalizeHue((Math.atan2(bounded.y, bounded.x) * 180) / Math.PI + 90);
	return hslToRgb(hue, saturation, 0.5);
}

export function getColorPathLength(points: ColorPathPoint[]) {
	let length = 0;
	for (let index = 1; index < points.length; index += 1) {
		length += pointDistance(points[index - 1], points[index]);
	}
	return length;
}

export function interpolateColorPath(points: ColorPathPoint[], position: number): ColorPathPoint {
	if (points.length === 0) return { x: 0, y: 0 };
	if (points.length === 1) return points[0];
	const segmentLengths = points.slice(1).map((point, index) => pointDistance(points[index], point));
	const totalLength = segmentLengths.reduce((sum, length) => sum + length, 0);
	if (totalLength === 0) return points[0];
	let remaining = clamp(position, 0, 1) * totalLength;
	for (let index = 0; index < segmentLengths.length; index += 1) {
		const segmentLength = segmentLengths[index];
		if (remaining <= segmentLength || index === segmentLengths.length - 1) {
			const progress = segmentLength === 0 ? 0 : remaining / segmentLength;
			return {
				x: lerp(points[index].x, points[index + 1].x, progress),
				y: lerp(points[index].y, points[index + 1].y, progress),
			};
		}
		remaining -= segmentLength;
	}
	return points.at(-1)!;
}

export function sampleColorPath(points: ColorPathPoint[], sampleCount: number): ColorPathSample[] {
	const count = Math.max(2, Math.round(sampleCount));
	return Array.from({ length: count }, (_, index) => {
		const position = index / (count - 1);
		const point = interpolateColorPath(points, position);
		return { position, point, rgb: colorPathPointToRgb(point) };
	});
}

function hslToRgb(hue: number, saturation: number, lightness: number): RgbColor {
	const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
	const segment = hue / 60;
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
	return [red, green, blue].map((channel) => Math.round((channel + offset) * 255)) as RgbColor;
}

function pointDistance(first: ColorPathPoint, second: ColorPathPoint) {
	return Math.hypot(first.x - second.x, first.y - second.y);
}

function lerp(start: number, end: number, progress: number) {
	return start + (end - start) * progress;
}

function clamp(value: number, minimum: number, maximum: number) {
	return Math.min(maximum, Math.max(minimum, value));
}
