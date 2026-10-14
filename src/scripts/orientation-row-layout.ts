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
	expandRowsToFullWidth?: boolean;
}

type Orientation = 'landscape' | 'portrait';

interface IndexedImage {
	image: RowImageInput;
	index: number;
	aspectRatio: number;
	orientation: Orientation;
}

const DESKTOP_GAP = 10;
const MOBILE_GAP = 4;
const MOBILE_BREAKPOINT = 640;
const MAX_AREA_SCALE = 1.25;
const PORTRAIT_ORPHAN_REPAIR = {
	maximumSourceDistance: 3,
	minimumDonorRowSize: 3,
	minimumHeightScale: 0.65,
	maximumHeightScale: 2,
	maximumContainerHeightRatio: 0.58,
} as const;

/**
 * Builds deterministic, orientation-aware rows. Gallery groups may be locally
 * reordered to balance row fill, but rows follow their earliest source position
 * instead of being forced into a landscape/portrait alternation. Rows never
 * cross a group boundary. Passing reorderWithinGroup: false preserves strict order.
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
	const gap = gapFor(containerWidth);
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
		const normalRows = options.reorderWithinGroup
			? createBalancedRowsInSourceOrder(items, containerWidth)
			: createStableRows(items, containerWidth);
		const rows =
			options.expandRowsToFullWidth === false
				? normalRows
				: repairPortraitOrphanRows(normalRows, containerWidth);

		for (const row of rows) {
			const rowHeight =
				options.expandRowsToFullWidth === false
					? calculateTargetConstrainedHeight(row, containerWidth)
					: calculateRowHeight(row, containerWidth);
			const contentWidth =
				row.reduce((sum, item) => sum + rowHeight * item.aspectRatio, 0) +
				gap * Math.max(0, row.length - 1);
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
				left += width + gap;
			}

			top += rowHeight + gap;
		}
	}

	return {
		boxes,
		containerHeight: Math.max(0, top - gap),
	};
}

function repairPortraitOrphanRows(rows: IndexedImage[][], containerWidth: number) {
	const repairedRows = rows.map((row) => [...row]);
	const orphanPortraits = repairedRows
		.filter((row) => row.length === 1 && row[0].orientation === 'portrait')
		.map((row) => row[0]);

	for (const portrait of orphanPortraits) {
		const orphanRowIndex = repairedRows.findIndex((row) => row.length === 1 && row[0] === portrait);
		if (orphanRowIndex < 0) continue;

		const candidate = repairedRows
			.flatMap((row, rowIndex) =>
				row.length >= PORTRAIT_ORPHAN_REPAIR.minimumDonorRowSize
					? row
							.filter((item) => item.orientation === 'landscape')
							.map((item) => ({ item, rowIndex }))
					: [],
			)
			.filter(
				({ item }) =>
					Math.abs(item.index - portrait.index) <= PORTRAIT_ORPHAN_REPAIR.maximumSourceDistance,
			)
			.filter(({ item }) => isReasonablePortraitPair([portrait, item], containerWidth))
			.sort((first, second) => {
				const firstDistance = Math.abs(first.item.index - portrait.index);
				const secondDistance = Math.abs(second.item.index - portrait.index);
				if (firstDistance !== secondDistance) return firstDistance - secondDistance;
				const firstIsAhead = first.item.index > portrait.index ? 0 : 1;
				const secondIsAhead = second.item.index > portrait.index ? 0 : 1;
				return firstIsAhead - secondIsAhead;
			})[0];

		if (!candidate) continue;

		repairedRows[candidate.rowIndex] = repairedRows[candidate.rowIndex].filter(
			(item) => item !== candidate.item,
		);
		repairedRows[orphanRowIndex] = [portrait, candidate.item].sort(
			(first, second) => first.index - second.index,
		);
	}

	return repairedRows
		.filter((row) => row.length > 0)
		.sort((first, second) => first[0].index - second[0].index);
}

function isReasonablePortraitPair(row: IndexedImage[], containerWidth: number) {
	const rowHeight = calculateRowHeight(row, containerWidth);
	const targetEdge = targetEdgeFor(containerWidth);
	return (
		rowHeight >= targetEdge * PORTRAIT_ORPHAN_REPAIR.minimumHeightScale &&
		rowHeight <= targetEdge * PORTRAIT_ORPHAN_REPAIR.maximumHeightScale &&
		rowHeight <= containerWidth * PORTRAIT_ORPHAN_REPAIR.maximumContainerHeightRatio
	);
}

function createBalancedRowsInSourceOrder(items: IndexedImage[], containerWidth: number) {
	const landscapeItems = items.filter((item) => item.orientation === 'landscape');
	const portraitItems = items.filter((item) => item.orientation === 'portrait');
	const rows = [
		...partitionIntoBalancedRows(landscapeItems, containerWidth),
		...partitionIntoBalancedRows(portraitItems, containerWidth),
	];

	return rows.sort((first, second) => first[0].index - second[0].index);
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
	const filledWidth = ratioSum * displayedHeight + gapFor(containerWidth) * (count - 1);
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
	const gapWidth = gapFor(containerWidth) * Math.max(0, row.length - 1);
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
	// Narrow screens intentionally use small thumbnails so the same row-building
	// algorithm can retain its multi-photo rhythm on a phone. Both modes still
	// feed the same area objective for portrait and landscape images.
	return targetEdgeFor(containerWidth) ** 2;
}

function targetEdgeFor(containerWidth: number) {
	return containerWidth <= MOBILE_BREAKPOINT
		? Math.min(112, Math.max(72, containerWidth * 0.24))
		: Math.min(300, Math.max(160, containerWidth / 3.6));
}

function gapFor(containerWidth: number) {
	return containerWidth <= MOBILE_BREAKPOINT ? MOBILE_GAP : DESKTOP_GAP;
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
