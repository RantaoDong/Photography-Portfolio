import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { askYesNo } from './photo-import.ts';
import {
	checkConsistency,
	readGalleryFile,
	resolvePhotoPath,
} from './photo-library.ts';

const DEFAULT_MAX_EDGE = 2560;
const DEFAULT_QUALITY = 84;

interface OptimizationPlan {
	file: string;
	absolutePath: string;
	width: number;
	height: number;
	bytes: number;
}

interface OptimizationResult {
	beforeBytes: number;
	afterBytes: number;
	replaced: boolean;
}

async function main() {
	const { values } = parseArgs({
		options: {
			'max-edge': { type: 'string', default: String(DEFAULT_MAX_EDGE) },
			quality: { type: 'string', default: String(DEFAULT_QUALITY) },
			'dry-run': { type: 'boolean', default: false },
			yes: { type: 'boolean', short: 'y', default: false },
		},
	});
	const maxEdge = parseInteger(values['max-edge'], 'max-edge', 800, 8000);
	const quality = parseInteger(values.quality, 'quality', 40, 95);

	const gallery = await readGalleryFile();
	const consistency = await checkConsistency(gallery);
	if (
		consistency.missingFiles.length > 0 ||
		consistency.orphanFiles.length > 0 ||
		consistency.duplicateIds.length > 0 ||
		consistency.duplicateFiles.length > 0
	) {
		throw new Error('The photo library is not synchronized. Run npm run photo:check first.');
	}

	const plans: OptimizationPlan[] = [];
	let totalBytes = 0;
	let alreadySized = 0;
	for (const photo of gallery.photos) {
		const absolutePath = resolvePhotoPath(photo.file);
		const extension = path.extname(absolutePath).toLowerCase();
		if (extension !== '.jpg' && extension !== '.jpeg') continue;
		const [metadata, stat] = await Promise.all([
			sharp(absolutePath).metadata(),
			fs.stat(absolutePath),
		]);
		if (!metadata.width || !metadata.height)
			throw new Error(`Could not read image dimensions: ${photo.file}`);
		totalBytes += stat.size;
		if (Math.max(metadata.width, metadata.height) <= maxEdge) {
			alreadySized += 1;
			continue;
		}
		plans.push({
			file: photo.file,
			absolutePath,
			width: metadata.width,
			height: metadata.height,
			bytes: stat.size,
		});
	}

	const candidateBytes = plans.reduce((sum, plan) => sum + plan.bytes, 0);
	console.log('Photo optimization preview\n==========================');
	console.log(`JPEG photographs in library: ${gallery.photos.length}`);
	console.log(`Current JPEG size: ${formatBytes(totalBytes)}`);
	console.log(`Maximum long edge: ${maxEdge}px`);
	console.log(`JPEG quality: ${quality}`);
	console.log(`Already within size limit: ${alreadySized}`);
	console.log(`Files to optimize: ${plans.length} (${formatBytes(candidateBytes)})`);
	console.log('Filenames and gallery metadata entries will not change.');

	if (plans.length === 0) {
		console.log('\nNothing needs optimization.');
		return;
	}
	if (values['dry-run']) {
		console.log('\nDry run complete. Nothing was changed.');
		return;
	}

	if (!values.yes) {
		if (!process.stdin.isTTY || !process.stdout.isTTY)
			throw new Error('Interactive confirmation is required. Re-run in a terminal or pass --yes.');
		const prompt = createInterface({ input: process.stdin, output: process.stdout });
		try {
			const confirmed = await askYesNo(
				prompt,
				`Resize and replace ${plans.length} JPEG file(s)?`,
				false,
			);
			if (!confirmed) {
				console.log('Optimization cancelled. Nothing was changed.');
				return;
			}
		} finally {
			prompt.close();
		}
	}

	let beforeBytes = 0;
	let afterBytes = 0;
	let replaced = 0;
	for (const [index, plan] of plans.entries()) {
		const result = await optimizeJpegFile(plan.absolutePath, maxEdge, quality);
		beforeBytes += result.beforeBytes;
		afterBytes += result.afterBytes;
		if (result.replaced) replaced += 1;
		if ((index + 1) % 10 === 0 || index === plans.length - 1) {
			console.log(`Processed ${index + 1}/${plans.length}...`);
		}
	}

	console.log('\nOptimization complete\n=====================');
	console.log(`Files replaced: ${replaced}`);
	console.log(`Before: ${formatBytes(beforeBytes)}`);
	console.log(`After: ${formatBytes(afterBytes)}`);
	console.log(`Saved: ${formatBytes(Math.max(0, beforeBytes - afterBytes))}`);
}

export async function optimizeJpegFile(
	file: string,
	maxEdge = DEFAULT_MAX_EDGE,
	quality = DEFAULT_QUALITY,
): Promise<OptimizationResult> {
	const directory = path.dirname(file);
	const extension = path.extname(file);
	const stem = path.basename(file, extension);
	const temporary = path.join(directory, `.${stem}.optimize-${randomUUID()}${extension}`);
	const backup = path.join(directory, `.${stem}.backup-${randomUUID()}${extension}`);
	const before = await fs.stat(file);

	try {
		await sharp(file)
			.rotate()
			.resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
			.jpeg({ quality, progressive: true, chromaSubsampling: '4:2:0' })
			.keepMetadata()
			.toFile(temporary);

		const [outputMetadata, outputStat] = await Promise.all([
			sharp(temporary).metadata(),
			fs.stat(temporary),
		]);
		if (
			!outputMetadata.width ||
			!outputMetadata.height ||
			Math.max(outputMetadata.width, outputMetadata.height) > maxEdge
		) {
			throw new Error(`Optimized image failed dimension validation: ${file}`);
		}
		if (outputStat.size >= before.size) {
			await fs.rm(temporary, { force: true });
			return { beforeBytes: before.size, afterBytes: before.size, replaced: false };
		}

		await fs.rename(file, backup);
		try {
			await fs.rename(temporary, file);
			await fs.rm(backup, { force: true });
		} catch (error) {
			await fs.rm(file, { force: true });
			await fs.rename(backup, file);
			throw error;
		}
		return { beforeBytes: before.size, afterBytes: outputStat.size, replaced: true };
	} finally {
		await fs.rm(temporary, { force: true });
		if (await fileExists(backup)) {
			if (!(await fileExists(file))) await fs.rename(backup, file);
			else await fs.rm(backup, { force: true });
		}
	}
}

function parseInteger(value: string | undefined, name: string, minimum: number, maximum: number) {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum)
		throw new Error(`--${name} must be an integer between ${minimum} and ${maximum}.`);
	return parsed;
}

function formatBytes(bytes: number) {
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

async function fileExists(file: string) {
	try {
		await fs.access(file);
		return true;
	} catch {
		return false;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(`Optimization failed: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	});
}
