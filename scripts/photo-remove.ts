import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { commitRemoval, formatPhoto, readGalleryFile } from './photo-library.ts';
import { askYesNo } from './photo-import.ts';

async function main() {
	if (!process.stdin.isTTY || !process.stdout.isTTY)
		throw new Error('Photo removal requires an interactive terminal.');

	const gallery = await readGalleryFile();
	const prompt = createInterface({ input: process.stdin, output: process.stdout });
	try {
		const requested = process.argv.slice(2);
		if (requested.length === 0) {
			console.log('Available photos:');
			for (const photo of gallery.photos) console.log(`- ${photo.id}: ${photo.file}`);
			console.log('');
		}
		const input =
			requested.length > 0
				? requested.join(',')
				: await prompt.question('Photo IDs to remove (comma-separated): ');
		const ids = [
			...new Set(
				input
					.split(',')
					.map((id) => id.trim())
					.filter(Boolean),
			),
		];
		if (ids.length === 0) {
			console.log('No photo IDs selected. Nothing was changed.');
			return;
		}

		const photosById = new Map(gallery.photos.map((photo) => [photo.id, photo]));
		const unknown = ids.filter((id) => !photosById.has(id));
		if (unknown.length > 0) throw new Error(`Unknown photo ID(s): ${unknown.join(', ')}`);
		const selected = ids.map((id) => photosById.get(id)!);

		console.log('\nRemoval preview\n===============');
		for (const photo of selected) {
			console.log(`\n${photo.id}`);
			console.log(`Image: ${photo.file}`);
			console.log(formatPhoto(photo));
		}

		const confirmed = await askYesNo(
			prompt,
			`\nPermanently remove ${selected.length} image file(s) and metadata entr${selected.length === 1 ? 'y' : 'ies'}?`,
			false,
		);
		if (!confirmed) {
			console.log('Removal cancelled. Nothing was changed.');
			return;
		}

		await commitRemoval(selected, gallery);
		console.log(`Removed ${selected.length} photo(s) and their metadata successfully.`);
	} finally {
		prompt.close();
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(`Removal failed: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	});
}
