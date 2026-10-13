import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { createServer, type Connect } from 'vite';
import {
	colorWalkConfig,
	validateColorWalkRenderingParameters,
	type ColorWalkRenderingParameters,
} from '../src/color/color-walk-config.ts';
import { libraryPaths, readGallerySnapshot, resolvePhotoPath } from './photo-library.ts';

const host = '127.0.0.1';
const port = Number(process.env.COLOR_WALK_TUNER_PORT || 4177);
const tunerDirectory = path.join(libraryPaths.repositoryRoot, 'color-walk-tuner');
const colorWalkConfigFile = path.join(
	libraryPaths.repositoryRoot,
	'src',
	'color',
	'color-walk-config.ts',
);
const imageCache = new Map<string, { modified: number; buffer: Buffer }>();
const thumbnailCache = new Map<string, { modified: number; buffer: Buffer }>();
const gallerySnapshot = readGallerySnapshot();

async function main() {
	const server = await createServer({
		configFile: false,
		root: tunerDirectory,
		publicDir: false,
		appType: 'spa',
		server: {
			host,
			port,
			strictPort: true,
			fs: { allow: [libraryPaths.repositoryRoot] },
		},
		plugins: [
			{
				name: 'color-walk-tuner-local-api',
				configureServer(viteServer) {
					viteServer.middlewares.use((request, response, next) => {
						handleLocalRequest(request, response, next).catch((error) =>
							sendJson(response, 500, {
								error:
									error instanceof Error ? error.message : 'Unexpected Color Walk tuner error.',
							}),
						);
					});
				},
			},
		],
	});

	await server.listen();
	const url = `http://${host}:${port}`;
	console.log(`Color Walk Effect Tuner is running at ${url}`);
	console.log('Press Ctrl+C to stop it.');
	if (!process.argv.includes('--no-open')) openBrowser(url);
}

async function handleLocalRequest(
	request: IncomingMessage,
	response: ServerResponse,
	next: Connect.NextFunction,
) {
	const url = new URL(request.url || '/', `http://${host}:${port}`);
	if (url.pathname === '/api/defaults' && request.method === 'POST') {
		return updatePublicDefaults(request, response);
	}
	if (request.method !== 'GET') return next();
	if (url.pathname === '/api/photos') {
		const { gallery } = await gallerySnapshot;
		return sendJson(response, 200, {
			photos: gallery.photos.map((photo) => ({
				id: photo.id,
				label: photo.title || photo.id,
				imageUrl: `/media?id=${encodeURIComponent(photo.id)}`,
				thumbnailUrl: `/media?id=${encodeURIComponent(photo.id)}&thumbnail=1`,
			})),
		});
	}
	if (url.pathname === '/media') return servePhoto(url, response);
	return next();
}

async function updatePublicDefaults(request: IncomingMessage, response: ServerResponse) {
	if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
		return sendJson(response, 415, { error: 'Expected an application/json request.' });
	}
	const origin = request.headers.origin;
	if (origin && origin !== `http://${host}:${port}`) {
		return sendJson(response, 403, { error: 'Cross-origin updates are not allowed.' });
	}

	const body = await readJsonBody(request);
	const parameters = validateColorWalkRenderingParameters(readRenderingParameters(body.parameters));
	const source = await fs.readFile(colorWalkConfigFile, 'utf8');
	const updated = replaceRenderingDefaults(source, parameters);
	const temporaryFile = `${colorWalkConfigFile}.tmp-${randomUUID()}`;
	try {
		await fs.writeFile(temporaryFile, updated, { encoding: 'utf8', flag: 'wx' });
		await fs.rename(temporaryFile, colorWalkConfigFile);
	} finally {
		await fs.rm(temporaryFile, { force: true });
	}
	return sendJson(response, 200, { parameters });
}

function readRenderingParameters(value: unknown): ColorWalkRenderingParameters {
	if (!value || typeof value !== 'object') throw new Error('Rendering parameters are required.');
	const candidate = value as Record<string, unknown>;
	return {
		refinementMode: readRefinementMode(candidate.refinementMode),
		preserveRadius: readNumber(candidate.preserveRadius, 'preserveRadius'),
		fadeEnd: readNumber(candidate.fadeEnd, 'fadeEnd'),
		falloffSteepness: readNumber(candidate.falloffSteepness, 'falloffSteepness'),
		minimumSaturationRetention: readNumber(
			candidate.minimumSaturationRetention,
			'minimumSaturationRetention',
		),
		minimumBrightnessRetention: readNumber(
			candidate.minimumBrightnessRetention,
			'minimumBrightnessRetention',
		),
		regionSmoothing: readNumber(candidate.regionSmoothing, 'regionSmoothing'),
		edgeSensitivity: readNumber(candidate.edgeSensitivity, 'edgeSensitivity'),
		regionSupport: readNumber(candidate.regionSupport, 'regionSupport'),
	};
}

function readRefinementMode(value: unknown) {
	if (value !== 'pixel' && value !== 'edge-aware') {
		throw new Error('refinementMode must be pixel or edge-aware.');
	}
	return value;
}

function readNumber(value: unknown, label: string) {
	if (typeof value !== 'number') throw new Error(`${label} must be a number.`);
	return value;
}

async function readJsonBody(request: IncomingMessage) {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.length;
		if (size > 16_384) throw new Error('Request body is too large.');
		chunks.push(buffer);
	}
	return JSON.parse(Buffer.concat(chunks).toString('utf8')) as { parameters?: unknown };
}

export function replaceRenderingDefaults(source: string, parameters: ColorWalkRenderingParameters) {
	const pattern =
		/export const colorWalkRenderingDefaults: ColorWalkRenderingParameters = \{[\s\S]*?\n\};/;
	if (!pattern.test(source)) throw new Error('Could not locate Color Walk rendering defaults.');
	const replacement = [
		'export const colorWalkRenderingDefaults: ColorWalkRenderingParameters = {',
		`\trefinementMode: '${parameters.refinementMode}',`,
		`\tpreserveRadius: ${formatNumber(parameters.preserveRadius)},`,
		`\tfadeEnd: ${formatNumber(parameters.fadeEnd)},`,
		`\tfalloffSteepness: ${formatNumber(parameters.falloffSteepness)},`,
		`\tminimumSaturationRetention: ${formatNumber(parameters.minimumSaturationRetention)},`,
		`\tminimumBrightnessRetention: ${formatNumber(parameters.minimumBrightnessRetention)},`,
		`\tregionSmoothing: ${formatNumber(parameters.regionSmoothing)},`,
		`\tedgeSensitivity: ${formatNumber(parameters.edgeSensitivity)},`,
		`\tregionSupport: ${formatNumber(parameters.regionSupport)},`,
		'};',
	].join('\n');
	return source.replace(pattern, replacement);
}

function formatNumber(value: number) {
	return String(Math.round(value * 10_000) / 10_000);
}

async function servePhoto(url: URL, response: ServerResponse) {
	const id = url.searchParams.get('id');
	const thumbnail = url.searchParams.get('thumbnail') === '1';
	const { gallery } = await gallerySnapshot;
	const photo = gallery.photos.find((candidate) => candidate.id === id);
	if (!photo) return sendJson(response, 404, { error: 'Photo not found.' });
	const file = resolvePhotoPath(photo.file);
	const stat = await fs.stat(file);
	const cache = thumbnail ? thumbnailCache : imageCache;
	let cached = cache.get(file);
	if (!cached || cached.modified !== stat.mtimeMs) {
		const maximum = thumbnail ? 180 : colorWalkConfig.rendering.maxProcessingDimension;
		const buffer = await sharp(file)
			.rotate()
			.resize({ width: maximum, height: maximum, fit: 'inside', withoutEnlargement: true })
			.webp({ quality: thumbnail ? 72 : colorWalkConfig.rendering.imageQuality })
			.toBuffer();
		cached = { modified: stat.mtimeMs, buffer };
		cache.set(file, cached);
	}
	response.writeHead(200, {
		'Content-Type': 'image/webp',
		'Content-Length': cached.buffer.length,
		'Cache-Control': 'private, max-age=60',
	});
	response.end(cached.buffer);
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
	const body = JSON.stringify(value);
	response.writeHead(status, {
		'Content-Type': 'application/json; charset=utf-8',
		'Cache-Control': 'no-store',
		'X-Content-Type-Options': 'nosniff',
		'X-Frame-Options': 'DENY',
	});
	response.end(body);
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
