import { describe, expect, it } from 'vitest';
import { createGalleryPhoto } from '../galleryEntityFactory.ts';
import path from 'path';

const testGalleryPath = path.join('src', 'data', '__tests__', 'gallery');

describe('createGalleryPhoto', () => {
	it('extracts technical metadata without using EXIF for taxonomy', async () => {
		const photo = await createGalleryPhoto(
			testGalleryPath,
			path.join(testGalleryPath, 'photos', 'kuku-trees.jpg'),
		);

		expect(photo.id).toBe('photos-kuku-trees');
		expect(photo.file).toBe('photos/kuku-trees.jpg');
		expect(photo.taxonomy.year).toEqual([]);
		expect(photo.browse).toEqual({ year: false, place: false, subject: false });
		expect(photo.featured).toBe(false);
		expect(photo.technical?.capturedAt).toEqual(new Date('2025-02-21T09:17:14.000Z'));
		expect(photo.technical?.fNumber).toBe(8);
		expect(photo.technical?.focalLength).toBe(28);
		expect(photo.technical?.iso).toBe(100);
		expect(photo.technical?.shutterSpeed).toBe(640);
		expect(photo.technical?.model).toBe('LEICA Q3');
		expect(photo.technical?.lensModel).toBe('SUMMILUX 1:1.7/28 ASPH.');
		expect(photo.title).toBeUndefined();
		expect(photo.description).toBeUndefined();
	});

	it('supports a photo without EXIF data', async () => {
		const testsPath = path.join('src', 'data', '__tests__');
		const photo = await createGalleryPhoto(testsPath, path.join(testsPath, 'without-exif.jpg'));
		expect(photo.technical).toEqual({});
		expect(photo.taxonomy.year).toEqual([]);
	});
});
