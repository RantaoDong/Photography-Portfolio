export interface RowImageInput {
	width: number;
	height: number;
	group?: string;
}

export interface RowLayoutBox {
	aspectRatio: number;
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface RowLayout {
	boxes: RowLayoutBox[];
	containerHeight: number;
}

export interface RowLayoutOptions {
	reorderWithinGroup?: boolean;
}

type Orientation = 'landscape' | 'portrait';

interface IndexedImage {
	image: RowImageInput;
	index: number;
	aspectRatio: number;
	orientation: Orientation;
}

const GAP = 10;
const MAX_AREA_SCALE = 1.25;

/**
 * Builds deterministic, orientation-aware rows. Gallery groups may be locally
 * reordered to alternate orientation and balance row fill, but never cross a
 * group boundary. Passing reorderWithinGroup: false preserves strict order.
 */
export function createOrientationRowLayout(
	images: RowImageInput[],
	containerWidth: number,
	options: RowLayoutOptions = {},
): RowLayout {
	if (images.length === 0 || containerWidth <= 0) {
		return { boxes: [], containerHeight: 0 };
	}

	const boxes: RowLayoutBox[] = new Array(images.length);
	let top = 0;

	for (const group of splitIntoConsecutiveGroups(images)) {
		const items = group.items.map(({ image, index }) => {
			const aspectRatio = validAspectRatio(image.width, image.height);
			return {
				image,
				index,
				aspectRatio,
				orientation: aspectRatio >= 1 ? 'landscape' : 'portrait',
			} satisfies IndexedImage;
		});
		const rows = options.reorderWithinGroup
			? createBalancedAlternatingRows(items, containerWidth)
			: createStableRows(items, containerWidth);

		for (const row of rows) {
			const rowHeight = calculateRowHeight(row, containerWidth);
			const contentWidth =
				row.reduce((sum, item) => sum + rowHeight * item.aspectRatio, 0) +
				GAP * Math.max(0, row.length - 1);
			let left = Math.max(0, (containerWidth - contentWidth) / 2);

			for (const item of row) {
				const width = rowHeight * item.aspectRatio;
				boxes[item.index] = {
					aspectRatio: item.aspectRatio,
					left,
					top,
					width,
					height: rowHeight,
				};
				left += width + GAP;
			}

			top += rowHeight + GAP;
		}
	}

	return {
		boxes,
		containerHeight: Math.max(0, top - GAP),
	};
}

function createBalancedAlternatingRows(items: IndexedImage[], containerWidth: number) {
	const landscapeItems = items.filter((item) => item.orientation === 'landscape');
	const portraitItems = items.filter((item) => item.orientation === 'portrait');
	const rows = {
		landscape: partitionIntoBalancedRows(landscapeItems, containerWidth),
		portrait: partitionIntoBalancedRows(portraitItems, containerWidth),
	};
	const result: IndexedImage[][] = [];
	let orientation: Orientation =
		(landscapeItems[0]?.index ?? Number.POSITIVE_INFINITY) <
		(portraitItems[0]?.index ?? Number.POSITIVE_INFINITY)
			? 'landscape'
			: 'portrait';

	while (rows.landscape.length > 0 || rows.portrait.length > 0) {
		const selectedRows = rows[orientation];
		if (selectedRows.length > 0) result.push(selectedRows.shift()!);

		const opposite = orientation === 'landscape' ? 'portrait' : 'landscape';
		orientation = rows[opposite].length > 0 ? opposite : orientation;
	}

	return result;
}

function createStableRows(items: IndexedImage[], containerWidth: number) {
	const rows: IndexedImage[][] = [];
	let run: IndexedImage[] = [];

	for (const item of items) {
		if (run.length > 0 && run[0].orientation !== item.orientation) {
			rows.push(...partitionIntoBalancedRows(run, containerWidth));
			run = [];
		}
		run.push(item);
	}
	if (run.length > 0) rows.push(...partitionIntoBalancedRows(run, containerWidth));
	return rows;
}

function partitionIntoBalancedRows(items: IndexedImage[], containerWidth: number) {
	if (items.length === 0) return [];

	const orientation = items[0].orientation;
	const maximumItems = orientation === 'landscape' ? 5 : 8;
	const costs = new Array<number>(items.length + 1).fill(Number.POSITIVE_INFINITY);
	const nextCounts = new Array<number>(items.length).fill(1);
	costs[items.length] = 0;

	for (let start = items.length - 1; start >= 0; start -= 1) {
		let ratioSum = 0;
		for (let count = 1; count <= maximumItems && start + count <= items.length; count += 1) {
			ratioSum += items[start + count - 1].aspectRatio;
			const row = items.slice(start, start + count);
			const rowCost = calculateRowCost(row, ratioSum, containerWidth);
			const totalCost = rowCost + costs[start + count];
			if (totalCost < costs[start]) {
				costs[start] = totalCost;
				nextCounts[start] = count;
			}
		}
	}

	const rows: IndexedImage[][] = [];
	for (let start = 0; start < items.length; ) {
		const count = nextCounts[start];
		rows.push(items.slice(start, start + count));
		start += count;
	}
	return rows;
}

function calculateRowCost(row: IndexedImage[], ratioSum: number, containerWidth: number) {
	const count = row.length;
	const targetArea = targetAreaFor(containerWidth);
	const displayedHeight = calculateTargetConstrainedHeight(row, containerWidth);
	const filledWidth = ratioSum * displayedHeight + GAP * (count - 1);
	const fillRatio = Math.min(1, filledWidth / containerWidth);
	const areaError = row.reduce((sum, item) => {
		const area = item.aspectRatio * displayedHeight ** 2;
		return sum + Math.log(area / targetArea) ** 2;
	}, 0);
	const emptyPenalty = Math.max(0, 0.85 - fillRatio);

	// Comparable photo area is the primary goal. Density is deliberately a
	// secondary tie-breaker so a narrow viewport does not squeeze landscape
	// photos into a tiny but fully-filled row.
	return areaError * 20 + emptyPenalty ** 2 * 10 + 0.5;
}

function calculateRowHeight(row: IndexedImage[], containerWidth: number) {
	const gapWidth = GAP * Math.max(0, row.length - 1);
	const availableWidth = Math.max(1, containerWidth - gapWidth);
	const ratioSum = row.reduce((sum, item) => sum + item.aspectRatio, 0);

	// Row composition is chosen against the shared target area above. Once a
	// row is chosen, let it grow to the exact width of the container so there
	// are no empty side gutters; this intentionally allows a sparse row to be
	// larger than the usual target.
	return availableWidth / ratioSum;
}

function calculateTargetConstrainedHeight(row: IndexedImage[], containerWidth: number) {
	const exactHeight = calculateRowHeight(row, containerWidth);
	const targetArea = targetAreaFor(containerWidth);
	const maximumHeight = Math.min(
		...row.map((item) => Math.sqrt((targetArea * MAX_AREA_SCALE) / item.aspectRatio)),
	);
	return Math.min(exactHeight, maximumHeight);
}

function targetAreaFor(containerWidth: number) {
	// A narrow screen needs a larger share of its width per photograph; wider
	// screens can fit several photographs in a row. Both modes still feed the
	// same area objective for portrait and landscape images.
	const targetEdge =
		containerWidth <= 640
			? Math.min(340, Math.max(160, containerWidth * 0.58))
			: Math.min(300, Math.max(160, containerWidth / 3.6));
	return targetEdge ** 2;
}

function splitIntoConsecutiveGroups(images: RowImageInput[]) {
	const groups: { key: string; items: { image: RowImageInput; index: number }[] }[] = [];

	images.forEach((image, index) => {
		const key = image.group ?? '__all__';
		const previous = groups.at(-1);
		if (!previous || previous.key !== key) groups.push({ key, items: [] });
		groups.at(-1)?.items.push({ image, index });
	});

	return groups;
}

function validAspectRatio(width: number, height: number) {
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
		return 3 / 2;
	}
	return width / height;
}
