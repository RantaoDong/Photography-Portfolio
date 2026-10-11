import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import type { GalleryData, GalleryPhoto } from '../src/data/galleryData.ts';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const libraryPaths = {
	repositoryRoot,
	incomingDirectory: path.join(repositoryRoot, 'incoming'),
	galleryDirectory: path.join(repositoryRoot, 'src', 'gallery'),
	photosDirectory: path.join(repositoryRoot, 'src', 'gallery', 'photos'),
	metadataFile: path.join(repositoryRoot, 'src', 'gallery', 'gallery.yaml'),
};

const supportedExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif']);
const importExtensions = new Set(['.jpg', '.jpeg']);

export interface ConsistencyReport {
	missingFiles: GalleryPhoto[];
	orphanFiles: string[];
}

export interface ImportPlan {
	source: string;
	id: string;
	fileName: string;
	photo: GalleryPhoto;
}

export async function readGalleryFile(metadataFile = libraryPaths.metadataFile) {
	const content = await fs.readFile(metadataFile, 'utf8');
	const gallery = yaml.load(content) as GalleryData;
	validateGallery(gallery);
	return gallery;
}

export async function writeGalleryFileAtomic(
	gallery: GalleryData,
	metadataFile = libraryPaths.metadataFile,
) {
	validateGallery(gallery);
	const temporaryFile = `${metadataFile}.tmp-${randomUUID()}`;
	const content = yaml.dump(gallery, { noRefs: true, lineWidth: -1 });

	try {
		await fs.writeFile(temporaryFile, content, { encoding: 'utf8', flag: 'wx' });
		await fs.rename(temporaryFile, metadataFile);
	} finally {
		await fs.rm(temporaryFile, { force: true });
	}
}

export async function findIncomingPhotos(directory = libraryPaths.incomingDirectory) {
	await fs.mkdir(directory, { recursive: true });
	const entries = await fs.readdir(directory, { withFileTypes: true });
	return entries
		.filter(
			(entry) => entry.isFile() && importExtensions.has(path.extname(entry.name).toLowerCase()),
		)
		.map((entry) => path.join(directory, entry.name))
		.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

export async function checkConsistency(
	gallery: GalleryData,
	photosDirectory = libraryPaths.photosDirectory,
): Promise<ConsistencyReport> {
	const metadataFiles = new Set(gallery.photos.map((photo) => normalizeMetadataPath(photo.file)));
	const missingFiles: GalleryPhoto[] = [];

	for (const photo of gallery.photos) {
		const photoPath = resolvePhotoPath(photo.file, photosDirectory);
		try {
			const stat = await fs.stat(photoPath);
			if (!stat.isFile()) missingFiles.push(photo);
		} catch (error) {
			if (isMissingFileError(error)) missingFiles.push(photo);
			else throw error;
		}
	}

	const diskFiles = await listPhotoFiles(photosDirectory);
	const orphanFiles = diskFiles
		.map((file) => toMetadataPath(file, photosDirectory))
		.filter((file) => !metadataFiles.has(file));

	return { missingFiles, orphanFiles };
}

export function nextPhotoNumber(gallery: GalleryData, diskFiles: string[] = []) {
	const candidates = [
		...gallery.photos.map((photo) => photo.id),
		...gallery.photos.map((photo) => path.basename(photo.file, path.extname(photo.file))),
		...diskFiles.map((file) => path.basename(file, path.extname(file))),
	];
	let highest = 0;
	for (const candidate of candidates) {
		const match = /^photo-(\d+)$/.exec(candidate);
		if (match) highest = Math.max(highest, Number(match[1]));
	}
	return highest + 1;
}

export async function commitImport(
	plans: ImportPlan[],
	gallery: GalleryData,
	paths = libraryPaths,
) {
	if (plans.length === 0) return;
	await validateImportPlans(plans, gallery, paths.photosDirectory);
	await fs.mkdir(paths.photosDirectory, { recursive: true });
	const stagingDirectory = path.join(paths.galleryDirectory, `.photo-import-${randomUUID()}`);
	await fs.mkdir(stagingDirectory, { recursive: false });
	const stagedFiles: Array<{ source: string; staged: string; destination: string }> = [];
	let metadataCommitted = false;

	try {
		for (const plan of plans) {
			const staged = path.join(stagingDirectory, plan.fileName);
			const destination = path.join(paths.photosDirectory, plan.fileName);
			await fs.copyFile(plan.source, staged, constants.COPYFILE_EXCL);
			stagedFiles.push({ source: plan.source, staged, destination });
		}
		for (const item of stagedFiles)
			await fs.copyFile(item.staged, item.destination, constants.COPYFILE_EXCL);

		await writeGalleryFileAtomic(
			{ ...gallery, photos: [...gallery.photos, ...plans.map((plan) => plan.photo)] },
			paths.metadataFile,
		);
		metadataCommitted = true;
		for (const item of stagedFiles) await fs.rm(item.source);
	} catch (error) {
		if (metadataCommitted) await writeGalleryFileAtomic(gallery, paths.metadataFile);
		for (const item of [...stagedFiles].reverse()) {
			if (!(await fileExists(item.source)) && (await fileExists(item.staged)))
				await fs.copyFile(item.staged, item.source, constants.COPYFILE_EXCL);
			await fs.rm(item.destination, { force: true });
		}
		await fs.rm(stagingDirectory, { recursive: true, force: true });
		throw error;
	}
	await fs.rm(stagingDirectory, { recursive: true, force: true });
}

export async function commitRemoval(
	photos: GalleryPhoto[],
	gallery: GalleryData,
	paths = libraryPaths,
) {
	if (photos.length === 0) return;
	const selectedIds = new Set(photos.map((photo) => photo.id));
	const stagingDirectory = path.join(paths.galleryDirectory, `.photo-remove-${randomUUID()}`);
	await fs.mkdir(stagingDirectory, { recursive: false });
	const stagedFiles: Array<{ original: string; staged: string }> = [];
	let metadataCommitted = false;

	try {
		for (const photo of photos) {
			const original = resolvePhotoPath(photo.file, paths.photosDirectory);
			if (!(await fileExists(original)))
				throw new Error(`Image file does not exist: ${photo.file}`);
			const staged = path.join(stagingDirectory, `${photo.id}${path.extname(original)}`);
			await fs.copyFile(original, staged, constants.COPYFILE_EXCL);
			stagedFiles.push({ original, staged });
		}

		await writeGalleryFileAtomic(
			{ ...gallery, photos: gallery.photos.filter((photo) => !selectedIds.has(photo.id)) },
			paths.metadataFile,
		);
		metadataCommitted = true;
		for (const item of stagedFiles) await fs.rm(item.original);
	} catch (error) {
		if (metadataCommitted) await writeGalleryFileAtomic(gallery, paths.metadataFile);
		for (const item of [...stagedFiles].reverse()) {
			if (!(await fileExists(item.original)) && (await fileExists(item.staged)))
				await fs.copyFile(item.staged, item.original, constants.COPYFILE_EXCL);
		}
		await fs.rm(stagingDirectory, { recursive: true, force: true });
		throw error;
	}

	await fs.rm(stagingDirectory, { recursive: true, force: true });
}

export function formatPhoto(photo: GalleryPhoto) {
	const values = [
		photo.taxonomy.year.join(', ') || 'No year',
		photo.taxonomy.place.join(', ') || 'No place',
		photo.taxonomy.subject.join(', ') || 'No subject',
	];
	const visible = (['year', 'place', 'subject'] as const)
		.filter((dimension) => photo.browse[dimension])
		.map((dimension) => dimension[0].toUpperCase() + dimension.slice(1));
	return [
		values.join(' | '),
		`Visible in: ${visible.join(', ') || 'Nowhere'}`,
		photo.series ? `Series: ${photo.series}` : undefined,
		photo.featured ? 'Featured: yes' : undefined,
	]
		.filter(Boolean)
		.join('\n');
}

export function isSupportedPhoto(file: string) {
	return supportedExtensions.has(path.extname(file).toLowerCase());
}

export async function listPhotoFiles(directory = libraryPaths.photosDirectory): Promise<string[]> {
	try {
		const entries = await fs.readdir(directory, { withFileTypes: true });
		const files = await Promise.all(
			entries.map(async (entry) => {
				const item = path.join(directory, entry.name);
				if (entry.isDirectory()) return listPhotoFiles(item);
				return entry.isFile() && isSupportedPhoto(entry.name) ? [item] : [];
			}),
		);
		return files.flat().sort();
	} catch (error) {
		if (isMissingFileError(error)) return [];
		throw error;
	}
}

function validateGallery(gallery: GalleryData) {
	if (!gallery || !Array.isArray(gallery.browseDimensions) || !Array.isArray(gallery.photos))
		throw new Error('gallery.yaml must contain browseDimensions and photos arrays.');
	const ids = new Set<string>();
	const files = new Set<string>();
	for (const photo of gallery.photos) {
		if (!photo.id || ids.has(photo.id))
			throw new Error(`Duplicate or missing photo ID: ${photo.id}`);
		const file = normalizeMetadataPath(photo.file);
		if (!file || files.has(file)) throw new Error(`Duplicate or missing photo file: ${photo.file}`);
		resolvePhotoPath(file, libraryPaths.photosDirectory);
		for (const dimension of ['year', 'place', 'subject'] as const) {
			if (!Array.isArray(photo.taxonomy?.[dimension]))
				throw new Error(`${photo.id} is missing taxonomy.${dimension}.`);
			if (typeof photo.browse?.[dimension] !== 'boolean')
				throw new Error(`${photo.id} is missing browse.${dimension}.`);
			if (photo.browse[dimension] && photo.taxonomy[dimension].length === 0)
				throw new Error(`${photo.id} cannot be visible in ${dimension} without a value.`);
		}
		if (typeof photo.featured !== 'boolean')
			throw new Error(`${photo.id} must declare featured as true or false.`);
		for (const field of ['title', 'description', 'series'] as const) {
			if (photo[field] !== undefined && photo[field] !== null && typeof photo[field] !== 'string')
				throw new Error(`${photo.id}.${field} must be a string when provided.`);
		}
		ids.add(photo.id);
		files.add(file);
	}
}

async function validateImportPlans(
	plans: ImportPlan[],
	gallery: GalleryData,
	photosDirectory: string,
) {
	const ids = new Set(gallery.photos.map((photo) => photo.id));
	const files = new Set(gallery.photos.map((photo) => normalizeMetadataPath(photo.file)));
	for (const plan of plans) {
		if (ids.has(plan.id)) throw new Error(`Photo ID collision: ${plan.id}`);
		if (files.has(plan.photo.file)) throw new Error(`Metadata file collision: ${plan.photo.file}`);
		const destination = path.join(photosDirectory, plan.fileName);
		if (path.dirname(destination) !== path.resolve(photosDirectory))
			throw new Error(`Unsafe destination filename: ${plan.fileName}`);
		if (plans.filter((candidate) => candidate.id === plan.id).length > 1)
			throw new Error(`Duplicate planned photo ID: ${plan.id}`);
		if (await fileExists(destination)) throw new Error(`Image file collision: ${plan.fileName}`);
		ids.add(plan.id);
		files.add(plan.photo.file);
	}
}

function resolvePhotoPath(file: string, photosDirectory: string) {
	const normalized = normalizeMetadataPath(file);
	if (!normalized.startsWith('photos/'))
		throw new Error(`Photo path must start with photos/: ${file}`);
	const relative = normalized.slice('photos/'.length);
	const root = path.resolve(photosDirectory);
	const resolved = path.resolve(root, relative);
	if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`))
		throw new Error(`Unsafe photo path: ${file}`);
	return resolved;
}

function toMetadataPath(file: string, photosDirectory: string) {
	return `photos/${path.relative(photosDirectory, file).replaceAll('\\', '/')}`;
}

function normalizeMetadataPath(file: string) {
	return typeof file === 'string' ? file.replaceAll('\\', '/') : '';
}

async function fileExists(file: string) {
	try {
		await fs.access(file);
		return true;
	} catch (error) {
		if (isMissingFileError(error)) return false;
		throw error;
	}
}

function isMissingFileError(error: unknown): error is Error & { code: string } {
	return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
