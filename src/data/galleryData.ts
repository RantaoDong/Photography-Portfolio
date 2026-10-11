import type { ImageMetadata } from 'astro';
import path from 'path';
import { promises as fs } from 'fs';
import * as yaml from 'js-yaml';

export const browseDimensionIds = ['year', 'place', 'subject'] as const;
export type BrowseDimensionId = (typeof browseDimensionIds)[number];

export interface BrowseDimension {
	id: BrowseDimensionId;
	label: string;
}

export interface BrowseCategory {
	id: string;
	name: string;
}

export interface BrowseDimensionWithCategories extends BrowseDimension {
	categories: BrowseCategory[];
}

export type PhotoTaxonomy = Record<BrowseDimensionId, string[]>;
export type BrowseVisibility = Record<BrowseDimensionId, boolean>;

export interface TechnicalMetadata {
	focalLength?: number;
	iso?: number;
	fNumber?: number;
	shutterSpeed?: number;
	capturedAt?: Date;
	model?: string;
	lensModel?: string;
	width?: number;
	height?: number;
}

/** Reserved for optional generated data such as color or composition analysis. */
export type PhotoFeatures = Record<string, unknown>;

export interface GalleryPhoto {
	id: string;
	file: string;
	title?: string;
	description?: string;
	series?: string | null;
	taxonomy: PhotoTaxonomy;
	browse: BrowseVisibility;
	featured: boolean;
	technical?: TechnicalMetadata;
	features?: PhotoFeatures;
}

export interface GalleryData {
	browseDimensions: BrowseDimension[];
	photos: GalleryPhoto[];
}

export interface Image {
	id: string;
	src: ImageMetadata;
	title?: string;
	description?: string;
	series?: string | null;
	taxonomy: PhotoTaxonomy;
}

export type ImageModule = { default: ImageMetadata };

export const defaultBrowseDimensions: BrowseDimension[] = [
	{ id: 'year', label: 'Year' },
	{ id: 'place', label: 'Place' },
	{ id: 'subject', label: 'Subject' },
];

export const loadGallery = async (galleryPath: string): Promise<GalleryData> => {
	const yamlPath = path.resolve(process.cwd(), galleryPath);
	const content = await fs.readFile(yamlPath, 'utf8');
	return yaml.load(content) as GalleryData;
};

export const NullGalleryData: GalleryData = {
	browseDimensions: defaultBrowseDimensions,
	photos: [],
};
