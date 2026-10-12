import GLightbox from 'glightbox';
import { createOrientationRowLayout, type RowLayout } from './orientation-row-layout';

let lightboxInitialized = false;

export function setupGallery() {
	if (typeof document === 'undefined') return;

	const container = document.getElementById('photo-grid');
	if (!container) {
		console.error('Photo grid container not found.');
		return;
	}

	const imageLinks = Array.from(container.querySelectorAll('.photo-item')) as HTMLElement[];

	if (imageLinks.length === 0) {
		console.warn('No images found inside the photo grid.');
		return;
	}

	const layout = createOrientationRowLayout(
		imageLinks.map((link) => ({
			width: Number(link.dataset.width),
			height: Number(link.dataset.height),
			group: link.dataset.layoutGroup,
		})),
		container.clientWidth || window.innerWidth,
		{ reorderWithinGroup: container.dataset.reorderWithinGroup === 'true' },
	);

	applyImagesStyleBasedOnLayout(imageLinks, layout);
	applyContainerStyleBasedOnLayout(container, layout);

	if (!lightboxInitialized) {
		GLightbox({
			selector: '.glightbox',
			openEffect: 'zoom',
			closeEffect: 'fade',
			width: 'auto',
			height: 'auto',
		});
		lightboxInitialized = true;
	}
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
// Run setupGallery once the page is loaded
if (typeof window !== 'undefined') {
	const debouncedSetup = debounce(setupGallery, 250);

	document.addEventListener('DOMContentLoaded', setupGallery);
	window.addEventListener('resize', debouncedSetup);
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
