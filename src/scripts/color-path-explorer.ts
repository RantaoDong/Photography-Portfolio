import { colorPathConfig } from '../color/color-path-config.ts';
import {
	createColorPathSequence,
	type ColorPathSequenceEntry,
} from '../color/color-path-sequencing.ts';
import {
	ColorPathImagePreloader,
	finishColorPathTransition,
	runColorPathTransition,
} from '../color/color-path-transition.ts';
import { createSoftColorPathGradient } from '../color/color-path-ui.ts';
import {
	colorPathPointToRgb,
	interpolateColorPath,
	type ColorPathPoint,
} from '../color/color-path.ts';
import type { ColorToneCandidate } from '../color/color-tone-matching.ts';

interface ColorPathPhoto extends ColorToneCandidate {
	src: string;
	width: number;
	height: number;
	alt: string;
}

interface ActiveColorPathPhoto extends ColorPathSequenceEntry {
	photo: ColorPathPhoto;
}

const disk = document.querySelector<HTMLCanvasElement>('#color-path-disk');
const preview = document.querySelector<HTMLCanvasElement>('#color-path-preview');
const exploreButton = document.querySelector<HTMLButtonElement>('#color-path-explore');
const undoButton = document.querySelector<HTMLButtonElement>('#color-path-undo');
const resetButton = document.querySelector<HTMLButtonElement>('#color-path-reset');
const previousButton = document.querySelector<HTMLButtonElement>('#color-path-previous');
const nextButton = document.querySelector<HTMLButtonElement>('#color-path-next');
const status = document.querySelector<HTMLElement>('#color-path-status');
const resultSection = document.querySelector<HTMLElement>('#color-path-results');
const draftNote = document.querySelector<HTMLElement>('#color-path-draft-note');
const emptyMessage = document.querySelector<HTMLElement>('#color-path-empty');
const figure = document.querySelector<HTMLElement>('#color-path-figure');
const image = document.querySelector<HTMLImageElement>('#color-path-photo');
const transitionCanvas = document.querySelector<HTMLCanvasElement>('#color-path-transition');
const positionIndicator = document.querySelector<HTMLElement>('#color-path-position');
const positionMarker = document.querySelector<HTMLElement>('#color-path-position-marker');
const indexLabel = document.querySelector<HTMLElement>('#color-path-index');
const dataElement = document.querySelector<HTMLScriptElement>('#color-path-data');

if (
	disk &&
	preview &&
	exploreButton &&
	undoButton &&
	resetButton &&
	previousButton &&
	nextButton &&
	status &&
	resultSection &&
	draftNote &&
	emptyMessage &&
	figure &&
	image &&
	transitionCanvas &&
	positionIndicator &&
	positionMarker &&
	indexLabel &&
	dataElement
) {
	setupColorPath({
		disk,
		preview,
		exploreButton,
		undoButton,
		resetButton,
		previousButton,
		nextButton,
		status,
		resultSection,
		draftNote,
		emptyMessage,
		figure,
		image,
		transitionCanvas,
		positionIndicator,
		positionMarker,
		indexLabel,
		photos: JSON.parse(dataElement.textContent || '[]') as ColorPathPhoto[],
	});
}

function setupColorPath(elements: {
	disk: HTMLCanvasElement;
	preview: HTMLCanvasElement;
	exploreButton: HTMLButtonElement;
	undoButton: HTMLButtonElement;
	resetButton: HTMLButtonElement;
	previousButton: HTMLButtonElement;
	nextButton: HTMLButtonElement;
	status: HTMLElement;
	resultSection: HTMLElement;
	draftNote: HTMLElement;
	emptyMessage: HTMLElement;
	figure: HTMLElement;
	image: HTMLImageElement;
	transitionCanvas: HTMLCanvasElement;
	positionIndicator: HTMLElement;
	positionMarker: HTMLElement;
	indexLabel: HTMLElement;
	photos: ColorPathPhoto[];
}) {
	const {
		disk,
		preview,
		exploreButton,
		undoButton,
		resetButton,
		previousButton,
		nextButton,
		status,
		resultSection,
		draftNote,
		emptyMessage,
		figure,
		image,
		transitionCanvas,
		positionIndicator,
		positionMarker,
		indexLabel,
		photos,
	} = elements;
	const photosById = new Map(photos.map((photo) => [photo.id, photo]));
	const preloader = new ColorPathImagePreloader();
	const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
	let draftPoints: ColorPathPoint[] = [];
	let committedPoints: ColorPathPoint[] | null = null;
	let activePhotos: ActiveColorPathPhoto[] = [];
	let activeIndex = 0;
	let transitioning = false;

	drawColorDisk(disk, draftPoints, true);
	updateControls();

	disk.addEventListener('pointerdown', (event) => {
		if (event.button !== 0 || draftPoints.length >= colorPathConfig.controlPoints.maximum) return;
		const point = pointFromPointer(disk, event);
		if (!point) return;
		event.preventDefault();
		draftPoints = [...draftPoints, point];
		drawColorDisk(disk, draftPoints, true);
		updateControls();
	});
	undoButton.addEventListener('click', () => {
		draftPoints = draftPoints.slice(0, -1);
		drawColorDisk(disk, draftPoints, true);
		updateControls();
	});
	resetButton.addEventListener('click', () => {
		draftPoints = [];
		drawColorDisk(disk, draftPoints, true);
		updateControls();
		disk.focus();
	});
	exploreButton.addEventListener('click', commitPath);
	previousButton.addEventListener('click', () => void navigate(-1));
	nextButton.addEventListener('click', () => void navigate(1));
	image.addEventListener('dragstart', (event) => event.preventDefault());
	document.addEventListener('keydown', (event) => {
		if (resultSection.hidden) return;
		if (event.key === 'ArrowLeft') void navigate(-1);
		else if (event.key === 'ArrowRight') void navigate(1);
		else return;
		event.preventDefault();
	});

	function commitPath() {
		if (transitioning || draftPoints.length < colorPathConfig.controlPoints.minimum) return;
		committedPoints = draftPoints.map((point) => ({ ...point }));
		const sequence = createColorPathSequence(photos, committedPoints);
		activePhotos = sequence.flatMap((entry) => {
			const photo = photosById.get(entry.id);
			return photo ? [{ ...entry, photo }] : [];
		});
		activeIndex = 0;
		preloader.clear();
		finishColorPathTransition(transitionCanvas);
		resultSection.hidden = false;
		draftNote.hidden = true;
		drawColorDisk(preview, committedPoints, false);
		positionIndicator.style.setProperty(
			'--path-ribbon',
			createSoftColorPathGradient(committedPoints),
		);
		renderActivePhoto();
		updateControls();
	}

	async function navigate(direction: number) {
		if (transitioning) return;
		const nextIndex = activeIndex + direction;
		if (nextIndex < 0 || nextIndex >= activePhotos.length) return;
		if (reducedMotion.matches || !committedPoints) {
			activeIndex = nextIndex;
			renderActivePhoto();
			return;
		}

		const current = activePhotos[activeIndex];
		const next = activePhotos[nextIndex];
		transitioning = true;
		updateNavigationState();
		updateControls();
		try {
			const [currentSource, nextSource] = await Promise.all([
				preloader.load(current.photo.src),
				preloader.load(next.photo.src),
			]);
			const transition = runColorPathTransition({
				canvas: transitionCanvas,
				currentImage: currentSource,
				nextImage: nextSource,
				currentColor: colorAtPathPosition(current.pathPosition),
				nextColor: colorAtPathPosition(next.pathPosition),
			});
			image.src = next.photo.src;
			image.alt = next.photo.alt;
			await Promise.all([transition, waitForImage(image)]);
			activeIndex = nextIndex;
			updatePhotoMetadata();
		} catch {
			activeIndex = nextIndex;
			image.src = next.photo.src;
			image.alt = next.photo.alt;
			updatePhotoMetadata();
		} finally {
			finishColorPathTransition(transitionCanvas);
			transitioning = false;
			updateNavigationState();
			updateControls();
			preloadAdjacentPhotos();
		}
	}

	function renderActivePhoto() {
		finishColorPathTransition(transitionCanvas);
		const active = activePhotos[activeIndex];
		const hasPhoto = Boolean(active);
		emptyMessage.hidden = hasPhoto;
		figure.hidden = !hasPhoto;
		if (!active) return;
		image.src = active.photo.src;
		image.alt = active.photo.alt;
		updatePhotoMetadata();
		preloadAdjacentPhotos();
	}

	function updatePhotoMetadata() {
		indexLabel.textContent = `${formatIndex(activeIndex + 1)} / ${formatIndex(activePhotos.length)}`;
		const active = activePhotos[activeIndex];
		if (active) {
			const position = Math.min(1, Math.max(0, active.pathPosition));
			positionMarker.style.left = `${position * 100}%`;
			positionIndicator.setAttribute(
				'aria-label',
				`Current photograph at ${Math.round(position * 100)}% of the color path`,
			);
		}
		updateNavigationState();
	}

	function updateNavigationState() {
		previousButton.disabled = transitioning || activeIndex === 0;
		nextButton.disabled = transitioning || activeIndex === activePhotos.length - 1;
	}

	function preloadAdjacentPhotos() {
		for (const index of [activeIndex - 1, activeIndex, activeIndex + 1]) {
			const active = activePhotos[index];
			if (active) void preloader.load(active.photo.src).catch(() => undefined);
		}
	}

	function colorAtPathPosition(position: number) {
		return colorPathPointToRgb(interpolateColorPath(committedPoints ?? [], position));
	}

	function updateControls() {
		const count = draftPoints.length;
		const changed = !committedPoints || !pathsEqual(draftPoints, committedPoints);
		exploreButton.disabled =
			transitioning || count < colorPathConfig.controlPoints.minimum || !changed;
		undoButton.disabled = count === 0;
		resetButton.disabled = count === 0;
		draftNote.hidden = resultSection.hidden || !changed;
		status.textContent =
			count === colorPathConfig.controlPoints.maximum
				? '5 colors selected. Ready to explore.'
				: count < colorPathConfig.controlPoints.minimum
					? `${count} colors selected. Choose ${colorPathConfig.controlPoints.minimum - count} more.`
					: `${count} colors selected. Ready to explore or choose another color.`;
	}
}

function drawColorDisk(canvas: HTMLCanvasElement, points: ColorPathPoint[], showNumbers: boolean) {
	const context = canvas.getContext('2d');
	if (!context) return;
	const centerX = canvas.width / 2;
	const centerY = canvas.height / 2;
	const radius = Math.min(canvas.width, canvas.height) / 2 - Math.max(5, canvas.width * 0.025);
	const pixels = context.createImageData(canvas.width, canvas.height);
	for (let y = 0; y < canvas.height; y += 1) {
		for (let x = 0; x < canvas.width; x += 1) {
			const point = { x: (x - centerX) / radius, y: (y - centerY) / radius };
			if (Math.hypot(point.x, point.y) > 1) continue;
			const rgb = colorPathPointToRgb(point);
			const offset = (y * canvas.width + x) * 4;
			pixels.data[offset] = rgb[0];
			pixels.data[offset + 1] = rgb[1];
			pixels.data[offset + 2] = rgb[2];
			pixels.data[offset + 3] = 255;
		}
	}
	context.clearRect(0, 0, canvas.width, canvas.height);
	context.putImageData(pixels, 0, 0);

	if (points.length > 1) {
		context.beginPath();
		points.forEach((point, index) => {
			const canvasPoint = toCanvasPoint(point, centerX, centerY, radius);
			if (index === 0) context.moveTo(canvasPoint.x, canvasPoint.y);
			else context.lineTo(canvasPoint.x, canvasPoint.y);
		});
		context.lineWidth = Math.max(3, canvas.width * 0.018);
		context.strokeStyle = 'rgb(255 255 255 / 0.95)';
		context.stroke();
		context.lineWidth = Math.max(1, canvas.width * 0.006);
		context.strokeStyle = 'rgb(17 24 39 / 0.9)';
		context.stroke();
	}

	points.forEach((point, index) => {
		const canvasPoint = toCanvasPoint(point, centerX, centerY, radius);
		const markerRadius = Math.max(5, canvas.width * 0.036);
		context.beginPath();
		context.arc(canvasPoint.x, canvasPoint.y, markerRadius, 0, Math.PI * 2);
		context.fillStyle = 'white';
		context.fill();
		context.lineWidth = Math.max(1.5, canvas.width * 0.006);
		context.strokeStyle = 'black';
		context.stroke();
		if (!showNumbers) return;
		context.fillStyle = 'black';
		context.font = `600 ${Math.max(9, canvas.width * 0.035)}px system-ui, sans-serif`;
		context.textAlign = 'center';
		context.textBaseline = 'middle';
		context.fillText(String(index + 1), canvasPoint.x, canvasPoint.y + canvas.width * 0.002);
	});
}

function pointFromPointer(canvas: HTMLCanvasElement, event: PointerEvent): ColorPathPoint | null {
	const bounds = canvas.getBoundingClientRect();
	const radius = Math.min(bounds.width, bounds.height) / 2;
	const point = {
		x: (event.clientX - bounds.left - bounds.width / 2) / radius,
		y: (event.clientY - bounds.top - bounds.height / 2) / radius,
	};
	return Math.hypot(point.x, point.y) <= 1 ? point : null;
}

function toCanvasPoint(point: ColorPathPoint, centerX: number, centerY: number, radius: number) {
	return { x: centerX + point.x * radius, y: centerY + point.y * radius };
}

function pathsEqual(first: ColorPathPoint[], second: ColorPathPoint[]) {
	return (
		first.length === second.length &&
		first.every((point, index) => point.x === second[index].x && point.y === second[index].y)
	);
}

function formatIndex(value: number) {
	return String(value).padStart(2, '0');
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
