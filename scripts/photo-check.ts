import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import {
	checkConsistency,
	libraryPaths,
	readGalleryFile,
	writeGalleryFileAtomic,
} from './photo-library.ts';
import { askYesNo } from './photo-import.ts';

async function main() {
	const gallery = await readGalleryFile();
	const report = await checkConsistency(gallery);

	console.log('Photo library consistency check\n===============================');
	if (report.missingFiles.length === 0) console.log('\nMetadata entries with missing files: none');
	else {
		console.log(`\nMetadata entries with missing files (${report.missingFiles.length}):`);
		for (const photo of report.missingFiles) console.log(`- ${photo.id}: ${photo.file}`);
	}

	if (report.orphanFiles.length === 0) console.log('\nImage files without metadata: none');
	else {
		console.log(`\nImage files without metadata (${report.orphanFiles.length}):`);
		for (const file of report.orphanFiles) console.log(`- ${file}`);
	}

	if (report.missingFiles.length === 0 && report.orphanFiles.length === 0) {
		console.log('\nEverything is synchronized.');
		return;
	}

	if (report.missingFiles.length === 0) return;
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		console.log(
			'\nNo metadata was changed. Run this command interactively to remove stale entries.',
		);
		return;
	}

	const prompt = createInterface({ input: process.stdin, output: process.stdout });
	try {
		const confirmed = await askYesNo(
			prompt,
			'\nRemove only these missing-file metadata entries?',
			false,
		);
		if (!confirmed) {
			console.log('No metadata was changed.');
			return;
		}

		const staleIds = new Set(report.missingFiles.map((photo) => photo.id));
		await writeGalleryFileAtomic(
			{ ...gallery, photos: gallery.photos.filter((photo) => !staleIds.has(photo.id)) },
			libraryPaths.metadataFile,
		);
		console.log(
			`Removed ${staleIds.size} orphaned metadata entr${staleIds.size === 1 ? 'y' : 'ies'}.`,
		);
	} finally {
		prompt.close();
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(`Check failed: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	});
}
