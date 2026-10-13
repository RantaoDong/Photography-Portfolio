import { performance } from 'node:perf_hooks';
import sharp from 'sharp';
import { rgbToLab } from '../src/color/color-conversion.ts';
import { colorWalkConfig, colorWalkRenderingDefaults } from '../src/color/color-walk-config.ts';
import { colorWalkPerceptualDistance } from '../src/color/color-walk-matching.ts';
import {
	computeColorWalkMasks,
	type PreparedColorWalkImage,
} from '../src/color/color-walk-rendering.ts';
import type { RgbColor } from '../src/color/color-types.ts';
import { readGallerySnapshot, resolvePhotoPath } from './photo-library.ts';

const sampleColor: RgbColor = [66, 145, 92];
const iterations = 7;

async function main() {
	const { gallery } = await readGallerySnapshot();
	const samples: Array<{ kind: 'portrait' | 'landscape'; id: string; file: string }> = [];
	for (const photo of gallery.photos) {
		const file = resolvePhotoPath(photo.file);
		const metadata = await sharp(file).metadata();
		const swapsAxes = [5, 6, 7, 8].includes(metadata.orientation || 1);
		const width = (swapsAxes ? metadata.height : metadata.width) || 0;
		const height = (swapsAxes ? metadata.width : metadata.height) || 0;
		const kind = height > width ? 'portrait' : width > height ? 'landscape' : null;
		if (kind && !samples.some((sample) => sample.kind === kind)) {
			samples.push({ kind, id: photo.id, file });
		}
		if (samples.length === 2) break;
	}

	console.log('Color Walk edge-aware benchmark');
	console.log(
		`display max ${colorWalkConfig.rendering.maxProcessingDimension}px; mask max ${colorWalkConfig.rendering.maxRefinementDimension}px; ${iterations} iterations`,
	);
	for (const sample of samples) await benchmarkSample(sample);
}

async function benchmarkSample(sample: { kind: string; id: string; file: string }) {
	const { data, info } = await sharp(sample.file)
		.rotate()
		.resize({
			width: colorWalkConfig.rendering.maxProcessingDimension,
			height: colorWalkConfig.rendering.maxProcessingDimension,
			fit: 'inside',
			withoutEnlargement: true,
		})
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const distances = new Float32Array(info.width * info.height);
	const selectedLab = rgbToLab(sampleColor);
	const preparationStarted = performance.now();
	for (let offset = 0, pixelIndex = 0; offset < data.length; offset += 4, pixelIndex += 1) {
		distances[pixelIndex] = colorWalkPerceptualDistance(
			selectedLab,
			rgbToLab([data[offset], data[offset + 1], data[offset + 2]]),
		);
	}
	const preparationDuration = performance.now() - preparationStarted;
	const prepared: PreparedColorWalkImage = {
		width: info.width,
		height: info.height,
		pixels: new Uint8ClampedArray(data),
		distances,
	};
	const parameters = { ...colorWalkRenderingDefaults, refinementMode: 'edge-aware' as const };
	const coldStarted = performance.now();
	const coldMasks = computeColorWalkMasks(prepared, parameters);
	const coldDuration = performance.now() - coldStarted;
	const times: number[] = [];
	const refinementSize = `${coldMasks.refinementWidth}×${coldMasks.refinementHeight}`;
	for (let iteration = 0; iteration < iterations; iteration += 1) {
		const started = performance.now();
		computeColorWalkMasks(prepared, parameters);
		times.push(performance.now() - started);
	}
	console.log(
		`${sample.kind.padEnd(9)} ${sample.id} ${info.width}×${info.height}: Lab ${preparationDuration.toFixed(1)}ms; mask cold ${coldDuration.toFixed(1)}ms; cached ${median(times).toFixed(1)}ms median (${refinementSize})`,
	);
}

function median(values: number[]) {
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.floor(sorted.length / 2)];
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
