import { beforeAll, describe, expect, it } from 'vitest';
import { execa } from 'execa';
import path from 'path';
import * as fs from 'node:fs';
import { type GalleryData, loadGallery } from '../galleryData.ts';
import yaml from 'js-yaml';

const testGalleryPath = 'src/data/__tests__/gallery';
const testGalleryYaml = path.join(testGalleryPath, 'gallery.yaml');
const scriptPath = path.resolve(__dirname, '../gallery-generator.ts');
const tsxCliPath = path.resolve('node_modules/tsx/dist/cli.mjs');

describe('Gallery Generator', () => {
	let gallery: GalleryData;

	beforeAll(async () => {
		await fs.promises.rm(testGalleryYaml, { force: true });
		await generateGallery();
	});

	async function generateGallery() {
		await execa(process.execPath, [tsxCliPath, scriptPath, testGalleryPath]);
		gallery = await loadGallery(testGalleryYaml);
	}

	it('creates the three browse dimensions without deriving categories from folders', () => {
		expect(gallery.browseDimensions).toEqual([
			{ id: 'year', label: 'Year' },
			{ id: 'place', label: 'Place' },
			{ id: 'subject', label: 'Subject' },
		]);
	});

	it('discovers every image below the neutral photos directory', () => {
		expect(gallery.photos.map((photo) => photo.file).sort()).toEqual([
			'photos/kuku-bubble.jpg',
			'photos/kuku-trees.jpg',
			'photos/landscape.jpg',
			'photos/popo-view.jpg',
		]);
	});

	it('creates stable IDs and safe visibility defaults', () => {
		const photo = findPhoto('photos/kuku-trees.jpg');
		expect(photo.id).toBe('photos-kuku-trees');
		expect(photo.title).toBeUndefined();
		expect(photo.description).toBeUndefined();
		expect(photo.taxonomy.year).toEqual([]);
		expect(photo.taxonomy.place).toEqual([]);
		expect(photo.taxonomy.subject).toEqual([]);
		expect(photo.browse).toEqual({ all: true, year: false, place: false, subject: false });
		expect(photo.featured).toBe(false);
	});

	it('preserves human metadata and generated feature data on regeneration', async () => {
		const photo = findPhoto('photos/kuku-trees.jpg');
		photo.title = 'Custom Title';
		photo.description = 'Custom Description';
		photo.taxonomy = {
			year: ['2025'],
			place: ['Stockholm'],
			subject: ['Performance', 'Event'],
		};
		photo.browse = { all: false, year: false, place: false, subject: true };
		photo.featured = true;
		photo.features = { color: { average: '#222222' } };
		photo.technical = { ...photo.technical, focalLength: 10 };
		await writeGallery();

		await generateGallery();
		const updated = findPhoto('photos/kuku-trees.jpg');
		expect(updated.title).toBe(photo.title);
		expect(updated.description).toBe(photo.description);
		expect(updated.taxonomy).toEqual(photo.taxonomy);
		expect(updated.browse).toEqual(photo.browse);
		expect(updated.featured).toBe(true);
		expect(updated.features).toEqual(photo.features);
		expect(updated.technical?.focalLength).toBe(28);
	});

	it('fails on an invalid gallery path', async () => {
		await expect(execa(process.execPath, [tsxCliPath, scriptPath, 'invalid-path'])).rejects.toThrow(
			'Invalid directory path provided.',
		);
	});

	function findPhoto(file: string) {
		const photo = gallery.photos.find((entry) => entry.file === file);
		if (!photo) throw new Error(`Photo [${file}] not found`);
		return photo;
	}

	async function writeGallery() {
		await fs.promises.writeFile(testGalleryYaml, yaml.dump(gallery), 'utf8');
	}
});
