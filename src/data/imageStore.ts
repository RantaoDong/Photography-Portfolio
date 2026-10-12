import path from 'path';
import {
	browseDimensionIds,
	type BrowseDimensionId,
	type BrowseDimensionWithCategories,
	type GalleryData,
	type GalleryPhoto,
	type Image,
	type ImageModule,
	loadGallery,
} from './galleryData.ts';

export class ImageStoreError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ImageStoreError';
	}
}

const imageModules = import.meta.glob(
	[
		'/src/gallery/photos/**/*.{jpg,jpeg,png,gif,webp,avif}',
		'/src/data/__tests__/gallery/**/*.{jpg,jpeg,png,gif,webp,avif}',
	],
	{ eager: true },
);

const defaultGalleryPath = 'src/gallery/gallery.yaml';

export interface GetImagesOptions {
	galleryPath?: string;
	dimension?: BrowseDimensionId;
	category?: string;
	featuredOnly?: boolean;
}

export const getImages = async (options: GetImagesOptions = {}): Promise<Image[]> => {
	const { galleryPath = defaultGalleryPath } = options;
	try {
		let photos = (await loadGalleryData(galleryPath)).photos;
		photos = filterPhotos(photos, options);
		photos = sortPhotos(photos, options);
		return processImages(photos, galleryPath);
	} catch (error) {
		throw new ImageStoreError(
			`Failed to load images from ${galleryPath}: ${getErrorMsgFrom(error)}`,
		);
	}
};

export const getBrowseDimensions = async (
	galleryPath: string = defaultGalleryPath,
): Promise<BrowseDimensionWithCategories[]> => {
	const gallery = await loadGalleryData(galleryPath);

	return gallery.browseDimensions.map((dimension) => {
		const names = new Set<string>();
		for (const photo of gallery.photos) {
			if (photo.published === false) continue;
			if (!photo.browse[dimension.id]) continue;
			for (const value of photo.taxonomy[dimension.id]) names.add(value);
		}

		const categories = [...names]
			.map((name) => ({ id: toCategorySlug(name), name }))
			.sort((a, b) => sortCategories(dimension.id, a.name, b.name));

		return { ...dimension, categories };
	});
};

export const isBrowseDimensionId = (value: string): value is BrowseDimensionId =>
	(browseDimensionIds as readonly string[]).includes(value);

export const toCategorySlug = (value: string): string =>
	value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

const loadGalleryData = async (galleryPath: string): Promise<GalleryData> => {
	try {
		const gallery = await loadGallery(galleryPath);
		validateGalleryData(gallery);
		return gallery;
	} catch (error) {
		throw new ImageStoreError(
			`Failed to load gallery data from ${galleryPath}: ${getErrorMsgFrom(error)}`,
		);
	}
};

function filterPhotos(photos: GalleryPhoto[], options: GetImagesOptions) {
	const { dimension, category, featuredOnly } = options;
	let result = photos;
	result = result.filter((photo) => photo.published !== false);

	if (featuredOnly) result = result.filter((photo) => photo.featured);
	else if (!dimension) result = result.filter((photo) => photo.browse.all !== false);

	if (category && !dimension) {
		throw new ImageStoreError('A dimension is required for category filtering');
	}

	if (dimension) {
		result = result.filter((photo) => photo.browse[dimension]);
		if (category) {
			result = result.filter((photo) =>
				photo.taxonomy[dimension].some((value) => toCategorySlug(value) === category),
			);
		}
	}

	return result;
}

function sortPhotos(photos: GalleryPhoto[], options: GetImagesOptions) {
	return options.featuredOnly ? sortFeaturedPhotos(photos) : sortPhotosByYearDescending(photos);
}

export function sortPhotosByYearDescending(photos: GalleryPhoto[]) {
	return photos
		.map((photo, index) => ({ photo, index, year: validYear(photo) }))
		.sort((a, b) => {
			if (a.year === null && b.year !== null) return 1;
			if (a.year !== null && b.year === null) return -1;
			if (a.year !== b.year) return (b.year ?? 0) - (a.year ?? 0);
			return a.index - b.index;
		})
		.map(({ photo }) => photo);
}

export function sortFeaturedPhotos(photos: GalleryPhoto[]) {
	return photos
		.map((photo, index) => ({ photo, index }))
		.sort((a, b) => {
			const orderA = validFeaturedOrder(a.photo.featured_order);
			const orderB = validFeaturedOrder(b.photo.featured_order);
			if (orderA === null && orderB !== null) return 1;
			if (orderA !== null && orderB === null) return -1;
			if (orderA !== orderB) return (orderA ?? 0) - (orderB ?? 0);
			return a.index - b.index;
		})
		.map(({ photo }) => photo);
}

function validYear(photo: GalleryPhoto) {
	const value = photo.taxonomy.year[0];
	return /^\d{4}$/.test(value ?? '') ? Number(value) : null;
}

function validFeaturedOrder(value: number | undefined) {
	return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function validateGalleryData(gallery: GalleryData) {
	if (!gallery || !Array.isArray(gallery.browseDimensions) || !Array.isArray(gallery.photos)) {
		throw new ImageStoreError('Gallery must contain browseDimensions and photos arrays');
	}

	const dimensionIds = gallery.browseDimensions.map((dimension) => dimension.id);
	if (new Set(dimensionIds).size !== dimensionIds.length) {
		throw new ImageStoreError('Browse dimension IDs must be unique');
	}
	for (const dimensionId of dimensionIds) {
		if (!isBrowseDimensionId(dimensionId)) {
			throw new ImageStoreError(`Unsupported browse dimension: ${dimensionId}`);
		}
	}
	for (const requiredId of browseDimensionIds) {
		if (!dimensionIds.includes(requiredId)) {
			throw new ImageStoreError(`Missing browse dimension: ${requiredId}`);
		}
	}

	const photoIds = new Set<string>();
	const files = new Set<string>();
	const featuredOrders = new Set<number>();
	for (const photo of gallery.photos) {
		if (!photo.id || photoIds.has(photo.id)) {
			throw new ImageStoreError(`Photo ID must be present and unique: ${photo.id || 'missing'}`);
		}
		photoIds.add(photo.id);

		if (!photo.file || files.has(photo.file)) {
			throw new ImageStoreError(
				`Photo file must be present and unique: ${photo.file || 'missing'}`,
			);
		}
		files.add(photo.file);

		if (photo.title !== undefined && typeof photo.title !== 'string')
			throw new ImageStoreError(`Photo ${photo.id} title must be a string`);
		if (photo.description !== undefined && typeof photo.description !== 'string')
			throw new ImageStoreError(`Photo ${photo.id} description must be a string`);
		for (const dimensionId of browseDimensionIds) {
			if (!Array.isArray(photo.taxonomy?.[dimensionId])) {
				throw new ImageStoreError(`Photo ${photo.id} is missing taxonomy.${dimensionId}`);
			}
			if (typeof photo.browse?.[dimensionId] !== 'boolean') {
				throw new ImageStoreError(`Photo ${photo.id} is missing browse.${dimensionId}`);
			}
			if (photo.browse[dimensionId] && photo.taxonomy[dimensionId].length === 0) {
				throw new ImageStoreError(
					`Photo ${photo.id} cannot browse by ${dimensionId} without a taxonomy value`,
				);
			}
		}
		if (photo.browse.all !== undefined && typeof photo.browse.all !== 'boolean') {
			throw new ImageStoreError(`Photo ${photo.id} browse.all must be a boolean`);
		}

		if (typeof photo.featured !== 'boolean') {
			throw new ImageStoreError(`Photo ${photo.id} must declare featured as a boolean`);
		}
		if (photo.featured_order !== undefined) {
			if (!photo.featured || !Number.isInteger(photo.featured_order) || photo.featured_order < 1) {
				throw new ImageStoreError(
					`Photo ${photo.id} featured_order must be a positive integer on a featured photo`,
				);
			}
			if (featuredOrders.has(photo.featured_order)) {
				throw new ImageStoreError(`Duplicate featured_order: ${photo.featured_order}`);
			}
			featuredOrders.add(photo.featured_order);
		}
		if (photo.published !== undefined && typeof photo.published !== 'boolean') {
			throw new ImageStoreError(`Photo ${photo.id} published must be a boolean`);
		}
	}

	validateCategorySlugs(gallery);
}

function validateCategorySlugs(gallery: GalleryData) {
	for (const dimensionId of browseDimensionIds) {
		const slugs = new Map<string, string>();
		for (const photo of gallery.photos) {
			if (!photo.browse[dimensionId]) continue;
			for (const value of photo.taxonomy[dimensionId]) {
				const slug = toCategorySlug(value);
				if (!slug)
					throw new ImageStoreError(`Invalid empty ${dimensionId} category on ${photo.id}`);
				const existing = slugs.get(slug);
				if (existing && existing !== value) {
					throw new ImageStoreError(
						`${dimensionId} categories "${existing}" and "${value}" share the slug "${slug}"`,
					);
				}
				slugs.set(slug, value);
			}
		}
	}
}

function processImages(photos: GalleryPhoto[], galleryPath: string): Image[] {
	return photos.reduce<Image[]>((images, photo) => {
		const normalizedFile = photo.file.replaceAll('\\', '/');
		const imagePath = path.posix.join('/', path.parse(galleryPath).dir, normalizedFile);
		const imageModule = imageModules[imagePath] as ImageModule | undefined;

		if (!imageModule) {
			console.warn(`[WARN] Image not found: ${imagePath}`);
			return images;
		}

		images.push({
			id: photo.id,
			src: imageModule.default,
			title: photo.title,
			description: photo.description,
			taxonomy: photo.taxonomy,
		});
		return images;
	}, []);
}

function sortCategories(dimension: BrowseDimensionId, a: string, b: string) {
	if (dimension === 'year') return b.localeCompare(a, undefined, { numeric: true });
	return a.localeCompare(b);
}

function getErrorMsgFrom(error: unknown) {
	return error instanceof Error ? error.message : 'Unknown error';
}
