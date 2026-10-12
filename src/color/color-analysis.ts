import sharp from 'sharp';
import { labChroma, labHue, labToRgb, rgbToLab } from './color-conversion.ts';
import type {
	ColorAnalysisSettings,
	LabColor,
	PhotoColorFeatures,
	RgbColor,
	SpatialColorCell,
	WeightedColor,
} from './color-types.ts';

export const defaultColorAnalysisSettings: ColorAnalysisSettings = {
	sampleSize: 128,
	dominantColorClusters: 6,
	hueBinCount: 24,
	spatialGridSize: [4, 4],
	spatialColorsPerCell: 3,
	neutralChromaThreshold: 8,
	reliableHueMinimumLightness: 12,
	toneHueWindowBins: 5,
};

export async function analyzePhoto(
	file: string,
	settings: ColorAnalysisSettings = defaultColorAnalysisSettings,
): Promise<PhotoColorFeatures> {
	const { data, info } = await sharp(file)
		.rotate()
		.resize({
			width: settings.sampleSize,
			height: settings.sampleSize,
			fit: 'inside',
			withoutEnlargement: true,
		})
		.removeAlpha()
		.toColourspace('srgb')
		.raw()
		.toBuffer({ resolveWithObject: true });
	const pixels: RgbColor[] = [];
	for (let offset = 0; offset < data.length; offset += info.channels) {
		pixels.push([data[offset], data[offset + 1], data[offset + 2]]);
	}
	return analyzePixels(pixels, info.width, info.height, settings);
}

export function analyzePixels(
	pixels: RgbColor[],
	width: number,
	height: number,
	settings: ColorAnalysisSettings = defaultColorAnalysisSettings,
): PhotoColorFeatures {
	if (pixels.length !== width * height || pixels.length === 0) {
		throw new Error('Pixel data does not match the supplied image dimensions.');
	}
	validateSettings(settings);
	const labs = pixels.map(rgbToLab);
	const averageLab = meanLab(labs);
	let chromaTotal = 0;
	let neutralCount = 0;
	const hueHistogram = Array.from({ length: settings.hueBinCount }, () => 0);
	for (const lab of labs) {
		const chroma = labChroma(lab);
		chromaTotal += chroma;
		if (chroma < settings.neutralChromaThreshold || lab[0] < settings.reliableHueMinimumLightness)
			neutralCount += 1;
		else hueHistogram[Math.floor((labHue(lab) / 360) * settings.hueBinCount)] += 1;
	}
	const neutralProportion = neutralCount / labs.length;
	const saturation = Math.min(1, chromaTotal / labs.length / 100);
	const distribution = analyzeHueDistribution(hueHistogram, settings.toneHueWindowBins);
	return {
		averageLab: roundLab(averageLab),
		dominantColors: clusterColors(labs, settings.dominantColorClusters),
		brightness: round(averageLab[0] / 100, 4),
		saturation: round(saturation, 4),
		hueHistogram: hueHistogram.map((count) => round(count / labs.length, 4)),
		neutralProportion: round(neutralProportion, 4),
		colorDiversity: round(distribution.diversity, 4),
		paletteConcentration: round(distribution.concentration, 4),
		toneStrength: round(
			(1 - neutralProportion) * distribution.concentration * (1 - distribution.diversity),
			4,
		),
		neutralStrength: round(neutralProportion * (1 - saturation), 4),
		spatialCells: analyzeSpatialCells(labs, width, height, settings),
	};
}

function analyzeHueDistribution(histogram: number[], windowSize: number) {
	const total = histogram.reduce((sum, count) => sum + count, 0);
	if (total === 0) return { diversity: 0, concentration: 0 };
	const distribution = histogram.map((count) => count / total);
	const simpson =
		(1 - distribution.reduce((sum, proportion) => sum + proportion ** 2, 0)) /
		(1 - 1 / histogram.length);
	let concentration = 0;
	for (let start = 0; start < histogram.length; start += 1) {
		let windowTotal = 0;
		for (let offset = 0; offset < windowSize; offset += 1) {
			windowTotal += distribution[(start + offset) % histogram.length];
		}
		concentration = Math.max(concentration, windowTotal);
	}
	const maximumSpread = 1 - windowSize / histogram.length;
	const diversity = Math.min(1, Math.max(0, (simpson * (1 - concentration)) / maximumSpread));
	return { diversity, concentration };
}

function analyzeSpatialCells(
	labs: LabColor[],
	width: number,
	height: number,
	settings: ColorAnalysisSettings,
) {
	const [columns, rows] = settings.spatialGridSize;
	const cells: SpatialColorCell[] = [];
	for (let y = 0; y < rows; y += 1) {
		for (let x = 0; x < columns; x += 1) {
			const localPixels: LabColor[] = [];
			const left = Math.floor((x * width) / columns);
			const right = Math.floor(((x + 1) * width) / columns);
			const top = Math.floor((y * height) / rows);
			const bottom = Math.floor(((y + 1) * height) / rows);
			for (let pixelY = top; pixelY < bottom; pixelY += 1) {
				for (let pixelX = left; pixelX < right; pixelX += 1) {
					localPixels.push(labs[pixelY * width + pixelX]);
				}
			}
			cells.push({
				x,
				y,
				colors: clusterColors(localPixels, settings.spatialColorsPerCell),
			});
		}
	}
	return cells;
}

function clusterColors(labs: LabColor[], requestedClusters: number): WeightedColor[] {
	const clusterCount = Math.min(requestedClusters, labs.length);
	if (clusterCount === 0) return [];
	const centroids: LabColor[] = [meanLab(labs)];
	while (centroids.length < clusterCount) {
		let farthest = labs[0];
		let farthestDistance = -1;
		for (const lab of labs) {
			const distance = Math.min(...centroids.map((centroid) => squaredDistance(lab, centroid)));
			if (distance > farthestDistance) {
				farthestDistance = distance;
				farthest = lab;
			}
		}
		centroids.push([...farthest] as LabColor);
	}

	const assignments = new Uint8Array(labs.length);
	for (let iteration = 0; iteration < 12; iteration += 1) {
		const sums = Array.from({ length: clusterCount }, () => [0, 0, 0, 0]);
		let changed = false;
		for (let index = 0; index < labs.length; index += 1) {
			const lab = labs[index];
			let closest = 0;
			let closestDistance = squaredDistance(lab, centroids[0]);
			for (let cluster = 1; cluster < clusterCount; cluster += 1) {
				const distance = squaredDistance(lab, centroids[cluster]);
				if (distance < closestDistance) {
					closest = cluster;
					closestDistance = distance;
				}
			}
			if (assignments[index] !== closest) changed = true;
			assignments[index] = closest;
			const sum = sums[closest];
			sum[0] += lab[0];
			sum[1] += lab[1];
			sum[2] += lab[2];
			sum[3] += 1;
		}
		for (let cluster = 0; cluster < clusterCount; cluster += 1) {
			const sum = sums[cluster];
			if (sum[3] > 0) centroids[cluster] = [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]];
		}
		if (!changed && iteration > 0) break;
	}

	const counts = Array.from({ length: clusterCount }, () => 0);
	for (const assignment of assignments) counts[assignment] += 1;
	return centroids
		.map((lab, index) => ({
			lab: roundLab(lab),
			rgb: labToRgb(lab),
			proportion: round(counts[index] / labs.length, 4),
		}))
		.filter((color) => color.proportion > 0)
		.sort((a, b) => b.proportion - a.proportion);
}

function meanLab(labs: LabColor[]): LabColor {
	const total = labs.reduce(
		(sum, lab) => [sum[0] + lab[0], sum[1] + lab[1], sum[2] + lab[2]],
		[0, 0, 0],
	);
	return [total[0] / labs.length, total[1] / labs.length, total[2] / labs.length];
}

function squaredDistance(a: LabColor, b: LabColor) {
	return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

function roundLab(lab: LabColor): LabColor {
	return lab.map((value) => round(value, 2)) as LabColor;
}

function round(value: number, digits: number) {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

function validateSettings(settings: ColorAnalysisSettings) {
	const positiveIntegers = [
		settings.sampleSize,
		settings.dominantColorClusters,
		settings.hueBinCount,
		settings.spatialGridSize[0],
		settings.spatialGridSize[1],
		settings.spatialColorsPerCell,
		settings.toneHueWindowBins,
	];
	if (positiveIntegers.some((value) => !Number.isInteger(value) || value < 1)) {
		throw new Error('Color analysis sizes and counts must be positive integers.');
	}
	if (settings.toneHueWindowBins >= settings.hueBinCount) {
		throw new Error('The tone hue window must be smaller than the hue histogram.');
	}
	if (
		!Number.isFinite(settings.reliableHueMinimumLightness) ||
		settings.reliableHueMinimumLightness < 0 ||
		settings.reliableHueMinimumLightness >= 100
	) {
		throw new Error('The reliable hue minimum lightness must be between 0 and 100.');
	}
}
