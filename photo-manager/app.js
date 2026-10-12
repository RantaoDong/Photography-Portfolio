/* global document, window, fetch, Option, structuredClone */

const token = document.querySelector('meta[name="photo-manager-token"]').content;

let libraryState = null;
let selectedIds = new Set();
let searchTerm = '';
let browseFilter = 'all';
let visibilityFilter = 'public';
let importDraft = null;
let featuredOrderDraft = [];
let draggedFeaturedId = null;

const mixedValue = '__mixed__';

const elements = {
	grid: document.querySelector('#photo-grid'),
	editor: document.querySelector('#editor-panel'),
	count: document.querySelector('#library-count'),
	selectionCount: document.querySelector('#selection-count'),
	deleteButton: document.querySelector('#delete-button'),
	notice: document.querySelector('#notice'),
	statusDialog: document.querySelector('#status-dialog'),
	statusContent: document.querySelector('#status-content'),
	deleteDialog: document.querySelector('#delete-dialog'),
	deletePreview: document.querySelector('#delete-preview'),
	deleteConfirmation: document.querySelector('#delete-confirmation'),
	confirmDelete: document.querySelector('#confirm-delete-button'),
	importDialog: document.querySelector('#import-dialog'),
	importContent: document.querySelector('#import-content'),
	featuredOrderDialog: document.querySelector('#featured-order-dialog'),
	featuredOrderList: document.querySelector('#featured-order-list'),
	saveFeaturedOrder: document.querySelector('#save-featured-order-button'),
	browseFilter: document.querySelector('#browse-filter'),
	visibilityFilter: document.querySelector('#visibility-filter'),
};

document
	.querySelector('#refresh-button')
	.addEventListener('click', () => loadState('Library refreshed.'));
document.querySelector('#status-button').addEventListener('click', openStatus);
document.querySelector('#featured-order-button').addEventListener('click', openFeaturedOrder);
document.querySelector('#import-button').addEventListener('click', openImport);
document.querySelector('#select-all-button').addEventListener('click', selectVisible);
document.querySelector('#clear-selection-button').addEventListener('click', () => {
	selectedIds.clear();
	render();
});
document.querySelector('#delete-button').addEventListener('click', openDelete);
document.querySelector('#search-input').addEventListener('input', (event) => {
	searchTerm = event.target.value.trim().toLowerCase();
	renderLibrary();
});
elements.browseFilter.addEventListener('change', (event) => {
	browseFilter = event.target.value;
	renderLibrary();
});
elements.visibilityFilter.addEventListener('change', (event) => {
	visibilityFilter = event.target.value;
	renderLibrary();
});
elements.deleteConfirmation.addEventListener('change', () => {
	elements.confirmDelete.disabled = !elements.deleteConfirmation.checked;
});
elements.confirmDelete.addEventListener('click', confirmDelete);
elements.saveFeaturedOrder.addEventListener('click', saveFeaturedOrder);
document.querySelectorAll('[data-close-dialog]').forEach((button) => {
	button.addEventListener('click', () =>
		document.querySelector(`#${button.dataset.closeDialog}`).close(),
	);
});

loadState();

async function loadState(successMessage) {
	try {
		const response = await fetch('/api/state', { cache: 'no-store' });
		if (!response.ok) throw new Error('Could not load the photo library.');
		libraryState = await response.json();
		selectedIds = new Set(
			[...selectedIds].filter((id) => libraryState.photos.some((p) => p.id === id)),
		);
		render();
		if (successMessage) showNotice(successMessage);
	} catch (error) {
		showNotice(error.message, true);
	}
}

function render() {
	renderFilterOptions();
	renderLibrary();
	renderEditor();
	updateSelectionControls();
}

function filteredPhotos() {
	if (!libraryState) return [];
	return libraryState.photos.filter((photo) => {
		if (visibilityFilter === 'public' && photo.published === false) return false;
		if (visibilityFilter === 'hidden' && photo.published !== false) return false;
		if (!matchesBrowseFilter(photo)) return false;
		if (!searchTerm) return true;
		return [
			photo.id,
			photo.file,
			...(photo.taxonomy?.year || []),
			...(photo.taxonomy?.place || []),
			...(photo.taxonomy?.subject || []),
		]
			.filter(Boolean)
			.join(' ')
			.toLowerCase()
			.includes(searchTerm);
	});
}

function matchesBrowseFilter(photo) {
	if (browseFilter === 'all') return photo.browse?.all !== false;
	if (browseFilter === 'library') return true;
	if (browseFilter === 'featured:true') return photo.featured === true;
	if (browseFilter === 'featured:false') return photo.featured !== true;
	const separator = browseFilter.indexOf(':');
	if (separator === -1) return true;
	const dimension = browseFilter.slice(0, separator);
	const value = decodeURIComponent(browseFilter.slice(separator + 1));
	if (dimension === 'missing') {
		return !photo.taxonomy?.[value]?.length;
	}
	return photo.browse?.[dimension] === true && photo.taxonomy?.[dimension]?.includes(value);
}

function renderFilterOptions() {
	if (!libraryState) return;
	const previous = browseFilter;
	elements.browseFilter.innerHTML = [
		'<option value="all">Gallery — All</option>',
		'<option value="library">Library — all records</option>',
		filterGroup('Year', 'year', libraryState.options.years),
		filterGroup('Place', 'place', libraryState.options.places),
		filterGroup('Subject', 'subject', libraryState.options.subjects),
		`<optgroup label="Featured status">
			<option value="featured:true">Featured</option>
			<option value="featured:false">Not featured</option>
		</optgroup>`,
		`<optgroup label="Missing metadata">
			<option value="missing:year">No year</option>
			<option value="missing:place">No place</option>
			<option value="missing:subject">No subject</option>
		</optgroup>`,
	].join('');
	const available = [...elements.browseFilter.options].some((option) => option.value === previous);
	browseFilter = available ? previous : 'all';
	elements.browseFilter.value = browseFilter;
	elements.visibilityFilter.value = visibilityFilter;
}

function filterGroup(label, dimension, values) {
	if (!values.length) return '';
	return `<optgroup label="${escapeHtml(label)}">${values
		.map(
			(value) =>
				`<option value="${dimension}:${encodeURIComponent(value)}">${escapeHtml(label)} — ${escapeHtml(value)}</option>`,
		)
		.join('')}</optgroup>`;
}

function renderLibrary() {
	if (!libraryState) {
		elements.grid.innerHTML = '<div class="empty-grid">Loading library…</div>';
		return;
	}
	const photos = filteredPhotos();
	elements.count.textContent = `${photos.length} of ${libraryState.photos.length} photographs`;
	if (photos.length === 0) {
		elements.grid.innerHTML =
			'<div class="empty-grid">No photographs match the current filters.</div>';
		return;
	}
	elements.grid.innerHTML = photos
		.map(
			(photo) => `
			<article class="photo-card ${selectedIds.has(photo.id) ? 'selected' : ''}" data-photo-id="${escapeHtml(photo.id)}">
				${photo.featured ? '<span class="featured-badge">Featured</span>' : ''}
				<img src="${photo.imageUrl}" alt="" loading="lazy" />
				<div class="photo-card-content">
					<div class="photo-card-title">
						<input class="photo-select" type="checkbox" aria-label="Select ${escapeHtml(photo.id)}" ${selectedIds.has(photo.id) ? 'checked' : ''} />
						<span>${escapeHtml(photo.id)}</span>
						${photo.published === false ? '<span class="override-badge">Hidden</span>' : ''}
					</div>
					<p class="photo-card-summary">${escapeHtml(metadataSummary(photo))}</p>
				</div>
			</article>`,
		)
		.join('');

	elements.grid.querySelectorAll('.photo-card').forEach((card) => {
		const id = card.dataset.photoId;
		card.addEventListener('click', (event) => {
			if (event.target.matches('input')) return;
			selectedIds = new Set([id]);
			render();
		});
		card.querySelector('input').addEventListener('change', (event) => {
			if (event.target.checked) selectedIds.add(id);
			else selectedIds.delete(id);
			render();
		});
	});
}

function openFeaturedOrder() {
	featuredOrderDraft = libraryState.photos
		.map((photo, index) => ({ photo, index }))
		.filter(({ photo }) => photo.featured)
		.sort((a, b) => {
			const orderA = validFeaturedOrder(a.photo.featured_order);
			const orderB = validFeaturedOrder(b.photo.featured_order);
			if (orderA === null && orderB !== null) return 1;
			if (orderA !== null && orderB === null) return -1;
			if (orderA !== orderB) return (orderA ?? 0) - (orderB ?? 0);
			return a.index - b.index;
		})
		.map(({ photo }) => photo.id);
	renderFeaturedOrder();
	elements.featuredOrderDialog.showModal();
}

function renderFeaturedOrder() {
	if (featuredOrderDraft.length === 0) {
		elements.featuredOrderList.innerHTML =
			'<div class="empty-grid">No photographs are currently Featured.</div>';
		elements.saveFeaturedOrder.disabled = true;
		return;
	}
	elements.saveFeaturedOrder.disabled = false;
	const photosById = new Map(libraryState.photos.map((photo) => [photo.id, photo]));
	elements.featuredOrderList.innerHTML = featuredOrderDraft
		.map((id, index) => {
			const photo = photosById.get(id);
			return `<article class="featured-order-item" draggable="true" data-featured-id="${escapeHtml(id)}">
				<span class="drag-handle" aria-hidden="true">⋮⋮</span>
				<span class="featured-position">${index + 1}</span>
				<img src="${photo.imageUrl}" alt="" loading="lazy" />
				<div class="featured-order-details"><strong>${escapeHtml(id)}</strong><span>${escapeHtml(metadataSummary(photo))}${photo.published === false ? ' · Hidden' : ''}</span></div>
				<div class="featured-order-actions">
					<button class="button secondary small" type="button" data-move-featured="up" aria-label="Move ${escapeHtml(id)} up" ${index === 0 ? 'disabled' : ''}>↑</button>
					<button class="button secondary small" type="button" data-move-featured="down" aria-label="Move ${escapeHtml(id)} down" ${index === featuredOrderDraft.length - 1 ? 'disabled' : ''}>↓</button>
				</div>
			</article>`;
		})
		.join('');

	elements.featuredOrderList.querySelectorAll('.featured-order-item').forEach((item) => {
		item.addEventListener('dragstart', (event) => {
			draggedFeaturedId = item.dataset.featuredId;
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', draggedFeaturedId);
			item.classList.add('dragging');
		});
		item.addEventListener('dragend', () => {
			draggedFeaturedId = null;
			item.classList.remove('dragging');
		});
		item.addEventListener('dragover', (event) => {
			event.preventDefault();
			event.dataTransfer.dropEffect = 'move';
		});
		item.addEventListener('drop', (event) => {
			event.preventDefault();
			moveFeaturedBefore(
				draggedFeaturedId || event.dataTransfer.getData('text/plain'),
				item.dataset.featuredId,
			);
		});
		item.querySelectorAll('[data-move-featured]').forEach((button) => {
			button.addEventListener('click', () =>
				moveFeaturedBy(item.dataset.featuredId, button.dataset.moveFeatured),
			);
		});
	});
}

function moveFeaturedBefore(movedId, targetId) {
	if (!movedId || movedId === targetId) return;
	const from = featuredOrderDraft.indexOf(movedId);
	let to = featuredOrderDraft.indexOf(targetId);
	if (from < 0 || to < 0) return;
	featuredOrderDraft.splice(from, 1);
	if (from < to) to -= 1;
	featuredOrderDraft.splice(to, 0, movedId);
	renderFeaturedOrder();
}

function moveFeaturedBy(id, direction) {
	const from = featuredOrderDraft.indexOf(id);
	const to = direction === 'up' ? from - 1 : from + 1;
	if (from < 0 || to < 0 || to >= featuredOrderDraft.length) return;
	[featuredOrderDraft[from], featuredOrderDraft[to]] = [
		featuredOrderDraft[to],
		featuredOrderDraft[from],
	];
	renderFeaturedOrder();
}

async function saveFeaturedOrder() {
	elements.featuredOrderDialog.close();
	await mutate('/api/featured-order', { ids: featuredOrderDraft }, 'Featured Works order saved.');
}

function validFeaturedOrder(value) {
	return Number.isInteger(value) && value > 0 ? value : null;
}

function renderEditor() {
	if (!libraryState || selectedIds.size === 0) {
		elements.editor.innerHTML = `
			<div class="empty-state">
				<h2>Metadata</h2>
				<p>Select one or more photographs to edit their metadata.</p>
			</div>`;
		return;
	}
	const photos = libraryState.photos.filter((photo) => selectedIds.has(photo.id));
	if (photos.length === 1) renderSingleEditor(photos[0]);
	else renderBatchEditor(photos);
}

function renderSingleEditor(photo) {
	elements.editor.innerHTML = `
		<div>
			<p class="eyebrow">Individual edit</p>
			<h2>${escapeHtml(photo.id)}</h2>
			<p class="muted">${escapeHtml(photo.file)}</p>
			<img class="editor-preview" src="${photo.previewUrl}" alt="" />
			<form id="single-editor-form">
				${selectField('single-year', 'Year', libraryState.options.years, photo.taxonomy.year[0] || '', 'year')}
				${selectField('single-place', 'Place', libraryState.options.places, photo.taxonomy.place[0] || '', 'place')}
				${subjectField('single-subjects', photo.taxonomy.subject, 'single')}
				${booleanChecks('single', photo.browse, photo.featured, photo.published !== false)}
				<button class="button primary" type="submit">Save metadata</button>
			</form>
		</div>`;
	wireNewValueButtons(elements.editor);
	document.querySelector('#single-editor-form').addEventListener('submit', async (event) => {
		event.preventDefault();
		const update = {
			year: valueOf('#single-year'),
			place: valueOf('#single-place'),
			subjects: {
				operation: 'replace',
				values: checkedValues('#single-subjects'),
			},
			browse: {
				all: checked('#single-browse-all'),
				year: checked('#single-browse-year'),
				place: checked('#single-browse-place'),
				subject: checked('#single-browse-subject'),
			},
			featured: checked('#single-featured'),
			published: checked('#single-published'),
		};
		await mutate('/api/update', { ids: [photo.id], update }, 'Metadata saved.');
	});
}

function renderBatchEditor(photos) {
	const year = commonValue(photos.map((photo) => photo.taxonomy.year[0] || ''));
	const place = commonValue(photos.map((photo) => photo.taxonomy.place[0] || ''));
	const subjectState = commonValue(
		photos.map((photo) => [...photo.taxonomy.subject].sort().join('\u0000')),
	);
	const commonSubjects =
		subjectState === undefined || subjectState === '' ? [] : subjectState.split('\u0000');
	const browseAll = commonValue(photos.map((photo) => photo.browse.all !== false));
	const browseYear = commonValue(photos.map((photo) => photo.browse.year));
	const browsePlace = commonValue(photos.map((photo) => photo.browse.place));
	const browseSubject = commonValue(photos.map((photo) => photo.browse.subject));
	const featured = commonValue(photos.map((photo) => photo.featured));
	const published = commonValue(photos.map((photo) => photo.published !== false));

	elements.editor.innerHTML = `
		<div>
			<p class="eyebrow">Batch edit</p>
			<h2>${photos.length} photographs selected</h2>
			<p class="field-note">Edit the values and save. Fields marked mixed keep each photograph's current value until you choose a replacement.</p>
			<form id="batch-editor-form">
				${batchSelect('batch-year', 'Year', libraryState.options.years, year, 'year')}
				${batchSelect('batch-place', 'Place', libraryState.options.places, place, 'place')}
				<div class="field">
					<label for="batch-subject-operation">Subjects${subjectState === undefined ? ' — mixed' : ''}</label>
					<select id="batch-subject-operation">
						<option value="add" ${subjectState === undefined ? 'selected' : ''}>Add selected subjects</option>
						<option value="remove">Remove selected subjects</option>
						<option value="replace" ${subjectState !== undefined ? 'selected' : ''}>Replace subject list</option>
					</select>
					<div class="field-group">${subjectField('batch-subjects', commonSubjects, 'batch')}</div>
				</div>
				${batchBoolean('batch-browse-all', 'Show in All', browseAll)}
				${batchBoolean('batch-browse-year', 'Show in Year', browseYear)}
				${batchBoolean('batch-browse-place', 'Show in Place', browsePlace)}
				${batchBoolean('batch-browse-subject', 'Show in Subject', browseSubject)}
				${batchBoolean('batch-featured', 'Featured', featured)}
				${batchBoolean('batch-published', 'Visible on public site', published)}
				<button class="button primary" type="submit">Save metadata</button>
			</form>
		</div>`;
	wireNewValueButtons(elements.editor);
	document.querySelector('#batch-editor-form').addEventListener('submit', async (event) => {
		event.preventDefault();
		const update = {
			subjects: {
				operation: valueOf('#batch-subject-operation'),
				values: checkedValues('#batch-subjects'),
			},
		};
		for (const field of ['year', 'place']) {
			const value = valueOf(`#batch-${field}`);
			if (value !== mixedValue) update[field] = value;
		}
		for (const [id, dimension] of [
			['batch-browse-all', 'all'],
			['batch-browse-year', 'year'],
			['batch-browse-place', 'place'],
			['batch-browse-subject', 'subject'],
		]) {
			const value = valueOf(`#${id}`);
			if (value !== mixedValue) {
				update.browse ||= {};
				update.browse[dimension] = value === 'true';
			}
		}
		for (const field of ['featured', 'published']) {
			const value = valueOf(`#batch-${field}`);
			if (value !== mixedValue) update[field] = value === 'true';
		}
		await mutate('/api/update', { ids: [...selectedIds], update }, 'Batch metadata saved.');
	});
}

function selectField(id, label, values, current, kind) {
	return `<div class="field">
		<label for="${id}">${label}</label>
		<div class="field-row">
			<select id="${id}">${optionsHtml(values, current, `No ${label.toLowerCase()}`)}</select>
			<button type="button" class="button secondary small" data-new-kind="${kind}" data-new-target="${id}">+ New</button>
		</div>
	</div>`;
}

function batchSelect(id, label, values, common, kind) {
	const mixedOption =
		common === undefined
			? `<option value="${mixedValue}" selected>Mixed — keep individual values</option>`
			: '';
	return `<div class="field">
		<label for="${id}">${label}${common === undefined ? ' — mixed' : ''}</label>
		<div class="field-row">
			<select id="${id}">${mixedOption}${optionsHtml(values, common ?? '', `No ${label.toLowerCase()}`)}</select>
			<button type="button" class="button secondary small" data-new-kind="${kind}" data-new-target="${id}">+ New</button>
		</div>
	</div>`;
}

function batchBoolean(id, label, common) {
	return `<div class="field">
		<label for="${id}">${label}${common === undefined ? ' — mixed' : ''}</label>
		<select id="${id}">
			${common === undefined ? `<option value="${mixedValue}" selected>Mixed — keep individual values</option>` : ''}
			<option value="true" ${common === true ? 'selected' : ''}>Yes</option>
			<option value="false" ${common === false ? 'selected' : ''}>No</option>
		</select>
	</div>`;
}

function subjectField(id, selected, context) {
	const choices = libraryState.options.subjects
		.map(
			(subject) =>
				`<label class="subject-chip"><input type="checkbox" value="${escapeHtml(subject)}" ${selected.includes(subject) ? 'checked' : ''} />${escapeHtml(subject)}</label>`,
		)
		.join('');
	return `<div class="field" id="${id}">
		<span class="field-label">Subjects</span>
		<div class="subject-options">${choices || '<span class="field-note">No subjects yet.</span>'}</div>
		<button type="button" class="button secondary small" data-new-subject="${context}" data-subject-target="${id}">+ New subject</button>
	</div>`;
}

function booleanChecks(prefix, browse, featured, published) {
	return `<div class="field-group">
		<label class="check-row"><input id="${prefix}-browse-all" type="checkbox" ${browse.all !== false ? 'checked' : ''} /> Show in All</label>
		<label class="check-row"><input id="${prefix}-browse-year" type="checkbox" ${browse.year ? 'checked' : ''} /> Show in Year</label>
		<label class="check-row"><input id="${prefix}-browse-place" type="checkbox" ${browse.place ? 'checked' : ''} /> Show in Place</label>
		<label class="check-row"><input id="${prefix}-browse-subject" type="checkbox" ${browse.subject ? 'checked' : ''} /> Show in Subject</label>
		<label class="check-row"><input id="${prefix}-featured" type="checkbox" ${featured ? 'checked' : ''} /> Featured</label>
		<label class="check-row"><input id="${prefix}-published" type="checkbox" ${published ? 'checked' : ''} /> Visible on public site</label>
	</div>`;
}

function wireNewValueButtons(container) {
	container.querySelectorAll('[data-new-kind]').forEach((button) => {
		button.addEventListener('click', () => {
			const value = requestNewValue(button.dataset.newKind);
			if (!value) return;
			const select = document.querySelector(`#${button.dataset.newTarget}`);
			if (![...select.options].some((option) => option.value === value))
				select.add(new Option(value, value));
			select.value = value;
		});
	});
	container.querySelectorAll('[data-new-subject]').forEach((button) => {
		button.addEventListener('click', () => {
			const value = requestNewValue('subject');
			if (!value) return;
			const options = document.querySelector(`#${button.dataset.subjectTarget} .subject-options`);
			options.querySelector('.field-note')?.remove();
			if (![...options.querySelectorAll('input')].some((input) => input.value === value)) {
				const label = document.createElement('label');
				label.className = 'subject-chip';
				label.innerHTML = `<input type="checkbox" value="${escapeHtml(value)}" checked />${escapeHtml(value)}`;
				options.append(label);
			}
		});
	});
}

function requestNewValue(kind) {
	const labels = { year: 'year', place: 'place', subject: 'subject' };
	const value = window.prompt(`New ${labels[kind]}:`)?.trim();
	if (!value) return null;
	if (kind === 'year' && !/^[1-9]\d{3}$/.test(value)) {
		showNotice('Year must contain four digits.', true);
		return null;
	}
	const key = kind === 'year' ? 'years' : kind === 'place' ? 'places' : 'subjects';
	if (!libraryState.options[key].includes(value)) libraryState.options[key].push(value);
	return value;
}

function selectVisible() {
	for (const photo of filteredPhotos()) selectedIds.add(photo.id);
	render();
}

function updateSelectionControls() {
	elements.selectionCount.textContent = `${selectedIds.size} selected`;
	elements.deleteButton.disabled = selectedIds.size === 0;
}

function openStatus() {
	const report = libraryState.consistency;
	elements.statusContent.innerHTML = [
		statusGroup(
			'Metadata entries with missing files',
			report.missingFiles,
			(item) => `${item.id} — ${item.file}`,
		),
		statusGroup('Image files without metadata', report.orphanFiles, (item) => item),
		statusGroup('Duplicate photo IDs', report.duplicateIds, (item) => item),
		statusGroup('Duplicate metadata filenames', report.duplicateFiles, (item) => item),
	].join('');
	if (report.missingFiles.length > 0) {
		elements.statusContent.insertAdjacentHTML(
			'beforeend',
			`<div class="dialog-actions"><button id="remove-missing-button" class="button danger">Review removal of missing-file metadata</button></div>`,
		);
		document
			.querySelector('#remove-missing-button')
			.addEventListener('click', removeMissingMetadata);
	}
	elements.statusDialog.showModal();
}

function statusGroup(title, items, format) {
	return `<section class="status-group"><h3>${title} (${items.length})</h3>${
		items.length
			? items.map((item) => `<div class="status-item">${escapeHtml(format(item))}</div>`).join('')
			: '<p class="muted">None</p>'
	}</section>`;
}

async function removeMissingMetadata() {
	const items = libraryState.consistency.missingFiles;
	const preview = items.map((item) => `${item.id}: ${item.file}`).join('\n');
	if (
		!window.confirm(
			`Remove only these metadata entries?\n\n${preview}\n\nNo image files will be deleted.`,
		)
	)
		return;
	elements.statusDialog.close();
	await mutate(
		'/api/remove-missing-metadata',
		{ ids: items.map((item) => item.id), confirm: true },
		'Removed missing-file metadata entries.',
	);
}

function openDelete() {
	const photos = libraryState.photos.filter((photo) => selectedIds.has(photo.id));
	elements.deletePreview.innerHTML = photos
		.map(
			(photo) =>
				`<div class="preview-item"><strong>${escapeHtml(photo.id)}</strong><br />Image: ${escapeHtml(photo.file)}<br />Metadata: ${escapeHtml(metadataSummary(photo))}</div>`,
		)
		.join('');
	elements.deleteConfirmation.checked = false;
	elements.confirmDelete.disabled = true;
	elements.deleteDialog.showModal();
}

async function confirmDelete() {
	const ids = [...selectedIds];
	elements.deleteDialog.close();
	try {
		libraryState = await api('/api/delete', {
			revision: libraryState.revision,
			ids,
			confirm: true,
		});
		selectedIds.clear();
		render();
		showNotice(`Deleted ${ids.length} photograph(s).`);
	} catch (error) {
		showNotice(error.message, true);
		if (error.status === 409) await loadState();
	}
}

function openImport() {
	if (!libraryState.incoming.length) {
		showNotice('No JPG or JPEG files are currently in incoming/.', true);
		return;
	}
	importDraft = {
		selected: new Set(libraryState.incoming.map((item) => item.name)),
		defaults: emptyMetadata(),
		overrides: new Map(),
		previewed: false,
	};
	renderImport();
	elements.importDialog.showModal();
}

function emptyMetadata() {
	return {
		year: '',
		place: '',
		subjects: [],
		browse: { all: true, year: true, place: true, subject: true },
		featured: false,
		published: true,
	};
}

function renderImport() {
	const defaults = importDraft.defaults;
	elements.importContent.innerHTML = `
		<div class="import-layout">
			<section class="import-settings">
				<h3>Batch defaults</h3>
				${importMetadataFields('import-default', defaults)}
				<div class="inline-actions">
					<button id="clear-overrides-button" class="button secondary small" type="button">Apply defaults to all</button>
				</div>
			</section>
			<section>
				<div class="section-heading"><h3>Incoming photographs</h3><span class="muted">${importDraft.selected.size} selected</span></div>
				<div class="incoming-grid">${libraryState.incoming.map(importCard).join('')}</div>
			</section>
		</div>
		<div id="import-override-panel"></div>
		<div id="import-preview" class="import-preview" hidden></div>
		<div class="dialog-actions">
			<button class="button secondary" type="button" data-close-import>Cancel</button>
			<button id="preview-import-button" class="button primary" type="button">Preview import</button>
		</div>`;
	wireNewValueButtons(elements.importContent);
	document
		.querySelector('[data-close-import]')
		.addEventListener('click', () => elements.importDialog.close());
	document.querySelector('#clear-overrides-button').addEventListener('click', () => {
		syncImportDefaults();
		importDraft.overrides.clear();
		importDraft.previewed = false;
		renderImport();
	});
	document.querySelector('#preview-import-button').addEventListener('click', previewImport);
	elements.importContent.querySelectorAll('[data-incoming-select]').forEach((input) => {
		input.addEventListener('change', () => {
			syncImportDefaults();
			if (input.checked) importDraft.selected.add(input.dataset.incomingSelect);
			else importDraft.selected.delete(input.dataset.incomingSelect);
			importDraft.previewed = false;
			renderImport();
		});
	});
	elements.importContent.querySelectorAll('[data-customize-incoming]').forEach((button) => {
		button.addEventListener('click', () => openImportOverride(button.dataset.customizeIncoming));
	});
}

function importCard(item) {
	const overridden = importDraft.overrides.has(item.name);
	return `<article class="photo-card ${importDraft.selected.has(item.name) ? 'selected' : ''}">
		<img src="${item.imageUrl}" alt="" loading="lazy" />
		<div class="photo-card-content">
			<div class="photo-card-title"><input class="photo-select" type="checkbox" data-incoming-select="${escapeHtml(item.name)}" ${importDraft.selected.has(item.name) ? 'checked' : ''} /><span>${escapeHtml(item.name)}</span></div>
			<div class="incoming-card-actions"><span class="override-badge">${overridden ? 'Customized' : 'Uses defaults'}</span><button class="button secondary small" type="button" data-customize-incoming="${escapeHtml(item.name)}">Customize</button></div>
		</div>
	</article>`;
}

function importMetadataFields(prefix, metadata) {
	return `
		${selectField(`${prefix}-year`, 'Year', libraryState.options.years, metadata.year, 'year')}
		${selectField(`${prefix}-place`, 'Place', libraryState.options.places, metadata.place, 'place')}
		${subjectField(`${prefix}-subjects`, metadata.subjects, prefix)}
		${booleanChecks(prefix, metadata.browse, metadata.featured, metadata.published)}`;
}

function syncImportDefaults() {
	importDraft.defaults = readImportMetadata('import-default');
}

function openImportOverride(name) {
	syncImportDefaults();
	const current = structuredClone(importDraft.overrides.get(name) || importDraft.defaults);
	const panel = document.querySelector('#import-override-panel');
	panel.innerHTML = `<hr class="divider" /><p class="eyebrow">Per-photo override</p><h3>${escapeHtml(name)}</h3>${importMetadataFields('import-override', current)}<div class="inline-actions"><button id="save-import-override" type="button" class="button primary">Save override</button><button id="remove-import-override" type="button" class="button secondary">Use defaults</button></div>`;
	wireNewValueButtons(panel);
	document.querySelector('#save-import-override').addEventListener('click', () => {
		const metadata = readImportMetadata('import-override');
		validateMetadata(metadata);
		importDraft.overrides.set(name, metadata);
		importDraft.previewed = false;
		renderImport();
	});
	document.querySelector('#remove-import-override').addEventListener('click', () => {
		importDraft.overrides.delete(name);
		importDraft.previewed = false;
		renderImport();
	});
	panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function readImportMetadata(prefix) {
	return {
		year: valueOf(`#${prefix}-year`),
		place: valueOf(`#${prefix}-place`),
		subjects: checkedValues(`#${prefix}-subjects`),
		browse: {
			all: checked(`#${prefix}-browse-all`),
			year: checked(`#${prefix}-browse-year`),
			place: checked(`#${prefix}-browse-place`),
			subject: checked(`#${prefix}-browse-subject`),
		},
		featured: checked(`#${prefix}-featured`),
		published: checked(`#${prefix}-published`),
	};
}

function previewImport() {
	try {
		syncImportDefaults();
		const items = buildImportItems();
		if (items.length === 0) throw new Error('Select at least one incoming photograph.');
		const preview = document.querySelector('#import-preview');
		preview.hidden = false;
		preview.innerHTML = `<p class="eyebrow">Final preview</p><h3>${items.length} photographs will be imported</h3><div class="preview-list">${items
			.map(
				(item) =>
					`<div class="preview-item"><strong>${escapeHtml(item.name)}</strong><br />${escapeHtml(importSummary(item.metadata))}</div>`,
			)
			.join(
				'',
			)}</div><div class="dialog-actions"><button id="confirm-import-button" class="button primary" type="button">Confirm import</button></div>`;
		importDraft.previewed = true;
		document.querySelector('#confirm-import-button').addEventListener('click', confirmImport);
		preview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
	} catch (error) {
		showNotice(error.message, true);
	}
}

function buildImportItems() {
	return libraryState.incoming
		.filter((item) => importDraft.selected.has(item.name))
		.map((item) => {
			const metadata = structuredClone(
				importDraft.overrides.get(item.name) || importDraft.defaults,
			);
			validateMetadata(metadata);
			return { name: item.name, metadata };
		});
}

async function confirmImport() {
	try {
		const items = buildImportItems();
		const response = await api('/api/import', { revision: libraryState.revision, items });
		libraryState = response;
		importDraft = null;
		elements.importDialog.close();
		selectedIds.clear();
		render();
		showNotice(`Imported ${items.length} photograph(s).`);
	} catch (error) {
		showNotice(error.message, true);
	}
}

function validateMetadata(metadata) {
	if (metadata.year && !/^[1-9]\d{3}$/.test(metadata.year))
		throw new Error('Year must contain four digits.');
	for (const dimension of ['year', 'place', 'subject']) {
		const hasValue =
			dimension === 'subject' ? metadata.subjects.length > 0 : Boolean(metadata[dimension]);
		if (metadata.browse[dimension] && !hasValue)
			throw new Error(`Show in ${capitalize(dimension)} requires a ${dimension} value.`);
	}
}

async function mutate(route, payload, successMessage) {
	try {
		libraryState = await api(route, { revision: libraryState.revision, ...payload });
		render();
		showNotice(successMessage);
	} catch (error) {
		showNotice(error.message, true);
		if (error.status === 409) await loadState();
	}
}

async function api(route, body) {
	const response = await fetch(route, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'X-Photo-Manager-Token': token },
		body: JSON.stringify(body),
	});
	const result = await response.json();
	if (!response.ok) {
		const error = new Error(result.error || 'The manager request failed.');
		error.status = response.status;
		throw error;
	}
	return result;
}

function optionsHtml(values, current, emptyLabel) {
	const unique = [...new Set([current, ...values].filter(Boolean))];
	return `<option value="">${escapeHtml(emptyLabel)}</option>${unique
		.map(
			(value) =>
				`<option value="${escapeHtml(value)}" ${value === current ? 'selected' : ''}>${escapeHtml(value)}</option>`,
		)
		.join('')}`;
}

function metadataSummary(photo) {
	return [
		photo.taxonomy.year.join(', ') || 'No year',
		photo.taxonomy.place.join(', ') || 'No place',
		photo.taxonomy.subject.join(', ') || 'No subject',
	]
		.filter(Boolean)
		.join(' · ');
}

function importSummary(metadata) {
	const visible = Object.entries(metadata.browse)
		.filter(([, value]) => value)
		.map(([key]) => capitalize(key))
		.join(', ');
	return [
		[
			metadata.year || 'No year',
			metadata.place || 'No place',
			metadata.subjects.join(', ') || 'No subject',
		].join(' | '),
		`Visible in: ${visible || 'Nowhere'}`,
		metadata.featured ? 'Featured' : '',
		metadata.published ? 'Public' : 'Hidden from public site',
	]
		.filter(Boolean)
		.join(' · ');
}

function commonValue(values) {
	return values.every((value) => value === values[0]) ? values[0] : undefined;
}

function checked(selector) {
	return document.querySelector(selector).checked;
}

function valueOf(selector) {
	return document.querySelector(selector).value;
}

function checkedValues(selector) {
	return [...document.querySelectorAll(`${selector} input[type="checkbox"]:checked`)].map(
		(input) => input.value,
	);
}

function showNotice(message, error = false) {
	elements.notice.textContent = message;
	elements.notice.classList.toggle('error', error);
	elements.notice.hidden = false;
	window.clearTimeout(showNotice.timeout);
	showNotice.timeout = window.setTimeout(() => (elements.notice.hidden = true), 5000);
}

function escapeHtml(value) {
	return String(value ?? '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#039;');
}

function capitalize(value) {
	return value.charAt(0).toUpperCase() + value.slice(1);
}
