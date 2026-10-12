/* global document, fetch */

const summary = document.querySelector('#summary');
const photos = document.querySelector('#photos');
const matches = document.querySelector('#matches');
const colorPicker = document.querySelector('#color-picker');
const colorValue = document.querySelector('#color-value');
const resultCount = document.querySelector('#result-count');
let matchRequest = 0;

load().catch(showFatalError);
colorPicker.addEventListener('input', updateMatches);
resultCount.addEventListener('input', updateMatches);

async function load() {
	const response = await fetch('/api/state');
	const state = await readResponse(response);
	const analyzed = state.photos.filter((photo) => photo.features);
	const settings = state.analysis;
	summary.textContent = `${analyzed.length}/${state.photos.length} photographs · schema ${state.schemaVersion} · analysis ${state.analysisVersion} · ${settings.sampleSize}px sample · ${settings.dominantColorClusters} global clusters · ${settings.hueBinCount} hue bins · ${settings.toneHueWindowBins}-bin tone window · ${settings.spatialGridSize.join('×')} grid × ${settings.spatialColorsPerCell} local colors`;
	photos.replaceChildren(...analyzed.map(renderPhotoCard));
	await updateMatches();
}

function renderPhotoCard(photo) {
	const feature = photo.features;
	const card = element('article', 'photo-card');
	const image = document.createElement('img');
	image.src = photo.imageUrl;
	image.alt = photo.id;
	image.loading = 'lazy';
	card.append(image, element('h3', '', photo.id));
	const palette = element('div', 'palette');
	for (const color of feature.dominantColors) {
		const swatch = element('div', 'swatch');
		swatch.style.backgroundColor = rgb(color.rgb);
		swatch.style.flexGrow = String(Math.max(0.08, color.proportion));
		swatch.title = `${percent(color.proportion)} · Lab ${color.lab.join(', ')}`;
		swatch.append(element('span', '', percent(color.proportion)));
		palette.append(swatch);
	}
	const average = element('div', 'metrics');
	const averageSwatch = element('span', 'average-swatch');
	const classification = classifyTone(feature);
	averageSwatch.style.backgroundColor = labCss(feature.averageLab);
	average.append(
		averageSwatch,
		element('span', '', `Average Lab ${feature.averageLab.join(', ')}`),
		element('span', '', `Brightness ${feature.brightness.toFixed(3)}`),
		element('span', '', `Saturation ${feature.saturation.toFixed(3)}`),
		element('span', '', `Color diversity ${feature.colorDiversity.toFixed(3)}`),
		element('span', '', `Palette concentration ${feature.paletteConcentration.toFixed(3)}`),
		element('span', '', `Tone strength ${feature.toneStrength.toFixed(3)}`),
		element('span', '', `Neutral strength ${feature.neutralStrength.toFixed(3)}`),
		element('strong', `classification ${classification}`, classification.replace('-', ' ')),
	);
	card.append(palette, average);
	return card;
}

async function updateMatches() {
	const request = ++matchRequest;
	const selected = colorPicker.value;
	colorValue.value = selected;
	matches.setAttribute('aria-busy', 'true');
	try {
		const response = await fetch(`/api/matches?color=${encodeURIComponent(selected)}`);
		const results = await readResponse(response);
		if (request !== matchRequest) return;
		const count = Math.max(5, Math.min(100, Number(resultCount.value) || 30));
		matches.replaceChildren(...results.slice(0, count).map(renderMatch));
	} catch (error) {
		if (request === matchRequest) matches.replaceChildren(element('p', 'error', error.message));
	} finally {
		if (request === matchRequest) matches.removeAttribute('aria-busy');
	}
}

function renderMatch(result, index) {
	const item = element('article', 'match-card');
	const image = document.createElement('img');
	image.src = result.imageUrl;
	image.alt = result.id;
	image.loading = 'lazy';
	item.append(
		image,
		element('strong', '', `${index + 1}. ${result.id}`),
		element('span', '', `score ${result.score.toFixed(2)}`),
		element(
			'small',
			'',
			`similarity ${result.similarity.toFixed(2)} · confidence ${result.confidence.toFixed(2)} · palette distance ${result.paletteDistance.toFixed(2)} · average distance ${result.averageDistance.toFixed(2)} · selected hue ${result.selectedHueCoverage.toFixed(2)}`,
		),
	);
	return item;
}

function classifyTone(feature) {
	if (feature.neutralStrength >= 0.65) return 'neutral';
	if (feature.colorDiversity >= 0.55 || feature.toneStrength < 0.25) return 'multicolor';
	if (feature.toneStrength >= 0.6) return 'strong-tone';
	return 'mixed-tone';
}

async function readResponse(response) {
	const body = await response.json();
	if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
	return body;
}

function showFatalError(error) {
	summary.textContent = error.message;
	summary.className = 'error';
}

function element(tag, className, text) {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

function rgb(value) {
	return `rgb(${value.join(' ')})`;
}

function percent(value) {
	return `${Math.round(value * 100)}%`;
}

function labCss(lab) {
	return `lab(${lab[0]}% ${lab[1]} ${lab[2]})`;
}
