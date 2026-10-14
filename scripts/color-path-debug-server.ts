import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { createServer, type Connect } from 'vite';
import {
	validateColorPathTransitionParameters,
	type ColorPathTransitionParameters,
} from '../src/color/color-path-transition-config.ts';
import type { OverallColorMatchFeatures } from '../src/color/color-types.ts';
import generatedFeatures from '../src/generated/photo-color-features.json';
import { libraryPaths, readGallerySnapshot, resolvePhotoPath } from './photo-library.ts';

const host = '127.0.0.1';
const port = Number(process.env.COLOR_PATH_DEBUG_PORT || 4178);
const debugDirectory = path.join(libraryPaths.repositoryRoot, 'color-path-debug');
const transitionConfigFile = path.join(
	libraryPaths.repositoryRoot,
	'src',
	'color',
	'color-path-transition-config.ts',
);
const imageCache = new Map<string, { modified: number; buffer: Buffer }>();
const thumbnailCache = new Map<string, { modified: number; buffer: Buffer }>();

async function main() {
	const server = await createServer({
		configFile: false,
		root: debugDirectory,
		publicDir: false,
		appType: 'spa',
		server: {
			host,
			port,
			strictPort: true,
			fs: { allow: [libraryPaths.repositoryRoot] },
			watch: { ignored: [transitionConfigFile] },
		},
		plugins: [
			{
				name: 'color-path-debug-local-api',
				configureServer(viteServer) {
					viteServer.middlewares.use((request, response, next) => {
						handleLocalRequest(request, response, next).catch((error) =>
							sendJson(response, 500, {
								error:
									error instanceof Error ? error.message : 'Unexpected Color Path Debug error.',
							}),
						);
					});
				},
			},
		],
	});

	await server.listen();
	const url = `http://${host}:${port}`;
	console.log(`Color Path Debug is running at ${url}`);
	console.log('Press Ctrl+C to stop it.');
	if (!process.argv.includes('--no-open')) openBrowser(url);
}

async function handleLocalRequest(
	request: IncomingMessage,
	response: ServerResponse,
	next: Connect.NextFunction,
) {
	const url = new URL(request.url || '/', `http://${host}:${port}`);
	if (url.pathname === '/api/transition-defaults' && request.method === 'POST') {
		return updateTransitionDefaults(request, response);
	}
	if (request.method !== 'GET') return next();
	if (url.pathname === '/api/photos') {
		const { gallery } = await readGallerySnapshot();
		const features = generatedFeatures.photos as unknown as Record<
			string,
			OverallColorMatchFeatures | undefined
		>;
		return sendJson(response, 200, {
			photos: gallery.photos.flatMap((photo) => {
				const matchingFeatures = features[photo.id];
				return matchingFeatures
					? [
							{
								id: photo.id,
								label: photo.title || photo.id,
								imageUrl: `/media?id=${encodeURIComponent(photo.id)}`,
								thumbnailUrl: `/media?id=${encodeURIComponent(photo.id)}&thumbnail=1`,
								features: matchingFeatures,
							},
						]
					: [];
			}),
		});
	}
	if (url.pathname === '/media') return servePhoto(url, response);
	return next();
}

async function updateTransitionDefaults(request: IncomingMessage, response: ServerResponse) {
	if (!validateLocalJsonRequest(request, response)) return;
	const body = await readJsonBody(request);
	const parameters = validateColorPathTransitionParameters(
		readTransitionParameters(body.parameters),
	);
	const source = await fs.readFile(transitionConfigFile, 'utf8');
	const updated = replaceTransitionDefaults(source, parameters);
	await writeSourceAtomically(transitionConfigFile, updated);
	return sendJson(response, 200, { parameters });
}

function validateLocalJsonRequest(request: IncomingMessage, response: ServerResponse) {
	if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
		sendJson(response, 415, { error: 'Expected an application/json request.' });
		return false;
	}
	const origin = request.headers.origin;
	if (origin && origin !== `http://${host}:${port}`) {
		sendJson(response, 403, { error: 'Cross-origin updates are not allowed.' });
		return false;
	}
	return true;
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

function readTransitionParameters(value: unknown): ColorPathTransitionParameters {
	if (!value || typeof value !== 'object') throw new Error('Transition parameters are required.');
	const candidate = value as Record<string, unknown>;
	return {
		totalDurationMs: readNumber(candidate.totalDurationMs, 'totalDurationMs'),
		maximumBlurRadius: readNumber(candidate.maximumBlurRadius, 'maximumBlurRadius'),
		colorBiasStrength: readNumber(candidate.colorBiasStrength, 'colorBiasStrength'),
		grainAmount: readNumber(candidate.grainAmount, 'grainAmount'),
		grainScale: readNumber(candidate.grainScale, 'grainScale'),
		abstractHold: readNumber(candidate.abstractHold, 'abstractHold'),
		revealStart: readNumber(candidate.revealStart, 'revealStart'),
		spreadIrregularity: readNumber(candidate.spreadIrregularity, 'spreadIrregularity'),
		spreadSoftness: readNumber(candidate.spreadSoftness, 'spreadSoftness'),
		maximumRenderDimension: readNumber(candidate.maximumRenderDimension, 'maximumRenderDimension'),
	};
}

function readNumber(value: unknown, label: string) {
	if (typeof value !== 'number') throw new Error(`${label} must be a number.`);
	return value;
}

async function writeSourceAtomically(file: string, source: string) {
	const temporaryFile = `${file}.tmp-${randomUUID()}`;
	try {
		await fs.writeFile(temporaryFile, source, { encoding: 'utf8', flag: 'wx' });
		await fs.rename(temporaryFile, file);
	} finally {
		await fs.rm(temporaryFile, { force: true });
	}
}

export function replaceTransitionDefaults(
	source: string,
	parameters: ColorPathTransitionParameters,
) {
	const pattern =
		/export const colorPathTransitionDefaults: ColorPathTransitionParameters = \{[\s\S]*?\n\};/;
	if (!pattern.test(source)) throw new Error('Could not locate Color Path transition defaults.');
	const replacement = [
		'export const colorPathTransitionDefaults: ColorPathTransitionParameters = {',
		`\ttotalDurationMs: ${formatNumber(parameters.totalDurationMs)},`,
		`\tmaximumBlurRadius: ${formatNumber(parameters.maximumBlurRadius)},`,
		`\tcolorBiasStrength: ${formatNumber(parameters.colorBiasStrength)},`,
		`\tgrainAmount: ${formatNumber(parameters.grainAmount)},`,
		`\tgrainScale: ${formatNumber(parameters.grainScale)},`,
		`\tabstractHold: ${formatNumber(parameters.abstractHold)},`,
		`\trevealStart: ${formatNumber(parameters.revealStart)},`,
		`\tspreadIrregularity: ${formatNumber(parameters.spreadIrregularity)},`,
		`\tspreadSoftness: ${formatNumber(parameters.spreadSoftness)},`,
		`\tmaximumRenderDimension: ${formatNumber(parameters.maximumRenderDimension)},`,
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
	const { gallery } = await readGallerySnapshot();
	const photo = gallery.photos.find((candidate) => candidate.id === id);
	if (!photo) return sendJson(response, 404, { error: 'Photo not found.' });
	const file = resolvePhotoPath(photo.file);
	const stat = await fs.stat(file);
	const cache = thumbnail ? thumbnailCache : imageCache;
	let cached = cache.get(file);
	if (!cached || cached.modified !== stat.mtimeMs) {
		const maximum = thumbnail ? 240 : 1440;
		const buffer = await sharp(file)
			.rotate()
			.resize({ width: maximum, height: maximum, fit: 'inside', withoutEnlargement: true })
			.webp({ quality: thumbnail ? 74 : 84 })
			.toBuffer();
		cached = { modified: stat.mtimeMs, buffer };
		cache.set(file, cached);
	}
	response.writeHead(200, {
		'Content-Type': 'image/webp',
		'Content-Length': cached.buffer.length,
		'Cache-Control': 'private, max-age=60',
		'X-Content-Type-Options': 'nosniff',
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
