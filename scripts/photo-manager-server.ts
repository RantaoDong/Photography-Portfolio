import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import type { GalleryPhoto } from '../src/data/galleryData.ts';
import {
	checkConsistency,
	commitImport,
	commitFeaturedOrder,
	commitPhotoUpdate,
	commitRemoval,
	deriveMetadataOptions,
	findIncomingPhotos,
	GalleryConflictError,
	libraryPaths,
	listPhotoFiles,
	nextPhotoNumber,
	readGallerySnapshot,
	resolvePhotoPath,
	validateGallery,
	writeGalleryFileAtomic,
	type ImportPlan,
	type PhotoMetadataUpdate,
} from './photo-library.ts';

const host = '127.0.0.1';
const port = Number(process.env.PHOTO_MANAGER_PORT || 4175);
const managerDirectory = path.join(libraryPaths.repositoryRoot, 'photo-manager');
const sessionToken = randomBytes(24).toString('hex');
const thumbnailCache = new Map<string, { modified: number; buffer: Buffer }>();
let mutationQueue = Promise.resolve<unknown>(undefined);

async function main() {
	const server = createServer((request, response) => {
		handleRequest(request, response).catch((error) => sendError(response, error));
	});

	server.listen(port, host, () => {
		const url = `http://${host}:${port}`;
		console.log(`Photo Manager is running at ${url}`);
		console.log('Press Ctrl+C to stop it.');
		if (!process.argv.includes('--no-open')) openBrowser(url);
	});

	for (const signal of ['SIGINT', 'SIGTERM'] as const) {
		process.on(signal, () => server.close(() => process.exit(0)));
	}
}

async function handleRequest(request: IncomingMessage, response: ServerResponse) {
	const url = new URL(request.url || '/', `http://${host}:${port}`);
	setSecurityHeaders(response);

	if (request.method === 'GET' && url.pathname === '/api/state') {
		return sendJson(response, 200, await createManagerState());
	}
	if (request.method === 'GET' && url.pathname === '/media') {
		return serveImage(url, response);
	}
	if (request.method === 'POST' && url.pathname.startsWith('/api/')) {
		if (request.headers['x-photo-manager-token'] !== sessionToken)
			return sendJson(response, 403, { error: 'Invalid manager session token.' });
		const body = await readJsonBody(request);
		return enqueueMutation(async () => {
			if (url.pathname === '/api/update') return updatePhotos(body, response);
			if (url.pathname === '/api/featured-order') return updateFeaturedOrder(body, response);
			if (url.pathname === '/api/import') return importPhotos(body, response);
			if (url.pathname === '/api/delete') return deletePhotos(body, response);
			if (url.pathname === '/api/remove-missing-metadata')
				return removeMissingMetadata(body, response);
			return sendJson(response, 404, { error: 'Unknown API route.' });
		});
	}
	if (request.method === 'GET') return serveManagerAsset(url.pathname, response);
	return sendJson(response, 405, { error: 'Method not allowed.' });
}

async function updateFeaturedOrder(body: unknown, response: ServerResponse) {
	const input = asRecord(body);
	const ids = asStringArray(input.ids, 'ids');
	const revision = asString(input.revision, 'revision');
	await commitFeaturedOrder(ids, revision);
	return sendJson(response, 200, await createManagerState());
}

async function createManagerState() {
	const { gallery, revision } = await readGallerySnapshot(libraryPaths.metadataFile, false);
	const consistency = await checkConsistency(gallery);
	const incoming = await findIncomingPhotos();
	return {
		revision,
		photos: gallery.photos.map((photo) => ({
			...photo,
			imageUrl: `/media?kind=photo&file=${encodeURIComponent(photo.file)}&size=thumb`,
			previewUrl: `/media?kind=photo&file=${encodeURIComponent(photo.file)}&size=preview`,
		})),
		incoming: incoming.map((file) => ({
			name: path.basename(file),
			imageUrl: `/media?kind=incoming&file=${encodeURIComponent(path.basename(file))}&size=thumb`,
			previewUrl: `/media?kind=incoming&file=${encodeURIComponent(path.basename(file))}&size=preview`,
		})),
		options: deriveMetadataOptions(gallery),
		consistency: {
			missingFiles: consistency.missingFiles.map(({ id, file }) => ({ id, file })),
			orphanFiles: consistency.orphanFiles,
			duplicateIds: consistency.duplicateIds,
			duplicateFiles: consistency.duplicateFiles,
		},
	};
}

async function updatePhotos(body: unknown, response: ServerResponse) {
	const input = asRecord(body);
	const ids = asStringArray(input.ids, 'ids');
	const revision = asString(input.revision, 'revision');
	const update = normalizeUpdate(input.update);
	await commitPhotoUpdate(ids, update, revision);
	return sendJson(response, 200, await createManagerState());
}

async function importPhotos(body: unknown, response: ServerResponse) {
	const input = asRecord(body);
	const revision = asString(input.revision, 'revision');
	const items = asArray(input.items, 'items');
	if (items.length === 0) throw new Error('Select at least one incoming photograph.');

	const snapshot = await readGallerySnapshot();
	if (snapshot.revision !== revision) throw new GalleryConflictError();
	const incoming = new Map(
		(await findIncomingPhotos()).map((file) => [path.basename(file), file] as const),
	);
	const startNumber = nextPhotoNumber(snapshot.gallery, await listPhotoFiles());
	const plans: ImportPlan[] = items.map((rawItem, index) => {
		const item = asRecord(rawItem);
		const name = asString(item.name, 'item.name');
		const source = incoming.get(name);
		if (!source) throw new Error(`Incoming file is no longer available: ${name}`);
		const id = `photo-${String(startNumber + index).padStart(4, '0')}`;
		const fileName = `${id}.jpg`;
		return {
			source,
			id,
			fileName,
			photo: createPhoto(id, fileName, item.metadata),
		};
	});

	await commitImport(plans, snapshot.gallery, libraryPaths, snapshot.revision);
	return sendJson(response, 200, await createManagerState());
}

async function deletePhotos(body: unknown, response: ServerResponse) {
	const input = asRecord(body);
	if (input.confirm !== true) throw new Error('Deletion requires explicit confirmation.');
	const ids = asStringArray(input.ids, 'ids');
	const revision = asString(input.revision, 'revision');
	const snapshot = await readGallerySnapshot();
	if (snapshot.revision !== revision) throw new GalleryConflictError();
	const photosById = new Map(snapshot.gallery.photos.map((photo) => [photo.id, photo]));
	const photos = ids.map((id) => {
		const photo = photosById.get(id);
		if (!photo) throw new Error(`Unknown photo ID: ${id}`);
		return photo;
	});
	await commitRemoval(photos, snapshot.gallery, libraryPaths, snapshot.revision);
	return sendJson(response, 200, await createManagerState());
}

async function removeMissingMetadata(body: unknown, response: ServerResponse) {
	const input = asRecord(body);
	if (input.confirm !== true) throw new Error('Metadata removal requires explicit confirmation.');
	const ids = new Set(asStringArray(input.ids, 'ids'));
	const revision = asString(input.revision, 'revision');
	const snapshot = await readGallerySnapshot(libraryPaths.metadataFile, false);
	if (snapshot.revision !== revision) throw new GalleryConflictError();
	const report = await checkConsistency(snapshot.gallery);
	const removable = new Set(report.missingFiles.map((photo) => photo.id));
	for (const id of ids) {
		if (!removable.has(id)) throw new Error(`${id} is not a missing-file metadata entry.`);
	}
	const gallery = {
		...snapshot.gallery,
		photos: snapshot.gallery.photos.filter((photo) => !ids.has(photo.id)),
	};
	validateGallery(gallery);
	await writeGalleryFileAtomic(gallery, libraryPaths.metadataFile, snapshot.revision);
	return sendJson(response, 200, await createManagerState());
}

function createPhoto(id: string, fileName: string, value: unknown): GalleryPhoto {
	const metadata = asRecord(value);
	const year = optionalString(metadata.year, 'metadata.year');
	const place = optionalString(metadata.place, 'metadata.place');
	const subjects = cleanValues(asStringArray(metadata.subjects ?? [], 'metadata.subjects'));
	const browse = asRecord(metadata.browse);
	const photo: GalleryPhoto = {
		id,
		file: `photos/${fileName}`,
		taxonomy: {
			year: year ? [year] : [],
			place: place ? [place] : [],
			subject: subjects,
		},
		browse: {
			all: asBoolean(browse.all, 'browse.all'),
			year: asBoolean(browse.year, 'browse.year'),
			place: asBoolean(browse.place, 'browse.place'),
			subject: asBoolean(browse.subject, 'browse.subject'),
		},
		featured: asBoolean(metadata.featured, 'metadata.featured'),
		published: asBoolean(metadata.published, 'metadata.published'),
		technical: {},
		features: {},
	};
	return photo;
}

function normalizeUpdate(value: unknown): PhotoMetadataUpdate {
	const input = asRecord(value);
	const update: PhotoMetadataUpdate = {};
	if ('year' in input) update.year = optionalString(input.year, 'update.year');
	if ('place' in input) update.place = optionalString(input.place, 'update.place');
	if ('featured' in input) update.featured = asBoolean(input.featured, 'update.featured');
	if ('published' in input) update.published = asBoolean(input.published, 'update.published');
	if ('browse' in input) {
		const browse = asRecord(input.browse);
		update.browse = {};
		for (const dimension of ['all', 'year', 'place', 'subject'] as const) {
			if (dimension in browse)
				update.browse[dimension] = asBoolean(browse[dimension], `browse.${dimension}`);
		}
	}
	if ('subjects' in input) {
		const subjects = asRecord(input.subjects);
		const operation = asString(subjects.operation, 'subjects.operation');
		if (!['add', 'remove', 'replace'].includes(operation))
			throw new Error('Subject operation must be add, remove, or replace.');
		update.subjects = {
			operation: operation as 'add' | 'remove' | 'replace',
			values: cleanValues(asStringArray(subjects.values, 'subjects.values')),
		};
	}
	if (Object.keys(update).length === 0) throw new Error('Choose at least one field to update.');
	return update;
}

async function serveImage(url: URL, response: ServerResponse) {
	const kind = url.searchParams.get('kind');
	const requested = url.searchParams.get('file');
	if (!requested) throw new Error('Missing image filename.');
	let file: string;
	if (kind === 'photo') {
		const { gallery } = await readGallerySnapshot(libraryPaths.metadataFile, false);
		const photo = gallery.photos.find((candidate) => candidate.file === requested);
		if (!photo) return sendJson(response, 404, { error: 'Photo not found.' });
		file = resolvePhotoPath(photo.file);
	} else if (kind === 'incoming') {
		const match = (await findIncomingPhotos()).find(
			(candidate) => path.basename(candidate) === requested,
		);
		if (!match) return sendJson(response, 404, { error: 'Incoming photo not found.' });
		file = match;
	} else return sendJson(response, 400, { error: 'Invalid image kind.' });

	const width = url.searchParams.get('size') === 'preview' ? 1200 : 480;
	const stat = await fs.stat(file);
	const cacheKey = `${file}:${width}`;
	let cached = thumbnailCache.get(cacheKey);
	if (!cached || cached.modified !== stat.mtimeMs) {
		const buffer = await sharp(file)
			.rotate()
			.resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
			.webp({ quality: 76 })
			.toBuffer();
		cached = { modified: stat.mtimeMs, buffer };
		thumbnailCache.set(cacheKey, cached);
	}
	response.writeHead(200, {
		'Content-Type': 'image/webp',
		'Content-Length': cached.buffer.length,
		'Cache-Control': 'private, max-age=60',
	});
	response.end(cached.buffer);
}

async function serveManagerAsset(requestPath: string, response: ServerResponse) {
	const asset = requestPath === '/' ? 'index.html' : requestPath.slice(1);
	if (!['index.html', 'app.js', 'styles.css'].includes(asset))
		return sendJson(response, 404, { error: 'Not found.' });
	let content = await fs.readFile(path.join(managerDirectory, asset));
	if (asset === 'index.html')
		content = Buffer.from(content.toString('utf8').replace('__MANAGER_TOKEN__', sessionToken));
	const type = asset.endsWith('.html')
		? 'text/html; charset=utf-8'
		: asset.endsWith('.js')
			? 'text/javascript; charset=utf-8'
			: 'text/css; charset=utf-8';
	response.writeHead(200, { 'Content-Type': type, 'Content-Length': content.length });
	response.end(content);
}

function setSecurityHeaders(response: ServerResponse) {
	response.setHeader('Cache-Control', 'no-store');
	response.setHeader('X-Content-Type-Options', 'nosniff');
	response.setHeader('X-Frame-Options', 'DENY');
	response.setHeader(
		'Content-Security-Policy',
		"default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
	);
}

async function readJsonBody(request: IncomingMessage) {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		const buffer = Buffer.from(chunk);
		size += buffer.length;
		if (size > 1_000_000) throw new Error('Request body is too large.');
		chunks.push(buffer);
	}
	return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function enqueueMutation<T>(task: () => Promise<T>) {
	const result = mutationQueue.then(task, task);
	mutationQueue = result.then(
		() => undefined,
		() => undefined,
	);
	return result;
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
	const body = JSON.stringify(value);
	response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
	response.end(body);
}

function sendError(response: ServerResponse, error: unknown) {
	if (response.headersSent) return response.end();
	const status = error instanceof GalleryConflictError ? 409 : 400;
	return sendJson(response, status, {
		error: error instanceof Error ? error.message : 'Unexpected manager error.',
	});
}

function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new Error('Expected an object.');
	return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): unknown[] {
	if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
	return value;
}

function asString(value: unknown, label: string) {
	if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a string.`);
	return value.trim();
}

function optionalString(value: unknown, label: string) {
	if (value === null || value === '') return null;
	return asString(value, label);
}

function asStringArray(value: unknown, label: string) {
	return asArray(value, label).map((item) => asString(item, label));
}

function asBoolean(value: unknown, label: string) {
	if (typeof value !== 'boolean') throw new Error(`${label} must be true or false.`);
	return value;
}

function cleanValues(values: string[]) {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function openBrowser(url: string) {
	try {
		const command =
			process.platform === 'win32'
				? { file: 'cmd.exe', args: ['/c', 'start', '', url] }
				: process.platform === 'darwin'
					? { file: 'open', args: [url] }
					: { file: 'xdg-open', args: [url] };
		const child = spawn(command.file, command.args, {
			detached: true,
			stdio: 'ignore',
			windowsHide: true,
		});
		child.unref();
	} catch (error) {
		console.warn(`Could not open the browser automatically: ${String(error)}`);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
