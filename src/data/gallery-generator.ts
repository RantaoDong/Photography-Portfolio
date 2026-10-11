import { program } from 'commander';
import * as fs from 'node:fs';
import yaml from 'js-yaml';
import path from 'path';
import fg from 'fast-glob';
import {
	defaultBrowseDimensions,
	type GalleryData,
	loadGallery,
	NullGalleryData,
} from './galleryData.ts';
import { createGalleryPhoto } from './galleryEntityFactory.ts';

const galleryFileName = 'gallery.yaml';
const photosDirectoryName = 'photos';

async function generateGalleryFile(galleryDir: string): Promise<void> {
	try {
		const existingGallery = await loadExistingGallery(galleryDir);
		const discoveredGallery = await createGalleryFromPhotos(galleryDir);
		await writeGalleryYaml(galleryDir, mergeGalleries(existingGallery, discoveredGallery));
	} catch (error) {
		console.error('Failed to create gallery file:', error);
		process.exit(1);
	}
}

async function loadExistingGallery(galleryDir: string) {
	const existingGalleryFile = path.join(galleryDir, galleryFileName);
	if (fs.existsSync(existingGalleryFile)) return await loadGallery(existingGalleryFile);
	return NullGalleryData;
}

function mergeGalleries(target: GalleryData, source: GalleryData): GalleryData {
	const photosByFile = new Map(target.photos.map((photo) => [photo.file, photo]));
	for (const discoveredPhoto of source.photos) {
		const existingPhoto = photosByFile.get(discoveredPhoto.file);
		if (existingPhoto) {
			existingPhoto.technical = discoveredPhoto.technical;
		} else {
			photosByFile.set(discoveredPhoto.file, discoveredPhoto);
		}
	}

	return {
		browseDimensions:
			target.browseDimensions?.length > 0 ? target.browseDimensions : defaultBrowseDimensions,
		photos: Array.from(photosByFile.values()),
	};
}

async function createGalleryFromPhotos(galleryDir: string): Promise<GalleryData> {
	const photosDir = path.join(galleryDir, photosDirectoryName);
	if (!fs.existsSync(photosDir)) {
		throw new Error(`Photos directory not found: ${photosDir}`);
	}

	const imageFiles = await fg(`${photosDir.replaceAll('\\', '/')}/**/*.{jpg,jpeg,png,webp}`, {
		dot: false,
	});
	return {
		browseDimensions: defaultBrowseDimensions,
		photos: await Promise.all(imageFiles.map((file) => createGalleryPhoto(galleryDir, file))),
	};
}

async function writeGalleryYaml(galleryDir: string, gallery: GalleryData) {
	const filePath = path.join(galleryDir, galleryFileName);
	await fs.promises.writeFile(filePath, yaml.dump(gallery, { noRefs: true }), 'utf8');
	console.log('Gallery file created/updated successfully at:', filePath);
}

program.argument('<gallery directory>');
program.parse();

const directoryPath = program.args[0];
if (!directoryPath || !fs.existsSync(directoryPath)) {
	console.error('Invalid directory path provided.');
	process.exit(1);
}

(async () => {
	await generateGalleryFile(directoryPath);
})().catch((error) => {
	console.error('Unhandled error:', error);
	process.exit(1);
});
