import {
	colorWalkRenderingDefaults,
	colorWalkTunerPresets,
	renderingParametersToTunerControls,
	tunerControlsToRenderingParameters,
	type ColorWalkRefinementMode,
	type ColorWalkTunerControls,
} from '../src/color/color-walk-config.ts';
import {
	computeColorWalkMasks,
	prepareColorWalkImage,
	renderColorWalkMask,
	renderPreparedColorWalkImage,
	type PreparedColorWalkImage,
} from '../src/color/color-walk-rendering.ts';
import type { RgbColor } from '../src/color/color-types.ts';
import { drawHueWheel, hueToRgb, normalizeHue } from '../src/color/color-wheel.ts';

interface TunerPhoto {
	id: string;
	label: string;
	imageUrl: string;
	thumbnailUrl: string;
}

type ControlKey = keyof ColorWalkTunerControls;

const controlDefinitions: Array<{
	key: ControlKey;
	label: string;
	description: string;
	low: string;
	high: string;
}> = [
	{
		key: 'preservedColorRange',
		label: 'Preserved color range',
		description: 'How broad a related color family remains completely unchanged.',
		low: 'Narrow',
		high: 'Broad',
	},
	{
		key: 'transitionSharpness',
		label: 'Transition sharpness',
		description: 'How abruptly colors outside the preserved range become muted.',
		low: 'Soft',
		high: 'Sharp',
	},
	{
		key: 'transitionWidth',
		label: 'Transition width',
		description: 'How much perceptual distance is available before suppression reaches its floor.',
		low: 'Short',
		high: 'Wide',
	},
	{
		key: 'otherColorSaturation',
		label: 'Other-color saturation',
		description: 'How much color remains in regions far from the selected family.',
		low: 'Muted',
		high: 'Colorful',
	},
	{
		key: 'otherColorBrightness',
		label: 'Other-color brightness',
		description: 'How much lightness remains in unrelated regions.',
		low: 'Darker',
		high: 'Original',
	},
	{
		key: 'regionSmoothing',
		label: 'Region smoothing',
		description: 'How strongly nearby same-region evidence fills weak color variations.',
		low: 'Off',
		high: 'Strong',
	},
	{
		key: 'edgeSensitivity',
		label: 'Edge sensitivity',
		description: 'How strictly refinement stops when the source photograph changes across an edge.',
		low: 'Permissive',
		high: 'Strict',
	},
	{
		key: 'regionSupport',
		label: 'Region support',
		description: 'How readily local evidence expands preservation through a coherent region.',
		low: 'Selective',
		high: 'Broad',
	},
];

const status = required<HTMLElement>('#status');
const wheel = required<HTMLCanvasElement>('#color-wheel');
const colorField = required<HTMLInputElement>('#color-field');
const colorValue = required<HTMLOutputElement>('#color-value');
const colorSwatch = required<HTMLElement>('#color-swatch');
const sliders = required<HTMLElement>('#sliders');
const presetContainer = required<HTMLElement>('#presets');
const resetButton = required<HTMLButtonElement>('#reset');
const copyButton = required<HTMLButtonElement>('#copy-values');
const parameterValues = required<HTMLElement>('#parameter-values');
const benchmarkButton = required<HTMLButtonElement>('#run-benchmark');
const benchmarkResult = required<HTMLOutputElement>('#benchmark-result');
const applyButton = required<HTMLButtonElement>('#apply-defaults');
const applyConfirmation = required<HTMLElement>('#apply-confirmation');
const cancelApplyButton = required<HTMLButtonElement>('#cancel-apply');
const confirmApplyButton = required<HTMLButtonElement>('#confirm-apply');
const applyStatus = required<HTMLElement>('#apply-status');
const originalPreview = required<HTMLImageElement>('#original-preview');
const effectPreview = required<HTMLCanvasElement>('#effect-preview');
const rawMaskPreview = required<HTMLCanvasElement>('#raw-mask-preview');
const refinedMaskPreview = required<HTMLCanvasElement>('#refined-mask-preview');
const effectSurface = required<HTMLButtonElement>('#effect-surface');
const heldOriginal = required<HTMLImageElement>('#held-original');
const holdInstruction = required<HTMLElement>('#hold-instruction');
const photoFilter = required<HTMLInputElement>('#photo-filter');
const photoList = required<HTMLElement>('#photo-list');

let publicDefaults = { ...colorWalkRenderingDefaults };
let controls = renderingParametersToTunerControls(publicDefaults);
let refinementMode: ColorWalkRefinementMode = publicDefaults.refinementMode;
let selectedColor: RgbColor = [0, 170, 255];
let selectedHue = 200;
let photos: TunerPhoto[] = [];
let activePhoto: TunerPhoto | null = null;
let sourceImage: HTMLImageElement | null = null;
let prepared: PreparedColorWalkImage | null = null;
let draggingWheel = false;
let loadVersion = 0;
let renderTimer: ReturnType<typeof setTimeout> | null = null;
let colorTimer: ReturnType<typeof setTimeout> | null = null;
let lastPrepareDuration = 0;

setupControls();
setupRefinementMode();
setupDefaultSaving();
setupColorPicker();
setupHoldInteraction();
drawSelectedColor();
benchmarkButton.addEventListener('click', () => runBenchmark());
void loadGallery();

async function loadGallery() {
	try {
		const response = await fetch('/api/photos');
		const body = (await response.json()) as { photos?: TunerPhoto[]; error?: string };
		if (!response.ok || !body.photos) throw new Error(body.error || 'Gallery could not be loaded.');
		photos = body.photos;
		renderPhotoChooser();
		if (photos[0]) await selectPhoto(photos[0]);
		else status.textContent = 'No registered photographs were found.';
	} catch (error) {
		status.textContent = error instanceof Error ? error.message : 'Gallery could not be loaded.';
		status.classList.add('error');
	}
}

function setupControls() {
	for (const definition of controlDefinitions) {
		const wrapper = document.createElement('label');
		wrapper.className = 'slider-control';
		const heading = document.createElement('span');
		heading.className = 'slider-heading';
		heading.append(text(definition.label), outputFor(definition.key));
		const description = document.createElement('small');
		description.textContent = definition.description;
		const input = document.createElement('input');
		input.type = 'range';
		input.min = '0';
		input.max = '100';
		input.step = '1';
		input.dataset.control = definition.key;
		input.value = String(Math.round(controls[definition.key]));
		input.addEventListener('input', () => {
			controls = { ...controls, [definition.key]: Number(input.value) };
			applyConfirmation.hidden = true;
			applyStatus.textContent = '';
			updateControlReadouts();
			scheduleRender();
		});
		const scale = document.createElement('span');
		scale.className = 'slider-scale';
		scale.append(text(definition.low), text(definition.high));
		wrapper.append(heading, description, input, scale);
		sliders.append(wrapper);
	}

	for (const [name, preset] of Object.entries(colorWalkTunerPresets)) {
		const button = document.createElement('button');
		button.type = 'button';
		button.textContent = name;
		button.addEventListener('click', () =>
			applyControls(
				name === 'Balanced' ? renderingParametersToTunerControls(publicDefaults) : preset,
			),
		);
		presetContainer.append(button);
	}

	resetButton.addEventListener('click', () => {
		refinementMode = publicDefaults.refinementMode;
		setupRefinementModeState();
		applyControls(renderingParametersToTunerControls(publicDefaults));
	});
	copyButton.addEventListener('click', async () => {
		await navigator.clipboard.writeText(parameterValues.textContent || '');
		copyButton.textContent = 'Copied';
		window.setTimeout(() => (copyButton.textContent = 'Copy'), 1200);
	});
	updateControlReadouts();
}

function applyControls(next: ColorWalkTunerControls) {
	controls = { ...next };
	applyConfirmation.hidden = true;
	applyStatus.textContent = '';
	syncControlInputs();
	updateControlReadouts();
	scheduleRender();
}

function updateControlReadouts() {
	for (const definition of controlDefinitions) {
		const output = required<HTMLOutputElement>(`#value-${definition.key}`);
		output.value = `${Math.round(controls[definition.key])}%`;
	}
	parameterValues.textContent = JSON.stringify(
		tunerControlsToRenderingParameters(controls, refinementMode),
		null,
		2,
	);
	applyButton.disabled = parametersEqual(
		tunerControlsToRenderingParameters(controls, refinementMode),
		publicDefaults,
	);
}

function setupRefinementMode() {
	for (const input of document.querySelectorAll<HTMLInputElement>(
		'input[name="refinement-mode"]',
	)) {
		input.checked = input.value === refinementMode;
		input.addEventListener('change', () => {
			if (!input.checked) return;
			refinementMode = input.value as ColorWalkRefinementMode;
			applyConfirmation.hidden = true;
			applyStatus.textContent = '';
			updateControlReadouts();
			scheduleRender();
		});
	}
}

function setupDefaultSaving() {
	applyButton.addEventListener('click', () => {
		applyConfirmation.hidden = false;
		applyStatus.textContent = '';
		confirmApplyButton.focus();
	});
	cancelApplyButton.addEventListener('click', () => {
		applyConfirmation.hidden = true;
		applyButton.focus();
	});
	confirmApplyButton.addEventListener('click', () => void savePublicDefaults());
}

async function savePublicDefaults() {
	const parameters = tunerControlsToRenderingParameters(controls, refinementMode);
	confirmApplyButton.disabled = true;
	cancelApplyButton.disabled = true;
	applyStatus.classList.remove('error');
	applyStatus.textContent = 'Updating shared public defaults…';
	try {
		const response = await fetch('/api/defaults', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ parameters }),
		});
		const body = (await response.json()) as {
			parameters?: typeof parameters;
			error?: string;
		};
		if (!response.ok || !body.parameters) {
			throw new Error(body.error || 'The shared defaults could not be updated.');
		}
		publicDefaults = { ...body.parameters };
		refinementMode = publicDefaults.refinementMode;
		controls = renderingParametersToTunerControls(publicDefaults);
		applyConfirmation.hidden = true;
		setupRefinementModeState();
		syncControlInputs();
		updateControlReadouts();
		applyStatus.textContent = 'Public Color Walk defaults updated.';
	} catch (error) {
		applyStatus.classList.add('error');
		applyStatus.textContent =
			error instanceof Error ? error.message : 'The shared defaults could not be updated.';
	} finally {
		confirmApplyButton.disabled = false;
		cancelApplyButton.disabled = false;
	}
}

function setupRefinementModeState() {
	for (const input of document.querySelectorAll<HTMLInputElement>(
		'input[name="refinement-mode"]',
	)) {
		input.checked = input.value === refinementMode;
	}
}

function syncControlInputs() {
	for (const input of sliders.querySelectorAll<HTMLInputElement>('input[data-control]')) {
		input.value = String(Math.round(controls[input.dataset.control as ControlKey]));
	}
}

function setupColorPicker() {
	wheel.addEventListener('pointerdown', (event) => {
		draggingWheel = true;
		wheel.setPointerCapture(event.pointerId);
		selectHueFromPointer(event);
	});
	wheel.addEventListener('pointermove', (event) => {
		if (draggingWheel) selectHueFromPointer(event);
	});
	wheel.addEventListener('pointerup', (event) => {
		draggingWheel = false;
		if (wheel.hasPointerCapture(event.pointerId)) wheel.releasePointerCapture(event.pointerId);
	});
	wheel.addEventListener('pointercancel', () => (draggingWheel = false));
	wheel.addEventListener('keydown', (event) => {
		const increment = event.shiftKey ? 15 : 3;
		if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') selectedHue -= increment;
		else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') selectedHue += increment;
		else return;
		event.preventDefault();
		selectedHue = normalizeHue(selectedHue);
		selectedColor = hueToRgb(selectedHue);
		onSelectedColorChanged();
	});
	colorField.addEventListener('input', () => {
		selectedColor = hexToRgb(colorField.value);
		selectedHue = rgbToHue(selectedColor);
		onSelectedColorChanged();
	});
}

function selectHueFromPointer(event: PointerEvent) {
	const bounds = wheel.getBoundingClientRect();
	const x = event.clientX - bounds.left - bounds.width / 2;
	const y = event.clientY - bounds.top - bounds.height / 2;
	selectedHue = normalizeHue((Math.atan2(y, x) * 180) / Math.PI + 90);
	selectedColor = hueToRgb(selectedHue);
	onSelectedColorChanged();
}

function onSelectedColorChanged() {
	drawSelectedColor();
	if (colorTimer) clearTimeout(colorTimer);
	colorTimer = setTimeout(() => {
		colorTimer = null;
		prepareCurrentImage();
	}, 45);
}

function drawSelectedColor() {
	drawHueWheel(wheel, selectedHue);
	wheel.setAttribute('aria-valuenow', String(Math.round(selectedHue)));
	const hex = rgbToHex(selectedColor);
	colorField.value = hex;
	colorValue.value = `${hex} · rgb(${selectedColor.join(', ')})`;
	colorSwatch.style.backgroundColor = hex;
}

function setupHoldInteraction() {
	effectSurface.addEventListener('pointerdown', (event) => {
		if (!prepared || event.button !== 0) return;
		event.preventDefault();
		effectSurface.setPointerCapture(event.pointerId);
		showOriginalInEffect();
	});
	for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
		effectSurface.addEventListener(eventName, () => showEffect());
	}
	effectSurface.addEventListener('keydown', (event) => {
		if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
			event.preventDefault();
			showOriginalInEffect();
		}
	});
	effectSurface.addEventListener('keyup', (event) => {
		if (event.key === ' ' || event.key === 'Enter') {
			event.preventDefault();
			showEffect();
		}
	});
	effectSurface.addEventListener('blur', showEffect);
}

function showOriginalInEffect() {
	effectPreview.hidden = true;
	heldOriginal.hidden = false;
	holdInstruction.textContent = 'Release to show effect';
}

function showEffect() {
	heldOriginal.hidden = true;
	effectPreview.hidden = false;
	holdInstruction.textContent = 'Hold effect to reveal original';
}

function renderPhotoChooser() {
	photoList.replaceChildren(
		...photos.map((photo) => {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'photo-option';
			button.dataset.photoId = photo.id;
			button.title = photo.label;
			const image = document.createElement('img');
			image.src = photo.thumbnailUrl;
			image.alt = '';
			image.loading = 'lazy';
			const label = document.createElement('span');
			label.textContent = photo.label;
			button.append(image, label);
			button.addEventListener('click', () => void selectPhoto(photo));
			return button;
		}),
	);
	photoFilter.addEventListener('input', filterPhotos);
}

function filterPhotos() {
	const query = photoFilter.value.trim().toLowerCase();
	for (const button of photoList.querySelectorAll<HTMLElement>('.photo-option')) {
		const photo = photos.find((candidate) => candidate.id === button.dataset.photoId);
		button.hidden = Boolean(query && !`${photo?.id} ${photo?.label}`.toLowerCase().includes(query));
	}
}

async function selectPhoto(photo: TunerPhoto) {
	const version = ++loadVersion;
	activePhoto = photo;
	prepared = null;
	status.textContent = `Loading ${photo.label}…`;
	showEffect();
	for (const button of photoList.querySelectorAll<HTMLElement>('.photo-option')) {
		button.classList.toggle('active', button.dataset.photoId === photo.id);
	}
	try {
		const image = new Image();
		image.decoding = 'async';
		image.src = photo.imageUrl;
		await image.decode();
		if (version !== loadVersion) return;
		sourceImage = image;
		originalPreview.src = photo.imageUrl;
		originalPreview.alt = photo.label;
		heldOriginal.src = photo.imageUrl;
		heldOriginal.alt = photo.label;
		prepareCurrentImage();
	} catch {
		if (version === loadVersion) status.textContent = `${photo.label} could not be loaded.`;
	}
}

function prepareCurrentImage() {
	if (!sourceImage || !activePhoto) return;
	status.textContent = `Preparing ${activePhoto.label}…`;
	const started = performance.now();
	prepared = prepareColorWalkImage(sourceImage, selectedColor);
	lastPrepareDuration = performance.now() - started;
	renderEffect();
}

function scheduleRender() {
	if (renderTimer) clearTimeout(renderTimer);
	renderTimer = setTimeout(() => {
		renderTimer = null;
		renderEffect();
	}, 35);
}

function renderEffect() {
	if (!prepared || !activePhoto) return;
	status.textContent = `Rendering ${activePhoto.label}…`;
	const parameters = tunerControlsToRenderingParameters(controls, refinementMode);
	const masks = computeColorWalkMasks(prepared, parameters);
	const rendered = renderPreparedColorWalkImage(prepared, parameters, masks);
	copyCanvas(renderColorWalkMask(masks.raw, prepared.width, prepared.height), rawMaskPreview);
	copyCanvas(
		renderColorWalkMask(masks.refined, prepared.width, prepared.height),
		refinedMaskPreview,
	);
	effectPreview.width = rendered.width;
	effectPreview.height = rendered.height;
	copyCanvas(rendered, effectPreview);
	status.textContent = `${activePhoto.label} · ${rendered.width} × ${rendered.height}px working image · ${masks.refinementWidth} × ${masks.refinementHeight}px refinement`;
}

function runBenchmark() {
	if (!prepared || !activePhoto) return;
	const parameters = tunerControlsToRenderingParameters(controls, 'edge-aware');
	const maskTimes: number[] = [];
	const renderTimes: number[] = [];
	benchmarkButton.disabled = true;
	benchmarkResult.value = 'Benchmarking…';
	window.setTimeout(() => {
		computeColorWalkMasks(prepared!, parameters);
		for (let iteration = 0; iteration < 5; iteration += 1) {
			const maskStarted = performance.now();
			const masks = computeColorWalkMasks(prepared!, parameters);
			maskTimes.push(performance.now() - maskStarted);
			const renderStarted = performance.now();
			renderPreparedColorWalkImage(prepared!, parameters, masks);
			renderTimes.push(performance.now() - renderStarted);
		}
		const maskMedian = median(maskTimes);
		const renderMedian = median(renderTimes);
		benchmarkResult.value = `${activePhoto!.label} · ${prepared!.width} × ${prepared!.height}px | Lab prepare ${lastPrepareDuration.toFixed(1)} ms | cached edge mask ${maskMedian.toFixed(1)} ms | final render ${renderMedian.toFixed(1)} ms | repeated total ${(maskMedian + renderMedian).toFixed(1)} ms (median of 5)`;
		benchmarkButton.disabled = false;
	}, 20);
}

function copyCanvas(source: HTMLCanvasElement, target: HTMLCanvasElement) {
	target.width = source.width;
	target.height = source.height;
	const context = target.getContext('2d');
	if (!context) throw new Error('Canvas rendering is unavailable.');
	context.drawImage(source, 0, 0);
}

function median(values: number[]) {
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.floor(sorted.length / 2)];
}

function outputFor(key: ControlKey) {
	const output = document.createElement('output');
	output.id = `value-${key}`;
	return output;
}

function text(value: string) {
	return document.createTextNode(value);
}

function required<T extends Element>(selector: string) {
	const element = document.querySelector<T>(selector);
	if (!element) throw new Error(`Missing tuner element: ${selector}`);
	return element;
}

function hexToRgb(value: string): RgbColor {
	return [1, 3, 5].map((offset) =>
		Number.parseInt(value.slice(offset, offset + 2), 16),
	) as RgbColor;
}

function rgbToHex(rgb: RgbColor) {
	return `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function rgbToHue([red, green, blue]: RgbColor) {
	const [r, g, b] = [red / 255, green / 255, blue / 255];
	const maximum = Math.max(r, g, b);
	const minimum = Math.min(r, g, b);
	const delta = maximum - minimum;
	if (delta === 0) return selectedHue;
	const segment =
		maximum === r
			? ((g - b) / delta) % 6
			: maximum === g
				? (b - r) / delta + 2
				: (r - g) / delta + 4;
	return normalizeHue(segment * 60);
}

function parametersEqual(
	left: typeof colorWalkRenderingDefaults,
	right: typeof colorWalkRenderingDefaults,
) {
	return (Object.keys(left) as Array<keyof typeof left>).every((key) => {
		const leftValue = left[key];
		const rightValue = right[key];
		return typeof leftValue === 'number' && typeof rightValue === 'number'
			? Math.abs(leftValue - rightValue) < 0.000_01
			: leftValue === rightValue;
	});
}
