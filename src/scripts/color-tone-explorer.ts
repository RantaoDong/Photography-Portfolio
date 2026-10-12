import GLightbox from 'glightbox';
import { findColorToneMatches, type ColorToneCandidate } from '../color/color-tone-matching.ts';
import { createOrientationRowLayout } from './orientation-row-layout.ts';

interface SearchSettings {
	hue: number;
}

const wheel = document.querySelector<HTMLCanvasElement>('#color-tone-wheel');
const exploreButton = document.querySelector<HTMLButtonElement>('#color-tone-explore');
const resetButton = document.querySelector<HTMLButtonElement>('#color-tone-reset');
const resultSection = document.querySelector<HTMLElement>('#color-tone-result-section');
const resultGrid = document.querySelector<HTMLElement>('#color-tone-results');
const emptyMessage = document.querySelector<HTMLElement>('#color-tone-empty');
const dataElement = document.querySelector<HTMLScriptElement>('#color-tone-data');

if (
	wheel &&
	exploreButton &&
	resetButton &&
	resultSection &&
	resultGrid &&
	emptyMessage &&
	dataElement
) {
	setupColorToneExplorer({
		wheel,
		exploreButton,
		resetButton,
		resultSection,
		resultGrid,
		emptyMessage,
		candidates: JSON.parse(dataElement.textContent || '[]') as ColorToneCandidate[],
	});
}

function setupColorToneExplorer(elements: {
	wheel: HTMLCanvasElement;
	exploreButton: HTMLButtonElement;
	resetButton: HTMLButtonElement;
	resultSection: HTMLElement;
	resultGrid: HTMLElement;
	emptyMessage: HTMLElement;
	candidates: ColorToneCandidate[];
}) {
	const { wheel, exploreButton, resetButton, resultSection, resultGrid, emptyMessage, candidates } =
		elements;
	const photoElements = new Map(
		Array.from(resultGrid.querySelectorAll<HTMLElement>('.color-tone-photo')).map((element) => [
			element.dataset.photoId || '',
			element,
		]),
	);
	let draftHue: number | null = null;
	let committed: SearchSettings | null = null;
	let visiblePhotoIds: string[] = [];
	let lightbox: ReturnType<typeof GLightbox> | null = null;
	let draggingWheel = false;

	drawHueWheel(wheel, draftHue);
	updateControlState();

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
		wheel.releasePointerCapture(event.pointerId);
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

	exploreButton.addEventListener('click', () => {
		if (draftHue === null) return;
		committed = { hue: draftHue };
		const matches = findColorToneMatches(candidates, hueToRgb(draftHue));
		visiblePhotoIds = matches.map((match) => match.id);
		renderResults();
		updateControlState();
	});

	resetButton.addEventListener('click', reset);
	window.addEventListener('resize', debounce(layoutResults, 200));

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
		updateControlState();
	}

	function updateControlState() {
		const unchanged = committed?.hue === draftHue;
		exploreButton.disabled = draftHue === null || unchanged;
		resetButton.hidden = draftHue === null && !committed;
	}

	function renderResults() {
		for (const element of photoElements.values()) {
			element.hidden = true;
			element.style.display = 'none';
		}
		const fragment = document.createDocumentFragment();
		for (const id of visiblePhotoIds) {
			const element = photoElements.get(id);
			if (!element) continue;
			element.hidden = false;
			fragment.append(element);
		}
		resultGrid.append(fragment);
		resultSection.hidden = false;
		emptyMessage.hidden = visiblePhotoIds.length > 0;
		resultGrid.hidden = visiblePhotoIds.length === 0;
		requestAnimationFrame(() => {
			layoutResults();
			lightbox?.destroy();
			lightbox =
				visiblePhotoIds.length > 0
					? GLightbox({ selector: '#color-tone-results .glightbox:not([hidden])' })
					: null;
		});
	}

	function layoutResults() {
		if (visiblePhotoIds.length === 0 || resultSection.hidden) return;
		const visible = visiblePhotoIds.flatMap((id) => {
			const element = photoElements.get(id);
			return element ? [element] : [];
		});
		const layout = createOrientationRowLayout(
			visible.map((element) => ({
				width: Number(element.dataset.width),
				height: Number(element.dataset.height),
				group: '__all__',
			})),
			resultGrid.clientWidth || window.innerWidth,
			{ reorderWithinGroup: true, expandRowsToFullWidth: false },
		);
		visible.forEach((element, index) => {
			const box = layout.boxes[index];
			if (!box) return;
			element.style.display = 'block';
			element.style.left = `${box.left}px`;
			element.style.top = `${box.top}px`;
			element.style.width = `${box.width}px`;
			element.style.height = `${box.height}px`;
		});
		resultGrid.style.height = `${layout.containerHeight}px`;
	}

	function reset() {
		draftHue = null;
		committed = null;
		visiblePhotoIds = [];
		wheel.removeAttribute('aria-valuenow');
		wheel.removeAttribute('aria-valuetext');
		drawHueWheel(wheel, draftHue);
		resultSection.hidden = true;
		resultGrid.style.height = '0px';
		lightbox?.destroy();
		lightbox = null;
		for (const element of photoElements.values()) {
			element.hidden = true;
			element.style.display = 'none';
		}
		updateControlState();
	}
}

function drawHueWheel(canvas: HTMLCanvasElement, selectedHue: number | null) {
	const context = canvas.getContext('2d');
	if (!context) return;
	const center = canvas.width / 2;
	const radius = canvas.width * 0.41;
	const ringWidth = canvas.width * 0.17;
	context.clearRect(0, 0, canvas.width, canvas.height);
	context.lineWidth = ringWidth;
	for (let hue = 0; hue < 360; hue += 1) {
		context.beginPath();
		context.strokeStyle = `hsl(${hue} 100% 50%)`;
		context.arc(center, center, radius, ((hue - 91) * Math.PI) / 180, ((hue - 89) * Math.PI) / 180);
		context.stroke();
	}
	if (selectedHue === null) return;
	const angle = ((selectedHue - 90) * Math.PI) / 180;
	const x = center + Math.cos(angle) * radius;
	const y = center + Math.sin(angle) * radius;
	context.beginPath();
	context.arc(x, y, ringWidth * 0.34, 0, Math.PI * 2);
	context.lineWidth = 5;
	context.strokeStyle = 'white';
	context.stroke();
	context.lineWidth = 2;
	context.strokeStyle = 'black';
	context.stroke();
}

function hueToRgb(hue: number): [number, number, number] {
	const chroma = 1;
	const segment = hue / 60;
	const intermediate = chroma * (1 - Math.abs((segment % 2) - 1));
	const [red, green, blue] =
		segment < 1
			? [chroma, intermediate, 0]
			: segment < 2
				? [intermediate, chroma, 0]
				: segment < 3
					? [0, chroma, intermediate]
					: segment < 4
						? [0, intermediate, chroma]
						: segment < 5
							? [intermediate, 0, chroma]
							: [chroma, 0, intermediate];
	const offset = 0;
	return [red, green, blue].map((channel) => Math.round((channel + offset) * 255)) as [
		number,
		number,
		number,
	];
}

function normalizeHue(value: number) {
	return ((value % 360) + 360) % 360;
}

function debounce(callback: () => void, wait: number) {
	let timeout: ReturnType<typeof setTimeout>;
	return () => {
		clearTimeout(timeout);
		timeout = setTimeout(callback, wait);
	};
}
