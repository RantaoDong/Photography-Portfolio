import { findColorWalkMatches, type ColorWalkCandidate } from '../color/color-walk-matching.ts';
import { renderColorWalkImage } from '../color/color-walk-rendering.ts';
import type { RgbColor } from '../color/color-types.ts';
import { drawHueWheel, hueToRgb, normalizeHue } from '../color/color-wheel.ts';
import { ColorWalkImageCache } from './color-walk-cache.ts';

interface ColorWalkPhoto extends ColorWalkCandidate {
	src: string;
	width: number;
	height: number;
	alt: string;
}

const wheel = document.querySelector<HTMLCanvasElement>('#color-walk-wheel');
const startButton = document.querySelector<HTMLButtonElement>('#color-walk-start');
const resetButton = document.querySelector<HTMLButtonElement>('#color-walk-reset');
const changeButton = document.querySelector<HTMLButtonElement>('#color-walk-change');
const previousButton = document.querySelector<HTMLButtonElement>('#color-walk-previous');
const nextButton = document.querySelector<HTMLButtonElement>('#color-walk-next');
const selectionSection = document.querySelector<HTMLElement>('#color-walk-selection');
const walkSection = document.querySelector<HTMLElement>('#color-walk-session');
const photoSurface = document.querySelector<HTMLElement>('#color-walk-photo-surface');
const treatedCanvas = document.querySelector<HTMLCanvasElement>('#color-walk-treated');
const originalImage = document.querySelector<HTMLImageElement>('#color-walk-original');
const instruction = document.querySelector<HTMLElement>('#color-walk-instruction');
const status = document.querySelector<HTMLElement>('#color-walk-status');
const navigation = document.querySelector<HTMLElement>('#color-walk-navigation');
const indexLabel = document.querySelector<HTMLElement>('#color-walk-index');
const swatch = document.querySelector<HTMLElement>('#color-walk-swatch');
const dataElement = document.querySelector<HTMLScriptElement>('#color-walk-data');

if (
	wheel &&
	startButton &&
	resetButton &&
	changeButton &&
	previousButton &&
	nextButton &&
	selectionSection &&
	walkSection &&
	photoSurface &&
	treatedCanvas &&
	originalImage &&
	instruction &&
	status &&
	navigation &&
	indexLabel &&
	swatch &&
	dataElement
) {
	setupColorWalk({
		wheel,
		startButton,
		resetButton,
		changeButton,
		previousButton,
		nextButton,
		selectionSection,
		walkSection,
		photoSurface,
		treatedCanvas,
		originalImage,
		instruction,
		status,
		navigation,
		indexLabel,
		swatch,
		photos: JSON.parse(dataElement.textContent || '[]') as ColorWalkPhoto[],
	});
}

function setupColorWalk(elements: {
	wheel: HTMLCanvasElement;
	startButton: HTMLButtonElement;
	resetButton: HTMLButtonElement;
	changeButton: HTMLButtonElement;
	previousButton: HTMLButtonElement;
	nextButton: HTMLButtonElement;
	selectionSection: HTMLElement;
	walkSection: HTMLElement;
	photoSurface: HTMLElement;
	treatedCanvas: HTMLCanvasElement;
	originalImage: HTMLImageElement;
	instruction: HTMLElement;
	status: HTMLElement;
	navigation: HTMLElement;
	indexLabel: HTMLElement;
	swatch: HTMLElement;
	photos: ColorWalkPhoto[];
}) {
	const {
		wheel,
		startButton,
		resetButton,
		changeButton,
		previousButton,
		nextButton,
		selectionSection,
		walkSection,
		photoSurface,
		treatedCanvas,
		originalImage,
		instruction,
		status,
		navigation,
		indexLabel,
		swatch,
		photos,
	} = elements;
	const photosById = new Map(photos.map((photo) => [photo.id, photo]));
	const cache = new ColorWalkImageCache();
	let draftHue: number | null = null;
	let selectedColor: RgbColor | null = null;
	let activePhotos: ColorWalkPhoto[] = [];
	let activeIndex = 0;
	let draggingWheel = false;
	let holdingOriginal = false;
	let loadVersion = 0;
	let photoReady = false;
	let hasRenderedPhoto = false;

	drawHueWheel(wheel, draftHue);
	updatePickerState();

	wheel.addEventListener('pointerdown', (event) => {
		draggingWheel = true;
		wheel.setPointerCapture(event.pointerId);
		selectFromPointer(event);
	});
	wheel.addEventListener('pointermove', (event) => {
		if (draggingWheel) selectFromPointer(event);
	});
	wheel.addEventListener('pointerup', (event) => {
		draggingWheel = false;
		if (wheel.hasPointerCapture(event.pointerId)) wheel.releasePointerCapture(event.pointerId);
	});
	wheel.addEventListener('pointercancel', () => {
		draggingWheel = false;
	});
	wheel.addEventListener('keydown', (event) => {
		const increment = event.shiftKey ? 15 : 3;
		const startingHue = draftHue ?? 210;
		if (event.key === 'ArrowLeft' || event.key === 'ArrowDown')
			draftHue = normalizeHue(startingHue - increment);
		else if (event.key === 'ArrowRight' || event.key === 'ArrowUp')
			draftHue = normalizeHue(startingHue + increment);
		else return;
		event.preventDefault();
		commitHueSelection();
	});

	startButton.addEventListener('click', startWalk);
	changeButton.addEventListener('click', () => returnToPicker(false));
	resetButton.addEventListener('click', () => returnToPicker(true));
	previousButton.addEventListener('click', () => navigate(-1));
	nextButton.addEventListener('click', () => navigate(1));

	photoSurface.addEventListener('pointerdown', revealOriginal);
	photoSurface.addEventListener('pointerup', restoreEmphasis);
	photoSurface.addEventListener('pointercancel', restoreEmphasis);
	photoSurface.addEventListener('lostpointercapture', restoreEmphasis);
	originalImage.addEventListener('dragstart', (event) => event.preventDefault());
	photoSurface.addEventListener('keydown', (event) => {
		if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
			event.preventDefault();
			showOriginal();
		}
	});
	photoSurface.addEventListener('keyup', (event) => {
		if (event.key === ' ' || event.key === 'Enter') {
			event.preventDefault();
			showEmphasis();
		}
	});
	photoSurface.addEventListener('blur', showEmphasis);
	window.addEventListener('blur', showEmphasis);

	function selectFromPointer(event: PointerEvent) {
		const bounds = wheel.getBoundingClientRect();
		const x = event.clientX - bounds.left - bounds.width / 2;
		const y = event.clientY - bounds.top - bounds.height / 2;
		draftHue = normalizeHue((Math.atan2(y, x) * 180) / Math.PI + 90);
		commitHueSelection();
	}

	function commitHueSelection() {
		if (draftHue === null) return;
		wheel.setAttribute('aria-valuenow', String(Math.round(draftHue)));
		wheel.setAttribute('aria-valuetext', `${Math.round(draftHue)}° hue`);
		drawHueWheel(wheel, draftHue);
		updatePickerState();
	}

	function updatePickerState() {
		startButton.disabled = draftHue === null;
	}

	function startWalk() {
		if (draftHue === null) return;
		selectedColor = hueToRgb(draftHue);
		cache.clear();
		activePhotos = findColorWalkMatches(photos, selectedColor).flatMap((match) => {
			const photo = photosById.get(match.id);
			return photo ? [photo] : [];
		});
		activeIndex = 0;
		hasRenderedPhoto = false;
		swatch.style.backgroundColor = `rgb(${selectedColor.join(' ')})`;
		selectionSection.hidden = true;
		walkSection.hidden = false;
		void renderActivePhoto();
	}

	function returnToPicker(clearSelection: boolean) {
		loadVersion += 1;
		showEmphasis();
		cache.clear();
		selectedColor = null;
		activePhotos = [];
		activeIndex = 0;
		hasRenderedPhoto = false;
		walkSection.hidden = true;
		selectionSection.hidden = false;
		if (clearSelection) {
			draftHue = null;
			wheel.removeAttribute('aria-valuenow');
			wheel.removeAttribute('aria-valuetext');
			drawHueWheel(wheel, draftHue);
		}
		updatePickerState();
		wheel.focus();
	}

	function navigate(direction: number) {
		const nextIndex = activeIndex + direction;
		if (nextIndex < 0 || nextIndex >= activePhotos.length) return;
		activeIndex = nextIndex;
		showEmphasis();
		void renderActivePhoto();
	}

	async function renderActivePhoto() {
		const version = ++loadVersion;
		showEmphasis();
		photoReady = false;
		photoSurface.hidden = !hasRenderedPhoto;
		instruction.hidden = !hasRenderedPhoto;
		navigation.hidden = activePhotos.length === 0;
		status.hidden = false;
		previousButton.disabled = true;
		nextButton.disabled = true;

		if (!selectedColor || activePhotos.length === 0) {
			status.textContent = 'No photographs contain enough of this color yet.';
			return;
		}

		const photo = activePhotos[activeIndex];
		status.textContent = 'Preparing photograph…';
		indexLabel.textContent = `${String(activeIndex + 1).padStart(2, '0')} / ${String(activePhotos.length).padStart(2, '0')}`;
		originalImage.alt = photo.alt;
		originalImage.src = photo.src;

		try {
			await waitForImage(originalImage);
			if (version !== loadVersion || !selectedColor) return;
			const rendered = await cache.get(photo.id, selectedColor, () =>
				renderColorWalkImage(originalImage, selectedColor as RgbColor),
			);
			if (version !== loadVersion) return;
			treatedCanvas.width = rendered.width;
			treatedCanvas.height = rendered.height;
			const context = treatedCanvas.getContext('2d');
			if (!context) throw new Error('Canvas rendering is unavailable.');
			context.drawImage(rendered, 0, 0);
			hasRenderedPhoto = true;
			photoReady = true;
			status.hidden = true;
			photoSurface.hidden = false;
			instruction.hidden = false;
			showEmphasis();
			updateNavigationState();
		} catch {
			if (version !== loadVersion) return;
			status.textContent = 'This photograph could not be prepared.';
			updateNavigationState();
		}
	}

	function updateNavigationState() {
		previousButton.disabled = activeIndex === 0;
		nextButton.disabled = activeIndex === activePhotos.length - 1;
	}

	function revealOriginal(event: PointerEvent) {
		if (!photoReady || event.button !== 0) return;
		event.preventDefault();
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		showOriginal();
	}

	function restoreEmphasis(event: PointerEvent) {
		const target = event.currentTarget as HTMLElement;
		if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
		showEmphasis();
	}

	function showOriginal() {
		if (!photoReady || holdingOriginal) return;
		holdingOriginal = true;
		treatedCanvas.hidden = true;
		originalImage.hidden = false;
		instruction.textContent = 'Release to highlight selected color';
	}

	function showEmphasis() {
		holdingOriginal = false;
		originalImage.hidden = true;
		treatedCanvas.hidden = !hasRenderedPhoto;
		instruction.textContent = 'Hold image to reveal original';
	}
}

function waitForImage(image: HTMLImageElement) {
	if (image.complete && image.naturalWidth > 0) return Promise.resolve();
	return new Promise<void>((resolve, reject) => {
		image.addEventListener('load', () => resolve(), { once: true });
		image.addEventListener('error', () => reject(new Error('Image failed to load.')), {
			once: true,
		});
	});
}
