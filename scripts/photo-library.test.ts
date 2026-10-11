import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GalleryData, GalleryPhoto } from '../src/data/galleryData.ts';
import {
	checkConsistency,
	commitImport,
	commitRemoval,
	deriveMetadataOptions,
	GalleryConflictError,
	nextPhotoNumber,
	readGalleryFile,
	readGallerySnapshot,
	updateGalleryPhotos,
	writeGalleryFileAtomic,
} from './photo-library.ts';

describe('photo library workflow', () => {
	let root: string;
	let galleryDirectory: string;
	let photosDirectory: string;
	let incomingDirectory: string;
	let metadataFile: string;

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), 'photo-library-'));
		galleryDirectory = path.join(root, 'src', 'gallery');
		photosDirectory = path.join(galleryDirectory, 'photos');
		incomingDirectory = path.join(root, 'incoming');
		metadataFile = path.join(galleryDirectory, 'gallery.yaml');
		await fs.mkdir(photosDirectory, { recursive: true });
		await fs.mkdir(incomingDirectory, { recursive: true });
	});

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});

	it('finds missing files and image files without metadata', async () => {
		const gallery = createGallery([createPhoto('photo-0001'), createPhoto('photo-0002')]);
		await fs.writeFile(path.join(photosDirectory, 'photo-0001.jpg'), 'one');
		await fs.writeFile(path.join(photosDirectory, 'orphan.jpg'), 'orphan');

		const report = await checkConsistency(gallery, photosDirectory);

		expect(report.missingFiles.map((photo) => photo.id)).toEqual(['photo-0002']);
		expect(report.orphanFiles).toEqual(['photos/orphan.jpg']);
		expect(report.duplicateIds).toEqual([]);
		expect(report.duplicateFiles).toEqual([]);
	});

	it('reports duplicate IDs and metadata filenames without deleting anything', async () => {
		const duplicateId = { ...createPhoto('photo-0001'), file: 'photos/other.jpg' };
		const duplicateFile = { ...createPhoto('photo-0003'), file: 'photos/photo-0002.jpg' };
		const gallery = createGallery([
			createPhoto('photo-0001'),
			duplicateId,
			createPhoto('photo-0002'),
			duplicateFile,
		]);

		const report = await checkConsistency(gallery, photosDirectory);

		expect(report.duplicateIds).toEqual(['photo-0001']);
		expect(report.duplicateFiles).toEqual(['photos/photo-0002.jpg']);
	});

	it('derives reusable taxonomy options from the current metadata', () => {
		const first = createPhoto('photo-0001');
		const second = {
			...createPhoto('photo-0002'),
			taxonomy: { year: ['2025'], place: ['Berlin'], subject: ['Architecture', 'Street'] },
		};

		expect(deriveMetadataOptions(createGallery([first, second]))).toEqual({
			years: ['2026', '2025'],
			places: ['Berlin', 'Stockholm'],
			subjects: ['Architecture', 'Street'],
		});
	});

	it('updates All visibility independently from taxonomy dimensions', () => {
		const gallery = createGallery([createPhoto('photo-0001')]);
		const updated = updateGalleryPhotos(gallery, ['photo-0001'], {
			browse: { all: false },
		});

		expect(updated.photos[0].browse).toEqual({
			all: false,
			year: true,
			place: true,
			subject: true,
		});
	});

	it('applies explicit subject operations without overwriting other batch metadata', () => {
		const first = createPhoto('photo-0001');
		const second = {
			...createPhoto('photo-0002'),
			taxonomy: { year: ['2025'], place: ['Berlin'], subject: ['Architecture'] },
		};
		const gallery = createGallery([first, second]);

		const added = updateGalleryPhotos(gallery, [first.id, second.id], {
			subjects: { operation: 'add', values: ['Event'] },
		});
		expect(added.photos[0].taxonomy.subject).toEqual(['Street', 'Event']);
		expect(added.photos[1].taxonomy.subject).toEqual(['Architecture', 'Event']);
		expect(added.photos[1].taxonomy.year).toEqual(['2025']);
		expect(added.photos[1].taxonomy.place).toEqual(['Berlin']);

		const removed = updateGalleryPhotos(added, [first.id, second.id], {
			subjects: { operation: 'remove', values: ['Event'] },
		});
		expect(removed.photos[0].taxonomy.subject).toEqual(['Street']);
		expect(removed.photos[1].taxonomy.subject).toEqual(['Architecture']);

		const replaced = updateGalleryPhotos(removed, [first.id, second.id], {
			subjects: { operation: 'replace', values: ['Performance'] },
		});
		expect(replaced.photos.map((photo) => photo.taxonomy.subject)).toEqual([
			['Performance'],
			['Performance'],
		]);
	});

	it('supports hiding a photo without deleting its file or metadata', () => {
		const gallery = createGallery([createPhoto('photo-0001')]);
		const updated = updateGalleryPhotos(gallery, ['photo-0001'], { published: false });
		expect(updated.photos[0].published).toBe(false);
		expect(updated.photos[0].file).toBe('photos/photo-0001.jpg');
	});

	it('uses the highest existing sequential ID or filename', () => {
		const gallery = createGallery([
			createPhoto('photo-0003'),
			{ ...createPhoto('legacy'), file: 'photos/photo-0012.jpg' },
		]);
		expect(nextPhotoNumber(gallery, [path.join(photosDirectory, 'photo-0008.jpg')])).toBe(13);
	});

	it('moves an imported batch and appends metadata together', async () => {
		const gallery = createGallery([]);
		await writeGalleryFileAtomic(gallery, metadataFile);
		const source = path.join(incomingDirectory, 'export.jpg');
		await fs.writeFile(source, 'photo');
		const photo = createPhoto('photo-0001');

		await commitImport(
			[{ source, id: photo.id, fileName: 'photo-0001.jpg', photo }],
			gallery,
			paths(),
		);

		expect(await exists(source)).toBe(false);
		expect(await fs.readFile(path.join(photosDirectory, 'photo-0001.jpg'), 'utf8')).toBe('photo');
		expect((await readGalleryFile(metadataFile)).photos.map((item) => item.id)).toEqual([
			'photo-0001',
		]);
	});

	it('aborts before changing anything when an image filename collides', async () => {
		const gallery = createGallery([]);
		await writeGalleryFileAtomic(gallery, metadataFile);
		const source = path.join(incomingDirectory, 'export.jpg');
		const destination = path.join(photosDirectory, 'photo-0001.jpg');
		await fs.writeFile(source, 'incoming');
		await fs.writeFile(destination, 'existing');
		const photo = createPhoto('photo-0001');

		await expect(
			commitImport([{ source, id: photo.id, fileName: 'photo-0001.jpg', photo }], gallery, paths()),
		).rejects.toThrow('Image file collision');

		expect(await fs.readFile(source, 'utf8')).toBe('incoming');
		expect(await fs.readFile(destination, 'utf8')).toBe('existing');
		expect((await readGalleryFile(metadataFile)).photos).toEqual([]);
	});

	it('removes selected files and metadata while keeping other photos', async () => {
		const removed = createPhoto('photo-0001');
		const kept = createPhoto('photo-0002');
		const gallery = createGallery([removed, kept]);
		await writeGalleryFileAtomic(gallery, metadataFile);
		await fs.writeFile(path.join(photosDirectory, 'photo-0001.jpg'), 'one');
		await fs.writeFile(path.join(photosDirectory, 'photo-0002.jpg'), 'two');

		await commitRemoval([removed], gallery, paths());

		expect(await exists(path.join(photosDirectory, 'photo-0001.jpg'))).toBe(false);
		expect(await exists(path.join(photosDirectory, 'photo-0002.jpg'))).toBe(true);
		expect((await readGalleryFile(metadataFile)).photos.map((item) => item.id)).toEqual([
			'photo-0002',
		]);
	});

	it('refuses to replace YAML when its revision changed after loading', async () => {
		const gallery = createGallery([createPhoto('photo-0001')]);
		await writeGalleryFileAtomic(gallery, metadataFile);
		const snapshot = await readGallerySnapshot(metadataFile);
		await fs.appendFile(metadataFile, '\n# external edit\n');

		await expect(
			writeGalleryFileAtomic(gallery, metadataFile, snapshot.revision),
		).rejects.toBeInstanceOf(GalleryConflictError);
		expect(await fs.readFile(metadataFile, 'utf8')).toContain('# external edit');
	});

	function paths() {
		return {
			repositoryRoot: root,
			galleryDirectory,
			photosDirectory,
			incomingDirectory,
			metadataFile,
		};
	}
});

function createGallery(photos: GalleryPhoto[]): GalleryData {
	return {
		browseDimensions: [
			{ id: 'year', label: 'Year' },
			{ id: 'place', label: 'Place' },
			{ id: 'subject', label: 'Subject' },
		],
		photos,
	};
}

function createPhoto(id: string): GalleryPhoto {
	return {
		id,
		file: `photos/${id}.jpg`,
		taxonomy: { year: ['2026'], place: ['Stockholm'], subject: ['Street'] },
		browse: { all: true, year: true, place: true, subject: true },
		featured: false,
	};
}

async function exists(file: string) {
	try {
		await fs.access(file);
		return true;
	} catch {
		return false;
	}
}
