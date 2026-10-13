import { findColorWalkMatches, type ColorWalkCandidate } from '../src/color/color-walk-matching.ts';
import {
	colorWalkRankingDefaults,
	colorWalkRankingWeightRange,
	type ColorWalkRankingWeights,
} from '../src/color/color-walk-ranking-config.ts';
import type { RgbColor } from '../src/color/color-types.ts';
import { drawHueWheel, hueToRgb, normalizeHue } from '../src/color/color-wheel.ts';

interface RankingPhoto extends ColorWalkCandidate {
	label: string;
	thumbnailUrl: string;
}

type RankingWeightKey = keyof ColorWalkRankingWeights;

const weightDefinitions: Array<{
	key: RankingWeightKey;
	label: string;
	description: string;
}> = [
	{
		key: 'presenceWeight',
		label: 'Presence',
		description: 'Rewards strong evidence that the selected color is visibly present.',
	},
	{
		key: 'coherenceWeight',
		label: 'Coherence',
		description: 'Rewards neighboring supporting cells over fragmented appearances.',
	},
	{
		key: 'colorSeparationWeight',
		label: 'Color separation',
		description: 'Rewards selected-color regions that are distinct from competing colors.',
	},
	{
		key: 'revealImpactWeight',
		label: 'Reveal impact',
		description: 'Rewards photographs where selective color should create a clear visual reveal.',
	},
	{
		key: 'overspreadPenaltyStrength',
		label: 'Overspread penalty',
		description: 'Penalizes the selected color covering most spatial cells.',
	},
];

const effectTab = required<HTMLButtonElement>('#effect-tab');
const rankingTab = required<HTMLButtonElement>('#ranking-tab');
const effectView = required<HTMLElement>('#effect-view');
const rankingView = required<HTMLElement>('#ranking-view');
const effectStatus = required<HTMLElement>('#status');
const wheel = required<HTMLCanvasElement>('#ranking-color-wheel');
const colorField = required<HTMLInputElement>('#ranking-color-field');
const colorValue = required<HTMLOutputElement>('#ranking-color-value');
const colorSwatch = required<HTMLElement>('#ranking-color-swatch');
const sliderContainer = required<HTMLElement>('#ranking-sliders');
const resetButton = required<HTMLButtonElement>('#ranking-reset');
const valuesOutput = required<HTMLElement>('#ranking-values');
const status = required<HTMLElement>('#ranking-status');
const results = required<HTMLElement>('#ranking-results');
const applyButton = required<HTMLButtonElement>('#apply-ranking-defaults');
const applyConfirmation = required<HTMLElement>('#ranking-apply-confirmation');
const cancelApplyButton = required<HTMLButtonElement>('#cancel-ranking-apply');
const confirmApplyButton = required<HTMLButtonElement>('#confirm-ranking-apply');
const applyStatus = required<HTMLElement>('#ranking-apply-status');

let publicDefaults = { ...colorWalkRankingDefaults };
let weights = { ...publicDefaults };
let selectedHue = 200;
let selectedColor: RgbColor = [0, 170, 255];
let photos: RankingPhoto[] = [];
let draggingWheel = false;
let renderFrame: number | null = null;

setupTabs();
setupColorPicker();
setupWeightControls();
setupSaving();
drawSelectedColor();
void loadPhotos();

function setupTabs() {
	effectTab.addEventListener('click', () => showView('effect'));
	rankingTab.addEventListener('click', () => showView('ranking'));
}

function showView(view: 'effect' | 'ranking') {
	const rankingActive = view === 'ranking';
	effectView.hidden = rankingActive;
	rankingView.hidden = !rankingActive;
	effectStatus.hidden = rankingActive;
	effectTab.setAttribute('aria-selected', String(!rankingActive));
	rankingTab.setAttribute('aria-selected', String(rankingActive));
	if (rankingActive) wheel.focus();
}

async function loadPhotos() {
	try {
		const response = await fetch('/api/photos');
		const body = (await response.json()) as { photos?: RankingPhoto[]; error?: string };
		if (!response.ok || !body.photos)
			throw new Error(body.error || 'Ranking data could not be loaded.');
		photos = body.photos.filter((photo) => photo.features.spatialCells.length > 0);
		renderRanking();
	} catch (error) {
		status.textContent =
			error instanceof Error ? error.message : 'Ranking data could not be loaded.';
		status.classList.add('error');
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
		onColorChanged();
	});
	colorField.addEventListener('input', () => {
		selectedColor = hexToRgb(colorField.value);
		selectedHue = rgbToHue(selectedColor);
		onColorChanged();
	});
}

function selectHueFromPointer(event: PointerEvent) {
	const bounds = wheel.getBoundingClientRect();
	const x = event.clientX - bounds.left - bounds.width / 2;
	const y = event.clientY - bounds.top - bounds.height / 2;
	selectedHue = normalizeHue((Math.atan2(y, x) * 180) / Math.PI + 90);
	selectedColor = hueToRgb(selectedHue);
	onColorChanged();
}

function onColorChanged() {
	drawSelectedColor();
	scheduleRanking();
}

function drawSelectedColor() {
	drawHueWheel(wheel, selectedHue);
	wheel.setAttribute('aria-valuenow', String(Math.round(selectedHue)));
	const hex = rgbToHex(selectedColor);
	colorField.value = hex;
	colorValue.value = `${hex} · rgb(${selectedColor.join(', ')})`;
	colorSwatch.style.backgroundColor = hex;
}

function setupWeightControls() {
	for (const definition of weightDefinitions) {
		const label = document.createElement('label');
		label.className = 'slider-control';
		const heading = document.createElement('span');
		heading.className = 'slider-heading';
		const output = document.createElement('output');
		output.id = `ranking-value-${definition.key}`;
		heading.append(text(definition.label), output);
		const description = document.createElement('small');
		description.textContent = definition.description;
		const input = document.createElement('input');
		input.type = 'range';
		input.min = '0';
		input.max = '100';
		input.step = '1';
		input.dataset.rankingWeight = definition.key;
		input.addEventListener('input', () => {
			weights = { ...weights, [definition.key]: controlToWeight(Number(input.value)) };
			applyConfirmation.hidden = true;
			applyStatus.textContent = '';
			updateWeightReadouts();
			scheduleRanking();
		});
		label.append(heading, description, input);
		sliderContainer.append(label);
	}
	resetButton.addEventListener('click', () => {
		weights = { ...publicDefaults };
		syncWeightInputs();
		updateWeightReadouts();
		scheduleRanking();
	});
	syncWeightInputs();
	updateWeightReadouts();
}

function updateWeightReadouts() {
	for (const definition of weightDefinitions) {
		required<HTMLOutputElement>(`#ranking-value-${definition.key}`).value =
			weights[definition.key].toFixed(2);
	}
	valuesOutput.textContent = JSON.stringify(weights, null, 2);
	applyButton.disabled = weightsEqual(weights, publicDefaults);
}

function syncWeightInputs() {
	for (const input of sliderContainer.querySelectorAll<HTMLInputElement>(
		'input[data-ranking-weight]',
	)) {
		const key = input.dataset.rankingWeight as RankingWeightKey;
		input.value = String(Math.round(weightToControl(weights[key])));
	}
}

function scheduleRanking() {
	if (renderFrame !== null) cancelAnimationFrame(renderFrame);
	renderFrame = requestAnimationFrame(() => {
		renderFrame = null;
		renderRanking();
	});
}

function renderRanking() {
	if (photos.length === 0) {
		status.textContent = 'No analyzed photographs are available. Run color:analyze first.';
		results.replaceChildren();
		return;
	}
	const ranked = findColorWalkMatches(photos, selectedColor, weights);
	status.textContent = `${ranked.length} ranked matches from ${photos.length} registered photographs`;
	const photosById = new Map(photos.map((photo) => [photo.id, photo]));
	results.replaceChildren(
		...ranked.map((match, index) => {
			const photo = photosById.get(match.id)!;
			const card = document.createElement('article');
			card.className = 'ranking-card';
			const visual = document.createElement('div');
			visual.className = 'ranking-visual';
			const rank = document.createElement('span');
			rank.className = 'ranking-number';
			rank.textContent = String(index + 1).padStart(2, '0');
			const image = document.createElement('img');
			image.src = photo.thumbnailUrl;
			image.alt = '';
			image.loading = 'lazy';
			visual.append(rank, image);
			const identity = document.createElement('div');
			identity.className = 'ranking-identity';
			const id = document.createElement('strong');
			id.textContent = photo.id;
			const score = document.createElement('span');
			score.textContent = `Score ${formatScore(match.score)}`;
			identity.append(id, score);
			const details = document.createElement('details');
			const summary = document.createElement('summary');
			summary.textContent = 'Diagnostics';
			const diagnostics = document.createElement('dl');
			for (const [label, value] of [
				['Selected-color presence', match.diagnostics.presence],
				['Coherence / fragmentation', match.diagnostics.coherence],
				['Boundary / region clarity', match.diagnostics.boundaryClarity],
				['Color separation', match.diagnostics.colorSeparation],
				['Reveal impact', match.diagnostics.revealImpact],
				['Overspread penalty', match.diagnostics.overspreadPenalty],
				['Supporting cell coverage', match.diagnostics.supportingCellRatio],
				['Final ranking score', match.score],
			] as const) {
				const term = document.createElement('dt');
				term.textContent = label;
				const description = document.createElement('dd');
				description.textContent = formatScore(value);
				diagnostics.append(term, description);
			}
			details.append(summary, diagnostics);
			card.append(visual, identity, details);
			return card;
		}),
	);
}

function setupSaving() {
	applyButton.addEventListener('click', () => {
		applyConfirmation.hidden = false;
		applyStatus.textContent = '';
		confirmApplyButton.focus();
	});
	cancelApplyButton.addEventListener('click', () => {
		applyConfirmation.hidden = true;
		applyButton.focus();
	});
	confirmApplyButton.addEventListener('click', () => void saveRankingDefaults());
}

async function saveRankingDefaults() {
	confirmApplyButton.disabled = true;
	cancelApplyButton.disabled = true;
	applyStatus.classList.remove('error');
	applyStatus.textContent = 'Updating shared ranking defaults…';
	try {
		const response = await fetch('/api/ranking-defaults', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ weights }),
		});
		const body = (await response.json()) as { weights?: ColorWalkRankingWeights; error?: string };
		if (!response.ok || !body.weights)
			throw new Error(body.error || 'Ranking defaults could not be updated.');
		publicDefaults = { ...body.weights };
		weights = { ...publicDefaults };
		applyConfirmation.hidden = true;
		syncWeightInputs();
		updateWeightReadouts();
		applyStatus.textContent = 'Public Color Walk ranking defaults updated.';
	} catch (error) {
		applyStatus.classList.add('error');
		applyStatus.textContent =
			error instanceof Error ? error.message : 'Ranking defaults could not be updated.';
	} finally {
		confirmApplyButton.disabled = false;
		cancelApplyButton.disabled = false;
	}
}

function controlToWeight(value: number) {
	return (
		colorWalkRankingWeightRange.minimum +
		(value / 100) * (colorWalkRankingWeightRange.maximum - colorWalkRankingWeightRange.minimum)
	);
}

function weightToControl(value: number) {
	return (
		((value - colorWalkRankingWeightRange.minimum) /
			(colorWalkRankingWeightRange.maximum - colorWalkRankingWeightRange.minimum)) *
		100
	);
}

function formatScore(value: number) {
	return value.toFixed(3);
}

function weightsEqual(left: ColorWalkRankingWeights, right: ColorWalkRankingWeights) {
	return (Object.keys(left) as RankingWeightKey[]).every(
		(key) => Math.abs(left[key] - right[key]) < 0.000_01,
	);
}

function required<T extends Element>(selector: string) {
	const element = document.querySelector<T>(selector);
	if (!element) throw new Error(`Missing ranking debugger element: ${selector}`);
	return element;
}

function text(value: string) {
	return document.createTextNode(value);
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
