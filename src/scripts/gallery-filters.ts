import { setupGallery } from './photo-grid';

const galleryBrowserSelector = '[data-gallery-browser]';
let activeRequest: AbortController | null = null;

document.addEventListener('click', (event) => {
	if (!(event.target instanceof Element)) return;
	const link = event.target.closest<HTMLAnchorElement>('a[data-gallery-filter]');
	if (!link || event.defaultPrevented || event.button !== 0) return;
	if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
	if (link.origin !== window.location.origin) return;

	event.preventDefault();
	void loadGallery(link.href, true);
});

window.addEventListener('popstate', () => {
	void loadGallery(window.location.href, false);
});

async function loadGallery(url: string, addHistoryEntry: boolean) {
	const currentBrowser = document.querySelector<HTMLElement>(galleryBrowserSelector);
	if (!currentBrowser) return;

	activeRequest?.abort();
	const request = new AbortController();
	activeRequest = request;
	currentBrowser.setAttribute('aria-busy', 'true');

	try {
		const response = await fetch(url, {
			signal: request.signal,
			headers: { 'X-Requested-With': 'gallery-filter' },
		});
		if (!response.ok) throw new Error(`Gallery request failed with ${response.status}`);

		const nextDocument = new DOMParser().parseFromString(await response.text(), 'text/html');
		const nextBrowser = nextDocument.querySelector<HTMLElement>(galleryBrowserSelector);
		if (!nextBrowser) throw new Error('Gallery response did not contain the filter region.');

		const focusedFilterHref =
			document.activeElement instanceof HTMLAnchorElement &&
			document.activeElement.matches('[data-gallery-filter]')
				? document.activeElement.href
				: null;
		currentBrowser.style.minHeight = `${currentBrowser.offsetHeight}px`;
		currentBrowser.replaceChildren(
			...Array.from(nextBrowser.childNodes, (node) => document.importNode(node, true)),
		);
		currentBrowser.removeAttribute('aria-busy');
		setupGallery();
		document.title = nextDocument.title;
		if (addHistoryEntry) history.pushState({}, '', url);
		if (focusedFilterHref) {
			const matchingFilter = Array.from(
				currentBrowser.querySelectorAll<HTMLAnchorElement>('a[data-gallery-filter]'),
			).find((link) => link.href === focusedFilterHref);
			matchingFilter?.focus({ preventScroll: true });
		}
		requestAnimationFrame(() => {
			currentBrowser.style.minHeight = '';
		});
	} catch (error) {
		if (request.signal.aborted) return;
		currentBrowser.removeAttribute('aria-busy');
		console.error(error);
	} finally {
		if (activeRequest === request) activeRequest = null;
	}
}
