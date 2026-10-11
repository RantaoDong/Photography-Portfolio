import path from 'path';
import exifr from 'exifr';
import type { GalleryPhoto, TechnicalMetadata } from './galleryData.ts';

export const createGalleryPhoto = async (
	galleryDir: string,
	file: string,
): Promise<GalleryPhoto> => {
	const relativePath = path.relative(galleryDir, file).replaceAll('\\', '/');
	const exifData = await exifr.parse(file);
	const capturedAt = toCaptureDate(exifData?.DateTimeOriginal);

	return {
		id: toStableId(relativePath),
		file: relativePath,
		taxonomy: {
			year: [],
			place: [],
			subject: [],
		},
		browse: {
			year: false,
			place: false,
			subject: false,
		},
		featured: false,
		technical: createTechnicalMetadata(exifData, capturedAt),
	};
};

function createTechnicalMetadata(
	exifData: Record<string, unknown> | undefined,
	capturedAt: Date | undefined,
): TechnicalMetadata {
	if (!exifData) return {};

	const exposureTime = exifData.ExposureTime as number | undefined;
	return {
		capturedAt,
		fNumber: exifData.FNumber as number | undefined,
		focalLength: exifData.FocalLength as number | undefined,
		iso: exifData.ISO as number | undefined,
		model: exifData.Model as string | undefined,
		shutterSpeed: exposureTime ? 1 / exposureTime : undefined,
		lensModel: exifData.LensModel as string | undefined,
		width: (exifData.ExifImageWidth ?? exifData.ImageWidth) as number | undefined,
		height: (exifData.ExifImageHeight ?? exifData.ImageHeight) as number | undefined,
	};
}

function toCaptureDate(value: unknown): Date | undefined {
	if (value instanceof Date) {
		return new Date(
			Date.UTC(
				value.getFullYear(),
				value.getMonth(),
				value.getDate(),
				value.getHours(),
				value.getMinutes(),
				value.getSeconds(),
			),
		);
	}
	if (typeof value !== 'string') return undefined;
	const date = new Date(`${value} UTC`);
	return Number.isNaN(date.getTime()) ? undefined : date;
}

function toStableId(relativePath: string) {
	return relativePath
		.slice(0, -path.extname(relativePath).length)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}
