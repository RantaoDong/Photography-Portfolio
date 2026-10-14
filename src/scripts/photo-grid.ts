import GLightbox from 'glightbox';
import { createOrientationRowLayout, type RowLayout } from './orientation-row-layout';

let lightbox: ReturnType<typeof GLightbox> | null = null;

export function setupGallery() {
	if (typeof document === 'undefined') return;

	const container = document.getElementById('photo-grid');
	if (!container) return;

	const imageLinks = Array.from(container.querySelectorAll('.photo-item')) as HTMLElement[];

	if (imageLinks.length === 0) return;

	const layout = createOrientationRowLayout(
		imageLinks.map((link) => ({
			width: Number(link.dataset.width),
			height: Number(link.dataset.height),
			group: `${link.dataset.layoutBatch ?? '0'}:${link.dataset.layoutGroup ?? '__all__'}`,
		})),
		container.clientWidth || window.innerWidth,
		{ reorderWithinGroup: container.dataset.reorderWithinGroup === 'true' },
	);

	applyImagesStyleBasedOnLayout(imageLinks, layout);
	applyContainerStyleBasedOnLayout(container, layout);

	lightbox?.destroy();
	lightbox = GLightbox({
		selector: '.glightbox',
		openEffect: 'zoom',
		closeEffect: 'fade',
		width: 'auto',
		height: 'auto',
	});

	const root = container.closest<HTMLElement>('[data-photo-grid-root]');
	if (root) updateProgressiveControls(root, imageLinks.length);
}

function loadNextBatch(button: HTMLButtonElement) {
	const root = button.closest<HTMLElement>('[data-photo-grid-root]');
	const container = root?.querySelector<HTMLElement>('#photo-grid');
	const template = root?.querySelector<HTMLTemplateElement>('template[data-photo-grid-batch]');
	if (!root || !container || !template) return;

	container.append(template.content.cloneNode(true));
	template.remove();
	setupGallery();
	button.focus({ preventScroll: true });
}

function updateProgressiveControls(root: HTMLElement, visibleCount: number) {
	const controls = root.querySelector<HTMLElement>('[data-photo-grid-controls]');
	if (!controls) return;

	const hasMore = Boolean(root.querySelector('template[data-photo-grid-batch]'));
	const totalCount = Number(root.dataset.totalCount) || visibleCount;
	const count = controls.querySelector<HTMLElement>('[data-photo-grid-count]');
	controls.hidden = !hasMore;
	if (count) count.textContent = `${visibleCount} / ${totalCount}`;
}

function applyImagesStyleBasedOnLayout(imageLinks: HTMLElement[], layout: RowLayout) {
	imageLinks.forEach((el, i) => {
		if (!layout.boxes[i]) return;
		const { left, top, width, height } = layout.boxes[i];

		el.style.position = 'absolute';
		el.style.left = `${left}px`;
		el.style.top = `${top}px`;
		el.style.width = `${width}px`;
		el.style.height = `${height}px`;
		el.style.display = 'block';
	});
}

function applyContainerStyleBasedOnLayout(container: HTMLElement, layout: RowLayout) {
	container.style.position = 'relative';
	container.style.height = `${layout.containerHeight}px`;
}
// Module scripts run after their markup is parsed, so lay out immediately instead of
// waiting on unrelated deferred resources to release DOMContentLoaded.
if (typeof window !== 'undefined') {
	const debouncedSetup = debounce(setupGallery, 250);

	setupGallery();
	window.addEventListener('resize', debouncedSetup);
	document.addEventListener('click', (event) => {
		if (!(event.target instanceof Element)) return;
		const button = event.target.closest<HTMLButtonElement>('[data-photo-grid-load-more]');
		if (button) loadNextBatch(button);
	});
}

// Debounce helper
function debounce<T extends (...args: unknown[]) => unknown>(func: T, wait: number) {
	let timeout: ReturnType<typeof setTimeout>;
	return function executedFunction(...args: Parameters<T>) {
		const later = () => {
			clearTimeout(timeout);
			func(...args);
		};
		clearTimeout(timeout);
		timeout = setTimeout(later, wait);
	};
}
