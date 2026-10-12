import { describe, expect, it } from 'vitest';
import kukuTrees from './gallery/photos/kuku-trees.jpg';
import popoView from './gallery/photos/popo-view.jpg';
import landscape from './gallery/photos/landscape.jpg';
import type { GalleryPhoto } from '../galleryData.ts';
import {
	getBrowseDimensions,
	getImages,
	ImageStoreError,
	sortPhotosByYearDescending,
} from '../imageStore.ts';

const GALLERY = {
	VALID: 'src/data/__tests__/gallery/valid-gallery.yaml',
	INVALID: 'src/data/__tests__/gallery/invalid-gallery.yaml',
	MISSING: 'src/data/__tests__/gallery/no-gallery.yaml',
	INVALID_VISIBILITY: 'src/data/__tests__/gallery/invalid-collection-gallery.yaml',
};

describe('Image Store', () => {
	it('retrieves images enabled for All and skips a missing file', async () => {
		const images = await getImages({ galleryPath: GALLERY.VALID });
		expect(images).toHaveLength(2);
		expect(images[0].src).toEqual(kukuTrees);
		expect(images[1].src).toEqual(popoView);
		expect(images[0].title).toBeUndefined();
		expect(images[0].description).toBeUndefined();
		expect(images[1].title).toBe('Popo View');
	});

	it('filters by a dynamically derived subject category', async () => {
		const images = await getImages({
			galleryPath: GALLERY.VALID,
			dimension: 'subject',
			category: 'performance',
		});
		expect(images).toHaveLength(1);
		expect(images[0].src).toEqual(popoView);
	});

	it('shows all photos exposed through a selected dimension', async () => {
		const images = await getImages({
			galleryPath: GALLERY.VALID,
			dimension: 'place',
		});
		expect(images).toHaveLength(2);
		expect(images[0].src).toEqual(kukuTrees);
		expect(images[1].src).toEqual(landscape);
	});

	it('keeps factual metadata while respecting per-dimension visibility', async () => {
		const byPlace = await getImages({
			galleryPath: GALLERY.VALID,
			dimension: 'place',
			category: 'stockholm',
		});
		const byYear = await getImages({
			galleryPath: GALLERY.VALID,
			dimension: 'year',
			category: '2025',
		});

		expect(byPlace).toHaveLength(0);
		expect(byYear).toHaveLength(1);
		expect(byYear[0].src).toEqual(kukuTrees);
	});

	it('supports multiple subjects', async () => {
		const architecture = await getImages({
			galleryPath: GALLERY.VALID,
			dimension: 'subject',
			category: 'architecture',
		});
		expect(architecture).toHaveLength(1);
		expect(architecture[0].src).toEqual(landscape);
		expect(architecture[0].taxonomy.subject).toEqual(['Landscape', 'Architecture']);
	});

	it('keeps a photo out of All while allowing it in a dimension', async () => {
		const all = await getImages({ galleryPath: GALLERY.VALID });
		const architecture = await getImages({
			galleryPath: GALLERY.VALID,
			dimension: 'subject',
			category: 'architecture',
		});

		expect(all.some((image) => image.src === landscape)).toBe(false);
		expect(architecture[0].src).toEqual(landscape);
	});

	it('retrieves featured photos independently of taxonomy', async () => {
		const images = await getImages({ galleryPath: GALLERY.VALID, featuredOnly: true });
		expect(images).toHaveLength(2);
		expect(images[0].src).toEqual(landscape);
		expect(images[1].src).toEqual(popoView);
	});

	it('keeps unpublished photos out of public results and category options', async () => {
		const images = await getImages({ galleryPath: GALLERY.VALID });
		const dimensions = await getBrowseDimensions(GALLERY.VALID);

		expect(images).toHaveLength(2);
		expect(dimensions.find((item) => item.id === 'year')?.categories).not.toContainEqual({
			id: '2023',
			name: '2023',
		});
		expect(dimensions.find((item) => item.id === 'subject')?.categories).not.toContainEqual({
			id: 'hidden-subject',
			name: 'Hidden Subject',
		});
	});

	it('derives visible categories from photo metadata', async () => {
		const dimensions = await getBrowseDimensions(GALLERY.VALID);
		expect(dimensions.find((item) => item.id === 'year')?.categories).toEqual([
			{ id: '2025', name: '2025' },
			{ id: '2024', name: '2024' },
		]);
		expect(dimensions.find((item) => item.id === 'place')?.categories).toEqual([
			{ id: 'berlin', name: 'Berlin' },
			{ id: 'uppsala', name: 'Uppsala' },
		]);
		expect(dimensions.find((item) => item.id === 'subject')?.categories).toEqual([
			{ id: 'architecture', name: 'Architecture' },
			{ id: 'landscape', name: 'Landscape' },
			{ id: 'performance', name: 'Performance' },
		]);
	});

	describe('sorting', () => {
		it('sorts valid years newest first, preserves ties, and puts invalid years last', () => {
			const photos = [
				photoWithYear('first-2025', '2025'),
				photoWithYear('no-year', ''),
				photoWithYear('2026', '2026'),
				photoWithYear('second-2025', '2025'),
				photoWithYear('invalid-year', 'recent'),
			];

			expect(sortPhotosByYearDescending(photos).map((photo) => photo.id)).toEqual([
				'2026',
				'first-2025',
				'second-2025',
				'no-year',
				'invalid-year',
			]);
		});
	});

	describe('validation failures', () => {
		it('fails on a missing gallery file', async () => {
			await expect(getImages({ galleryPath: GALLERY.MISSING })).rejects.toThrow(ImageStoreError);
		});

		it('fails on an invalid gallery structure', async () => {
			await expect(getImages({ galleryPath: GALLERY.INVALID })).rejects.toThrow(ImageStoreError);
		});

		it('fails when browsing is enabled without taxonomy metadata', async () => {
			await expect(getImages({ galleryPath: GALLERY.INVALID_VISIBILITY })).rejects.toThrow(
				ImageStoreError,
			);
		});
	});
});

function photoWithYear(id: string, year: string): GalleryPhoto {
	return {
		id,
		file: `photos/${id}.jpg`,
		taxonomy: { year: year ? [year] : [], place: [], subject: [] },
		browse: { all: true, year: false, place: false, subject: false },
		featured: false,
	};
}
