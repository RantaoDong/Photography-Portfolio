import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyzePhoto, defaultColorAnalysisSettings } from '../src/color/color-analysis.ts';
import type { PhotoColorFeatureFile } from '../src/color/color-types.ts';
import { libraryPaths, readGallerySnapshot, resolvePhotoPath } from './photo-library.ts';

const schemaVersion = 1;
const analysisVersion = '1.2.0';
const outputFile = path.join(
	libraryPaths.repositoryRoot,
	'src',
	'generated',
	'photo-color-features.json',
);

export async function generateColorFeatures(destination = outputFile) {
	const { gallery } = await readGallerySnapshot();
	const missing: string[] = [];
	for (const photo of gallery.photos) {
		try {
			const stat = await fs.stat(resolvePhotoPath(photo.file));
			if (!stat.isFile()) missing.push(`${photo.id} (${photo.file})`);
		} catch {
			missing.push(`${photo.id} (${photo.file})`);
		}
	}
	if (missing.length > 0) {
		throw new Error(`Cannot analyze missing registered photographs:\n${missing.join('\n')}`);
	}

	console.log(`Analyzing ${gallery.photos.length} registered photographs...`);
	let completed = 0;
	const entries = await mapWithConcurrency(gallery.photos, 4, async (photo) => {
		const features = await analyzePhoto(resolvePhotoPath(photo.file));
		completed += 1;
		if (completed % 25 === 0 || completed === gallery.photos.length) {
			console.log(`Analyzed ${completed}/${gallery.photos.length}`);
		}
		return [photo.id, features] as const;
	});
	const generated: PhotoColorFeatureFile = {
		schemaVersion,
		analysisVersion,
		analysis: { ...defaultColorAnalysisSettings },
		photos: Object.fromEntries(entries),
	};
	await writeJsonAtomic(destination, generated);
	console.log(`Analyzed ${gallery.photos.length} photographs`);
	console.log(
		`Generated ${path.relative(libraryPaths.repositoryRoot, destination).replaceAll('\\', '/')}`,
	);
	return generated;
}

async function writeJsonAtomic(file: string, value: unknown) {
	await fs.mkdir(path.dirname(file), { recursive: true });
	const temporaryFile = `${file}.tmp-${randomUUID()}`;
	try {
		await fs.writeFile(temporaryFile, `${JSON.stringify(value)}\n`, {
			encoding: 'utf8',
			flag: 'wx',
		});
		await fs.rename(temporaryFile, file);
	} finally {
		await fs.rm(temporaryFile, { force: true });
	}
}

async function mapWithConcurrency<T, R>(
	values: T[],
	concurrency: number,
	work: (value: T, index: number) => Promise<R>,
) {
	const results = new Array<R>(values.length);
	let nextIndex = 0;
	await Promise.all(
		Array.from({ length: Math.min(concurrency, values.length) }, async () => {
			while (nextIndex < values.length) {
				const index = nextIndex;
				nextIndex += 1;
				results[index] = await work(values[index], index);
			}
		}),
	);
	return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	generateColorFeatures().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
