import { colorPathConfig } from '../src/color/color-path-config.ts';
import {
	colorPathTransitionDefaults,
	type ColorPathTransitionParameters,
} from '../src/color/color-path-transition-config.ts';
import {
	createColorPathSequence,
	type ColorPathSequenceEntry,
} from '../src/color/color-path-sequencing.ts';
import {
	ColorPathImagePreloader,
	createColorPathTransitionRenderer,
	type ColorPathTransitionDirection,
	type ColorPathTransitionRenderer,
} from '../src/color/color-path-transition.ts';
import {
	colorPathPointToRgb,
	interpolateColorPath,
	type ColorPathPoint,
} from '../src/color/color-path.ts';
import type { ColorToneCandidate } from '../src/color/color-tone-matching.ts';
import type { RgbColor } from '../src/color/color-types.ts';

interface DebugPhoto extends ColorToneCandidate {
	label: string;
	imageUrl: string;
	thumbnailUrl: string;
}

interface ActiveEntry extends ColorPathSequenceEntry {
	photo: DebugPhoto;
	color: RgbColor;
}

interface ParameterDefinition {
	key:
		| 'totalDurationMs'
		| 'maximumBlurRadius'
		| 'colorBiasStrength'
		| 'grainAmount'
		| 'grainScale'
		| 'spreadIrregularity'
		| 'spreadSoftness'
		| 'abstractHold'
		| 'revealStart';
	label: string;
	minimum: number;
	maximum: number;
	step: number;
	format(value: number): string;
}

const parameterDefinitions: ParameterDefinition[] = [
	{
		key: 'totalDurationMs',
		label: 'Transition duration',
		minimum: 180,
		maximum: 1600,
		step: 20,
		format: (value) => `${Math.round(value)} ms`,
	},
	{
		key: 'abstractHold',
		label: 'Abstract hold',
		minimum: 0.2,
		maximum: 0.62,
		step: 0.01,
		format: (value) => `${Math.round(value * 100)}%`,
	},
	{
		key: 'revealStart',
		label: 'Reveal start',
		minimum: 0.72,
		maximum: 0.92,
		step: 0.01,
		format: (value) => `${Math.round(value * 100)}%`,
	},
	{
		key: 'maximumBlurRadius',
		label: 'Detail loss',
		minimum: 4,
		maximum: 80,
		step: 1,
		format: (value) => `${Math.round(value)} px`,
	},
	{
		key: 'colorBiasStrength',
		label: 'Color pull',
		minimum: 0,
		maximum: 0.55,
		step: 0.01,
		format: (value) => `${Math.round(value * 100)}%`,
	},
	{
		key: 'grainAmount',
		label: 'Grain amount',
		minimum: 0,
		maximum: 0.25,
		step: 0.005,
		format: (value) => `${Math.round(value * 100)}%`,
	},
	{
		key: 'grainScale',
		label: 'Grain scale',
		minimum: 1,
		maximum: 8,
		step: 0.5,
		format: (value) => value.toFixed(1),
	},
	{
		key: 'spreadIrregularity',
		label: 'Spread irregularity',
		minimum: 0,
		maximum: 1,
		step: 0.01,
		format: (value) => `${Math.round(value * 100)}%`,
	},
	{
		key: 'spreadSoftness',
		label: 'Spread softness',
		minimum: 0.01,
		maximum: 0.4,
		step: 0.01,
		format: (value) => `${Math.round(value * 100)}%`,
	},
];

const status = requiredElement<HTMLElement>('status');
const disk = requiredElement<HTMLCanvasElement>('color-path-disk');
const guidance = requiredElement<HTMLElement>('path-guidance');
const undoButton = requiredElement<HTMLButtonElement>('undo-point');
const resetPathButton = requiredElement<HTMLButtonElement>('reset-path');
const generateButton = requiredElement<HTMLButtonElement>('generate-sequence');
const sequenceSummary = requiredElement<HTMLElement>('sequence-summary');
const sequenceList = requiredElement<HTMLElement>('sequence-list');
const pairDescription = requiredElement<HTMLElement>('pair-description');
const playButton = requiredElement<HTMLButtonElement>('play-transition');
const forwardButton = requiredElement<HTMLButtonElement>('direction-forward');
const reverseButton = requiredElement<HTMLButtonElement>('direction-reverse');
const stagePlaceholder = requiredElement<HTMLElement>('stage-placeholder');
const transitionCanvas = requiredElement<HTMLCanvasElement>('transition-canvas');
const timeline = requiredElement<HTMLInputElement>('timeline-range');
const timelineValue = requiredElement<HTMLOutputElement>('timeline-value');
const timelineStartLabel = requiredElement<HTMLElement>('timeline-start-label');
const timelineEndLabel = requiredElement<HTMLElement>('timeline-end-label');
const controls = requiredElement<HTMLElement>('parameter-controls');
const values = requiredElement<HTMLElement>('parameter-values');
const resetParametersButton = requiredElement<HTMLButtonElement>('reset-parameters');
const saveDefaultsButton = requiredElement<HTMLButtonElement>('save-defaults');
const saveStatus = requiredElement<HTMLElement>('save-status');

let photos: DebugPhoto[] = [];
let points: ColorPathPoint[] = [];
let sequence: ActiveEntry[] = [];
let selectedPairIndex: number | null = null;
let renderer: ColorPathTransitionRenderer | null = null;
let savedDefaults: ColorPathTransitionParameters = { ...colorPathTransitionDefaults };
let parameters: ColorPathTransitionParameters = { ...savedDefaults };
let direction: ColorPathTransitionDirection = 'forward';
let setupRevision = 0;
let playing = false;
let playRevision = 0;
const preloader = new ColorPathImagePreloader();

drawDisk();
renderParameterControls();
updatePathControls();
void loadPhotos();

disk.addEventListener('pointerdown', (event) => {
	if (event.button !== 0 || points.length >= colorPathConfig.controlPoints.maximum) return;
	const point = pointFromPointer(event);
	if (!point) return;
	event.preventDefault();
	points = [...points, point];
	clearGeneratedSequence();
	drawDisk();
	updatePathControls();
});

undoButton.addEventListener('click', () => {
	points = points.slice(0, -1);
	clearGeneratedSequence();
	drawDisk();
	updatePathControls();
});

resetPathButton.addEventListener('click', () => {
	points = [];
	clearGeneratedSequence();
	drawDisk();
	updatePathControls();
	disk.focus();
});

generateButton.addEventListener('click', generateSequence);

timeline.addEventListener('input', () => {
	stopPlayback();
	renderProgress(Number(timeline.value) / 100);
});

playButton.addEventListener('click', () => {
	if (!renderer || playing) return;
	void playTransition();
});

forwardButton.addEventListener('click', () => setDirection('forward'));
reverseButton.addEventListener('click', () => setDirection('reverse'));

resetParametersButton.addEventListener('click', () => {
	parameters = { ...savedDefaults };
	renderParameterControls();
	renderProgress(Number(timeline.value) / 100);
});

saveDefaultsButton.addEventListener('click', () => void saveDefaults());

async function loadPhotos() {
	try {
		const response = await fetch('/api/photos');
		if (!response.ok) throw new Error(`Photo request failed (${response.status}).`);
		const data = (await response.json()) as { photos: DebugPhoto[] };
		photos = data.photos;
		status.textContent = `${photos.length} analyzed photographs · local only`;
		updatePathControls();
	} catch (error) {
		status.textContent = error instanceof Error ? error.message : 'Could not load photographs.';
	}
}

function generateSequence() {
	if (points.length < colorPathConfig.controlPoints.minimum || photos.length === 0) return;
	const photosById = new Map(photos.map((photo) => [photo.id, photo]));
	sequence = createColorPathSequence(photos, points).flatMap((entry) => {
		const photo = photosById.get(entry.id);
		return photo
			? [
					{
						...entry,
						photo,
						color: colorAtPosition(entry.pathPosition),
					},
				]
			: [];
	});
	selectedPairIndex = sequence.length > 1 ? 0 : null;
	renderSequence();
	drawDisk();
	if (selectedPairIndex !== null) void selectPair(selectedPairIndex);
}

function renderSequence() {
	sequenceList.replaceChildren();
	sequenceList.classList.toggle('empty-state', sequence.length === 0);
	if (sequence.length === 0) {
		const message = document.createElement('p');
		message.textContent = 'No photographs matched this path.';
		sequenceList.append(message);
		sequenceSummary.textContent = 'The real sequencer returned no results.';
		return;
	}
	sequenceSummary.textContent = `${sequence.length} photographs · select an arrow to inspect an adjacent transition.`;
	sequence.forEach((entry, index) => {
		const wrapper = document.createElement('div');
		wrapper.className = 'sequence-item';
		wrapper.append(createSequenceCard(entry, index));
		if (index < sequence.length - 1) wrapper.append(createPairButton(index));
		sequenceList.append(wrapper);
	});
}

function createSequenceCard(entry: ActiveEntry, index: number) {
	const card = document.createElement('article');
	card.className = 'sequence-card';
	const image = document.createElement('img');
	image.src = entry.photo.thumbnailUrl;
	image.alt = entry.photo.label;
	image.loading = 'lazy';
	const meta = document.createElement('div');
	meta.className = 'sequence-meta';
	const title = document.createElement('strong');
	title.textContent = `${String(index + 1).padStart(2, '0')} · ${entry.id}`;
	meta.append(
		title,
		metaLine('path', entry.pathPosition.toFixed(4)),
		metaLine('match', entry.similarity.toFixed(4)),
		colorMetaLine(entry.color),
	);
	card.append(image, meta);
	return card;
}

function createPairButton(index: number) {
	const button = document.createElement('button');
	button.className = 'pair-button';
	button.type = 'button';
	button.textContent = '→';
	button.title = `Inspect photo ${index + 1} → ${index + 2}`;
	button.setAttribute('aria-label', button.title);
	button.setAttribute('aria-pressed', String(selectedPairIndex === index));
	button.addEventListener('click', () => void selectPair(index));
	return button;
}

async function selectPair(index: number) {
	const current = sequence[index];
	const next = sequence[index + 1];
	if (!current || !next) return;
	stopPlayback();
	selectedPairIndex = index;
	renderSequence();
	drawDisk();
	updatePairDescription();
	playButton.disabled = true;
	timeline.disabled = true;
	stagePlaceholder.hidden = false;
	stagePlaceholder.textContent = 'Preparing adjacent photographs…';
	const revision = ++setupRevision;
	try {
		const [currentImage, nextImage] = await Promise.all([
			preloader.load(current.photo.imageUrl),
			preloader.load(next.photo.imageUrl),
		]);
		if (revision !== setupRevision) return;
		renderer = createColorPathTransitionRenderer({
			canvas: transitionCanvas,
			currentImage,
			nextImage,
			currentColor: current.color,
			nextColor: next.color,
		});
		if (!renderer) throw new Error('The transition stage is not available.');
		stagePlaceholder.hidden = true;
		playButton.disabled = false;
		timeline.disabled = false;
		timeline.value = '0';
		renderProgress(0);
	} catch (error) {
		stagePlaceholder.textContent =
			error instanceof Error ? error.message : 'Could not prepare this pair.';
	}
}

async function playTransition() {
	if (!renderer) return;
	playing = true;
	playButton.disabled = true;
	timeline.disabled = true;
	const revision = ++playRevision;
	const startedAt = performance.now();
	await new Promise<void>((resolve) => {
		const tick = (now: number) => {
			if (revision !== playRevision) return resolve();
			const progress = Math.min(1, (now - startedAt) / parameters.totalDurationMs);
			timeline.value = String(Math.round(progress * 100));
			renderProgress(progress);
			if (progress < 1) requestAnimationFrame(tick);
			else resolve();
		};
		requestAnimationFrame(tick);
	});
	if (revision === playRevision) {
		playing = false;
		playButton.disabled = false;
		timeline.disabled = false;
	}
}

function renderProgress(progress: number) {
	renderer?.render(progress, parameters, direction);
	timelineValue.value = `${Math.round(progress * 100)}%`;
}

function setDirection(nextDirection: ColorPathTransitionDirection) {
	if (direction === nextDirection) return;
	stopPlayback();
	direction = nextDirection;
	forwardButton.setAttribute('aria-pressed', String(direction === 'forward'));
	reverseButton.setAttribute('aria-pressed', String(direction === 'reverse'));
	timelineStartLabel.textContent = direction === 'forward' ? 'A clear' : 'B clear';
	timelineEndLabel.textContent = direction === 'forward' ? 'B clear' : 'A clear';
	timeline.value = '0';
	updatePairDescription();
	renderProgress(0);
}

function updatePairDescription() {
	if (selectedPairIndex === null) return;
	const first = sequence[selectedPairIndex];
	const second = sequence[selectedPairIndex + 1];
	if (!first || !second) return;
	const source = direction === 'forward' ? first : second;
	const target = direction === 'forward' ? second : first;
	const sourceIndex = direction === 'forward' ? selectedPairIndex + 1 : selectedPairIndex + 2;
	const targetIndex = direction === 'forward' ? selectedPairIndex + 2 : selectedPairIndex + 1;
	pairDescription.textContent = `${sourceIndex}. ${source.id} → ${targetIndex}. ${target.id}`;
}

async function saveDefaults() {
	saveDefaultsButton.disabled = true;
	saveStatus.dataset.state = '';
	saveStatus.textContent = 'Saving shared transition defaults…';
	try {
		const response = await fetch('/api/transition-defaults', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ parameters }),
		});
		const result = (await response.json()) as { error?: string };
		if (!response.ok) throw new Error(result.error || `Save failed (${response.status}).`);
		savedDefaults = { ...parameters };
		saveStatus.dataset.state = 'success';
		saveStatus.textContent = 'Saved. Public Color Path now uses these shared defaults.';
	} catch (error) {
		saveStatus.dataset.state = 'error';
		saveStatus.textContent = error instanceof Error ? error.message : 'Could not save defaults.';
	} finally {
		saveDefaultsButton.disabled = false;
	}
}

function renderParameterControls() {
	controls.replaceChildren();
	for (const definition of parameterDefinitions) {
		const label = document.createElement('label');
		label.className = 'parameter-control';
		const heading = document.createElement('span');
		heading.className = 'parameter-label';
		const name = document.createElement('span');
		name.textContent = definition.label;
		const output = document.createElement('output');
		output.value = definition.format(parameters[definition.key]);
		heading.append(name, output);
		const input = document.createElement('input');
		input.type = 'range';
		input.min = String(definition.minimum);
		input.max = String(definition.maximum);
		input.step = String(definition.step);
		input.value = String(parameters[definition.key]);
		input.addEventListener('input', () => {
			stopPlayback();
			parameters = { ...parameters, [definition.key]: Number(input.value) };
			output.value = definition.format(parameters[definition.key]);
			renderParameterValues();
			renderProgress(Number(timeline.value) / 100);
		});
		label.append(heading, input);
		controls.append(label);
	}
	renderParameterValues();
}

function renderParameterValues() {
	values.textContent = JSON.stringify(
		{
			totalDurationMs: parameters.totalDurationMs,
			maximumBlurRadius: parameters.maximumBlurRadius,
			colorBiasStrength: parameters.colorBiasStrength,
			grainAmount: parameters.grainAmount,
			grainScale: parameters.grainScale,
			abstractHold: parameters.abstractHold,
			revealStart: parameters.revealStart,
			spreadIrregularity: parameters.spreadIrregularity,
			spreadSoftness: parameters.spreadSoftness,
		},
		null,
		2,
	);
}

function drawDisk() {
	const context = disk.getContext('2d');
	if (!context) return;
	const centerX = disk.width / 2;
	const centerY = disk.height / 2;
	const radius = Math.min(disk.width, disk.height) / 2 - Math.max(6, disk.width * 0.025);
	const pixels = context.createImageData(disk.width, disk.height);
	for (let y = 0; y < disk.height; y += 1) {
		for (let x = 0; x < disk.width; x += 1) {
			const point = { x: (x - centerX) / radius, y: (y - centerY) / radius };
			if (Math.hypot(point.x, point.y) > 1) continue;
			const rgb = colorPathPointToRgb(point);
			const offset = (y * disk.width + x) * 4;
			pixels.data[offset] = rgb[0];
			pixels.data[offset + 1] = rgb[1];
			pixels.data[offset + 2] = rgb[2];
			pixels.data[offset + 3] = 255;
		}
	}
	context.clearRect(0, 0, disk.width, disk.height);
	context.putImageData(pixels, 0, 0);

	if (points.length > 1) {
		context.beginPath();
		points.forEach((point, index) => {
			const canvasPoint = toCanvasPoint(point, centerX, centerY, radius);
			if (index === 0) context.moveTo(canvasPoint.x, canvasPoint.y);
			else context.lineTo(canvasPoint.x, canvasPoint.y);
		});
		context.lineWidth = 9;
		context.strokeStyle = 'rgb(255 255 255 / 0.92)';
		context.stroke();
		context.lineWidth = 3;
		context.strokeStyle = 'rgb(15 18 15 / 0.9)';
		context.stroke();
	}

	sequence.forEach((entry, index) => {
		const point = interpolateColorPath(points, entry.pathPosition);
		const canvasPoint = toCanvasPoint(point, centerX, centerY, radius);
		context.beginPath();
		context.arc(canvasPoint.x, canvasPoint.y, 10, 0, Math.PI * 2);
		context.fillStyle = '#101210';
		context.fill();
		context.lineWidth = selectedPairIndex === index || selectedPairIndex === index - 1 ? 4 : 2;
		context.strokeStyle = '#d8ff72';
		context.stroke();
		context.fillStyle = '#ffffff';
		context.font = '600 10px system-ui, sans-serif';
		context.textAlign = 'center';
		context.textBaseline = 'middle';
		context.fillText(String(index + 1), canvasPoint.x, canvasPoint.y + 0.5);
	});

	points.forEach((point, index) => {
		const canvasPoint = toCanvasPoint(point, centerX, centerY, radius);
		context.beginPath();
		context.arc(canvasPoint.x, canvasPoint.y, 15, 0, Math.PI * 2);
		context.fillStyle = 'white';
		context.fill();
		context.lineWidth = 2.5;
		context.strokeStyle = 'black';
		context.stroke();
		context.fillStyle = 'black';
		context.font = '700 13px system-ui, sans-serif';
		context.textAlign = 'center';
		context.textBaseline = 'middle';
		context.fillText(String(index + 1), canvasPoint.x, canvasPoint.y + 0.5);
	});
}

function pointFromPointer(event: PointerEvent): ColorPathPoint | null {
	const bounds = disk.getBoundingClientRect();
	const radius = Math.min(bounds.width, bounds.height) / 2;
	const point = {
		x: (event.clientX - bounds.left - bounds.width / 2) / radius,
		y: (event.clientY - bounds.top - bounds.height / 2) / radius,
	};
	return Math.hypot(point.x, point.y) <= 1 ? point : null;
}

function clearGeneratedSequence() {
	sequence = [];
	selectedPairIndex = null;
	renderer = null;
	setupRevision += 1;
	stopPlayback();
	sequenceList.classList.add('empty-state');
	const message = document.createElement('p');
	message.textContent = 'Generate the updated path to inspect its sequence.';
	sequenceList.replaceChildren(message);
	sequenceSummary.textContent = 'Path changed. Generate a new real sequence.';
	pairDescription.textContent =
		'Generate a sequence, then select a connection between two thumbnails.';
	stagePlaceholder.hidden = false;
	stagePlaceholder.textContent = 'Select an adjacent pair above.';
	transitionCanvas
		.getContext('2d')
		?.clearRect(0, 0, transitionCanvas.width, transitionCanvas.height);
	playButton.disabled = true;
	timeline.disabled = true;
	timeline.value = '0';
	timelineValue.value = '0%';
}

function updatePathControls() {
	const count = points.length;
	undoButton.disabled = count === 0;
	resetPathButton.disabled = count === 0;
	generateButton.disabled = count < colorPathConfig.controlPoints.minimum || photos.length === 0;
	guidance.textContent =
		count === colorPathConfig.controlPoints.maximum
			? '5 / 5 points selected. Generate or undo a point.'
			: count < colorPathConfig.controlPoints.minimum
				? `${count} / 5 points selected. Choose ${colorPathConfig.controlPoints.minimum - count} more.`
				: `${count} / 5 points selected. Add another or generate.`;
}

function stopPlayback() {
	playRevision += 1;
	playing = false;
	playButton.disabled = !renderer;
	timeline.disabled = !renderer;
}

function colorAtPosition(position: number) {
	return colorPathPointToRgb(interpolateColorPath(points, position));
}

function metaLine(label: string, value: string) {
	const line = document.createElement('span');
	line.className = 'meta-line';
	const name = document.createElement('span');
	name.textContent = label;
	const data = document.createElement('span');
	data.textContent = value;
	line.append(name, data);
	return line;
}

function colorMetaLine(color: RgbColor) {
	const line = document.createElement('span');
	line.className = 'meta-line';
	const label = document.createElement('span');
	label.textContent = 'target';
	const value = document.createElement('span');
	value.className = 'color-value';
	const swatch = document.createElement('i');
	swatch.className = 'color-swatch';
	swatch.style.backgroundColor = `rgb(${color.join(' ')})`;
	const text = document.createElement('span');
	text.textContent = rgbToHex(color);
	value.append(swatch, text);
	line.append(label, value);
	return line;
}

function rgbToHex(color: RgbColor) {
	return `#${color.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function toCanvasPoint(point: ColorPathPoint, centerX: number, centerY: number, radius: number) {
	return { x: centerX + point.x * radius, y: centerY + point.y * radius };
}

function requiredElement<T extends HTMLElement>(id: string) {
	const element = document.getElementById(id);
	if (!element) throw new Error(`Missing #${id}.`);
	return element as T;
}
