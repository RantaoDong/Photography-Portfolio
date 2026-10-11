import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface, type Interface } from 'node:readline/promises';
import type { BrowseVisibility, GalleryPhoto, PhotoTaxonomy } from '../src/data/galleryData.ts';
import {
	commitImport,
	findIncomingPhotos,
	formatPhoto,
	libraryPaths,
	listPhotoFiles,
	nextPhotoNumber,
	readGalleryFile,
	type ImportPlan,
} from './photo-library.ts';

interface Answers {
	taxonomy: PhotoTaxonomy;
	browse: BrowseVisibility;
	featured: boolean;
}

async function main() {
	if (!process.stdin.isTTY || !process.stdout.isTTY)
		throw new Error('The photo importer requires an interactive terminal.');

	const incoming = await findIncomingPhotos();
	if (incoming.length === 0) {
		console.log(`No JPG files found in ${libraryPaths.incomingDirectory}`);
		return;
	}

	const gallery = await readGalleryFile();
	const startNumber = nextPhotoNumber(gallery, await listPhotoFiles());
	const prompt = createInterface({ input: process.stdin, output: process.stdout });

	try {
		console.log(`Found ${incoming.length} JPG file(s). Enter batch defaults.\n`);
		const defaults = await askMetadata(prompt);
		const plans: ImportPlan[] = [];

		for (const [index, source] of incoming.entries()) {
			console.log(`\n${path.basename(source)}`);
			const useDefaults = await askYesNo(prompt, 'Use batch defaults?', true);
			const answers = useDefaults ? defaults : await askMetadata(prompt, defaults);
			const sequence = startNumber + index;
			const id = `photo-${String(sequence).padStart(4, '0')}`;
			const fileName = `${id}.jpg`;
			const photo: GalleryPhoto = {
				id,
				file: `photos/${fileName}`,
				taxonomy: answers.taxonomy,
				browse: answers.browse,
				featured: answers.featured,
				technical: {},
				features: {},
			};
			plans.push({ source, id, fileName, photo });
		}

		console.log('\nImport preview\n==============');
		for (const plan of plans) {
			console.log(`\n${path.basename(plan.source)} -> ${plan.fileName}`);
			console.log(formatPhoto(plan.photo));
		}

		if (!(await askYesNo(prompt, '\nProceed with import?', true))) {
			console.log('Import cancelled. No files or metadata were changed.');
			return;
		}

		await commitImport(plans, gallery);
		console.log(`\nImported ${plans.length} photo(s) successfully:`);
		for (const plan of plans) console.log(`- ${plan.id} (${plan.photo.file})`);
		console.log('The original incoming files were moved into src/gallery/photos.');
	} finally {
		prompt.close();
	}
}

async function askMetadata(prompt: Interface, defaults?: Answers): Promise<Answers> {
	const year = await askYear(prompt, defaults?.taxonomy.year[0]);
	const place = await askList(prompt, 'Place(s)', defaults?.taxonomy.place);
	const subject = await askList(prompt, 'Subject(s)', defaults?.taxonomy.subject);
	const taxonomy: PhotoTaxonomy = { year: year ? [year] : [], place, subject };
	const browse: BrowseVisibility = {
		all: await askYesNo(prompt, 'Show in All?', defaults?.browse.all ?? true),
		year: await askVisibility(prompt, 'Year', taxonomy.year, defaults?.browse.year),
		place: await askVisibility(prompt, 'Place', taxonomy.place, defaults?.browse.place),
		subject: await askVisibility(prompt, 'Subject', taxonomy.subject, defaults?.browse.subject),
	};
	const featured = await askYesNo(prompt, 'Featured?', defaults?.featured ?? false);
	return { taxonomy, browse, featured };
}

async function askYear(prompt: Interface, defaultValue?: string) {
	while (true) {
		const value = await askText(prompt, 'Year (YYYY, optional)', defaultValue);
		if (!value || /^[1-9]\d{3}$/.test(value)) return value;
		console.log('Enter a four-digit year or leave it blank.');
	}
}

async function askList(prompt: Interface, label: string, defaultValue: string[] = []) {
	const value = await askText(prompt, label, defaultValue.join(', '));
	return value
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean)
		.filter((item, index, values) => values.indexOf(item) === index);
}

async function askVisibility(
	prompt: Interface,
	label: string,
	values: string[],
	defaultValue = values.length > 0,
) {
	if (values.length === 0) {
		console.log(`Show in ${label}: no (no ${label.toLowerCase()} metadata)`);
		return false;
	}
	return askYesNo(prompt, `Show in ${label}?`, defaultValue);
}

async function askText(prompt: Interface, label: string, defaultValue = '') {
	const suffix = defaultValue ? ` [${defaultValue}]` : '';
	const answer = (await prompt.question(`${label}${suffix}: `)).trim();
	return answer || defaultValue;
}

export async function askYesNo(prompt: Interface, label: string, defaultValue: boolean) {
	const hint = defaultValue ? 'Y/n' : 'y/N';
	while (true) {
		const answer = (await prompt.question(`${label} [${hint}] `)).trim().toLowerCase();
		if (!answer) return defaultValue;
		if (answer === 'y' || answer === 'yes') return true;
		if (answer === 'n' || answer === 'no') return false;
		console.log('Please answer yes or no.');
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	});
}
