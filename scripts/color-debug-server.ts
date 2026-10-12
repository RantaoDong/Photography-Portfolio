import { promises as fs } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import { hexToRgb, scorePhotoColorMatch } from '../src/color/color-similarity.ts';
import type { PhotoColorFeatureFile } from '../src/color/color-types.ts';
import { libraryPaths, readGallerySnapshot, resolvePhotoPath } from './photo-library.ts';

const host = '127.0.0.1';
const port = Number(process.env.COLOR_DEBUG_PORT || 4176);
const debugDirectory = path.join(libraryPaths.repositoryRoot, 'color-debug');
const featuresFile = path.join(
	libraryPaths.repositoryRoot,
	'src',
	'generated',
	'photo-color-features.json',
);
const thumbnailCache = new Map<string, { modified: number; buffer: Buffer }>();

async function main() {
	const server = createServer((request, response) => {
		handleRequest(request, response).catch((error) => sendError(response, error));
	});
	server.on('error', (error) => {
		if ((error as { code?: string }).code === 'EADDRINUSE') {
			console.error(
				`Color Debug could not start because http://${host}:${port} is already in use.`,
			);
			console.error(
				'Stop the existing process, or choose another port with $env:COLOR_DEBUG_PORT=4177 before running the command.',
			);
			process.exitCode = 1;
			return;
		}
		console.error(`Color Debug server failed: ${error.message}`);
		process.exitCode = 1;
	});
	server.listen(port, host, () => {
		const url = `http://${host}:${port}`;
		console.log(`Color Debug is running at ${url}`);
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
	if (request.method !== 'GET') return sendJson(response, 405, { error: 'Method not allowed.' });
	if (url.pathname === '/api/state') return sendJson(response, 200, await createDebugState());
	if (url.pathname === '/api/matches') return sendJson(response, 200, await createMatches(url));
	if (url.pathname === '/media') return serveThumbnail(url, response);
	return serveDebugAsset(url.pathname, response);
}

async function createDebugState() {
	const [{ gallery }, generated] = await Promise.all([readGallerySnapshot(), readFeatures()]);
	return {
		schemaVersion: generated.schemaVersion,
		analysisVersion: generated.analysisVersion,
		analysis: generated.analysis,
		photos: gallery.photos.map((photo) => ({
			id: photo.id,
			imageUrl: `/media?id=${encodeURIComponent(photo.id)}`,
			features: generated.photos[photo.id] ?? null,
		})),
	};
}

async function createMatches(url: URL) {
	const color = url.searchParams.get('color') ?? '';
	const rgb = hexToRgb(color);
	const [{ gallery }, generated] = await Promise.all([readGallerySnapshot(), readFeatures()]);
	return gallery.photos
		.flatMap((photo) => {
			const features = generated.photos[photo.id];
			return features
				? [
						{
							id: photo.id,
							imageUrl: `/media?id=${encodeURIComponent(photo.id)}`,
							...scorePhotoColorMatch(rgb, features),
						},
					]
				: [];
		})
		.sort((a, b) => a.score - b.score);
}

async function readFeatures(): Promise<PhotoColorFeatureFile> {
	let content: string;
	try {
		content = await fs.readFile(featuresFile, 'utf8');
	} catch {
		throw new Error('Color features are missing. Run npm run color:analyze first.');
	}
	const value = JSON.parse(content) as PhotoColorFeatureFile;
	if (!value || !value.analysis || !value.photos || !Number.isInteger(value.schemaVersion)) {
		throw new Error('Generated color feature file has an invalid structure. Regenerate it.');
	}
	return value;
}

async function serveThumbnail(url: URL, response: ServerResponse) {
	const id = url.searchParams.get('id');
	const { gallery } = await readGallerySnapshot();
	const photo = gallery.photos.find((candidate) => candidate.id === id);
	if (!photo) return sendJson(response, 404, { error: 'Photo not found.' });
	const file = resolvePhotoPath(photo.file);
	const stat = await fs.stat(file);
	let cached = thumbnailCache.get(file);
	if (!cached || cached.modified !== stat.mtimeMs) {
		const buffer = await sharp(file)
			.rotate()
			.resize({ width: 420, height: 320, fit: 'inside', withoutEnlargement: true })
			.webp({ quality: 76 })
			.toBuffer();
		cached = { modified: stat.mtimeMs, buffer };
		thumbnailCache.set(file, cached);
	}
	response.writeHead(200, {
		'Content-Type': 'image/webp',
		'Content-Length': cached.buffer.length,
		'Cache-Control': 'private, max-age=60',
	});
	response.end(cached.buffer);
}

async function serveDebugAsset(requestPath: string, response: ServerResponse) {
	const asset = requestPath === '/' ? 'index.html' : requestPath.slice(1);
	if (!['index.html', 'app.js', 'styles.css'].includes(asset)) {
		return sendJson(response, 404, { error: 'Not found.' });
	}
	const content = await fs.readFile(path.join(debugDirectory, asset));
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
		"default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
	);
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
	const body = JSON.stringify(value);
	response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
	response.end(body);
}

function sendError(response: ServerResponse, error: unknown) {
	if (response.headersSent) return response.end();
	return sendJson(response, 500, {
		error: error instanceof Error ? error.message : 'Unexpected Color Debug error.',
	});
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
