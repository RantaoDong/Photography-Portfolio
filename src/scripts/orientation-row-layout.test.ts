import { describe, expect, it } from 'vitest';
import { createOrientationRowLayout, type RowImageInput } from './orientation-row-layout';

const mixedImages: RowImageInput[] = [
	{ width: 1600, height: 900 },
	{ width: 1400, height: 1000 },
	{ width: 800, height: 1200 },
	{ width: 1800, height: 1000 },
	{ width: 900, height: 1600 },
	{ width: 1200, height: 800 },
	{ width: 1000, height: 1500 },
	{ width: 1500, height: 1000 },
	{ width: 1000, height: 1400 },
	{ width: 1700, height: 1000 },
	{ width: 900, height: 1300 },
	{ width: 1600, height: 1100 },
];

describe('createOrientationRowLayout', () => {
	it('preserves aspect ratios and never overlaps photographs', () => {
		const layout = createOrientationRowLayout(mixedImages, 1200);

		layout.boxes.forEach((box, index) => {
			expect(box.width / box.height).toBeCloseTo(
				mixedImages[index].width / mixedImages[index].height,
				8,
			);
			expect(box.left).toBeGreaterThanOrEqual(0);
			expect(box.top).toBeGreaterThanOrEqual(0);
			expect(box.left + box.width).toBeLessThanOrEqual(1200);
			expect(box.top + box.height).toBeLessThanOrEqual(layout.containerHeight);
		});

		for (let first = 0; first < layout.boxes.length; first += 1) {
			for (let second = first + 1; second < layout.boxes.length; second += 1) {
				const a = layout.boxes[first];
				const b = layout.boxes[second];
				const overlaps =
					a.left < b.left + b.width &&
					a.left + a.width > b.left &&
					a.top < b.top + b.height &&
					a.top + a.height > b.top;
				expect(overlaps).toBe(false);
			}
		}
	});

	it('keeps each row orientation-consistent without forcing row alternation', () => {
		const layout = createOrientationRowLayout(mixedImages, 1200, {
			reorderWithinGroup: true,
		});
		const rows = Map.groupBy(layout.boxes, (box) => box.top);
		const orientations = [...rows.values()].map((row) => {
			const rowOrientations = new Set(
				row.map((box) => (box.aspectRatio >= 1 ? 'landscape' : 'portrait')),
			);
			expect(rowOrientations.size).toBe(1);
			return [...rowOrientations][0];
		});

		expect(orientations).toContain('landscape');
		expect(orientations).toContain('portrait');

		const groupedByOrientation: RowImageInput[] = [
			...Array.from({ length: 8 }, () => ({ width: 1600, height: 900 })),
			...Array.from({ length: 8 }, () => ({ width: 800, height: 1200 })),
		];
		const groupedLayout = createOrientationRowLayout(groupedByOrientation, 1200, {
			reorderWithinGroup: true,
		});
		const groupedRows = [...Map.groupBy(groupedLayout.boxes, (box) => box.top).values()];
		const groupedOrientations = groupedRows.map((row) =>
			row[0].aspectRatio >= 1 ? 'landscape' : 'portrait',
		);

		const firstPortraitRow = groupedOrientations.indexOf('portrait');
		expect(firstPortraitRow).toBeGreaterThan(1);
		expect(
			groupedOrientations.slice(0, firstPortraitRow).every((value) => value === 'landscape'),
		).toBe(true);
		expect(groupedOrientations.slice(firstPortraitRow).every((value) => value === 'portrait')).toBe(
			true,
		);
	});

	it('keeps consecutive year groups vertically ordered', () => {
		const grouped = mixedImages.map((image, index) => ({
			...image,
			group: index < 6 ? '2026' : '2025',
		}));
		const layout = createOrientationRowLayout(grouped, 1200, {
			reorderWithinGroup: true,
		});
		const firstGroupBottom = Math.max(
			...layout.boxes.slice(0, 6).map((box) => box.top + box.height),
		);
		const secondGroupTop = Math.min(...layout.boxes.slice(6).map((box) => box.top));

		expect(secondGroupTop).toBeGreaterThanOrEqual(firstGroupBottom + 10);
	});

	it('keeps existing photo positions stable when a later batch is appended', () => {
		const firstBatch = mixedImages.slice(0, 6).map((image) => ({
			...image,
			group: '0:2026',
		}));
		const secondBatch = mixedImages.slice(6).map((image) => ({
			...image,
			group: '1:2025',
		}));
		const initial = createOrientationRowLayout(firstBatch, 390, {
			reorderWithinGroup: true,
		});
		const expanded = createOrientationRowLayout([...firstBatch, ...secondBatch], 390, {
			reorderWithinGroup: true,
		});

		expect(expanded.boxes.slice(0, firstBatch.length)).toEqual(initial.boxes);
	});

	it('is deterministic and responsive', () => {
		const options = { reorderWithinGroup: true };
		const wide = createOrientationRowLayout(mixedImages, 1200, options);
		const repeated = createOrientationRowLayout(mixedImages, 1200, options);
		const narrow = createOrientationRowLayout(mixedImages, 480, options);

		expect(repeated).toEqual(wide);
		expect(narrow.boxes).not.toEqual(wide.boxes);
		expect(narrow.boxes.every((box) => box.left + box.width <= 480.000001)).toBe(true);
	});

	it.each([320, 375, 390, 430])(
		'keeps the same orientation-aware layout while fitting several thumbnails at %ipx',
		(containerWidth) => {
			const mobileImages = Array.from({ length: 12 }, () => ({ width: 1600, height: 900 }));
			const layout = createOrientationRowLayout(mobileImages, containerWidth, {
				reorderWithinGroup: true,
			});
			const rows = [...Map.groupBy(layout.boxes, (box) => box.top).values()];

			expect(rows.length).toBeGreaterThan(1);
			expect(rows.every((row) => row.length >= 3)).toBe(true);
			expect(
				layout.boxes.every(
					(box) =>
						box.left >= 0 &&
						box.left + box.width <= containerWidth + 0.000001 &&
						Math.abs(box.width / box.height - 16 / 9) < 0.000001,
				),
			).toBe(true);
		},
	);

	it.each([320, 375, 390, 430, 768, 1200])(
		'keeps mixed-orientation photographs bounded and uncropped at %ipx',
		(containerWidth) => {
			const layout = createOrientationRowLayout(mixedImages, containerWidth, {
				reorderWithinGroup: true,
			});

			layout.boxes.forEach((box, index) => {
				expect(box.left).toBeGreaterThanOrEqual(0);
				expect(box.left + box.width).toBeLessThanOrEqual(containerWidth + 0.000001);
				expect(box.width / box.height).toBeCloseTo(
					mixedImages[index].width / mixedImages[index].height,
					8,
				);
			});
		},
	);

	it('uses compact mobile gaps without changing the desktop gap', () => {
		const grouped = [
			{ width: 1600, height: 900, group: 'first' },
			{ width: 1600, height: 900, group: 'second' },
		];
		const mobile = createOrientationRowLayout(grouped, 360);
		const desktop = createOrientationRowLayout(grouped, 1200);

		expect(mobile.boxes[1].top - (mobile.boxes[0].top + mobile.boxes[0].height)).toBeCloseTo(4);
		expect(desktop.boxes[1].top - (desktop.boxes[0].top + desktop.boxes[0].height)).toBeCloseTo(10);
	});

	it('prioritizes comparable photo areas and expands every row to full width', () => {
		const layout = createOrientationRowLayout(mixedImages, 1200, {
			reorderWithinGroup: true,
		});
		const rows = [...Map.groupBy(layout.boxes, (box) => box.top).values()];
		const fillRatios = rows.map((row) => {
			const left = Math.min(...row.map((box) => box.left));
			const right = Math.max(...row.map((box) => box.left + box.width));
			return (right - left) / 1200;
		});
		const areas = layout.boxes.map((box) => box.width * box.height).sort((a, b) => a - b);
		const lowerArea = areas[Math.floor(areas.length * 0.1)];
		const upperArea = areas[Math.floor(areas.length * 0.9)];
		const landscapeAreas = layout.boxes
			.filter((box) => box.aspectRatio >= 1)
			.map((box) => box.width * box.height);
		const portraitAreas = layout.boxes
			.filter((box) => box.aspectRatio < 1)
			.map((box) => box.width * box.height);
		const average = (values: number[]) =>
			values.reduce((sum, value) => sum + value, 0) / values.length;
		const orientationAreaRatio = average(landscapeAreas) / average(portraitAreas);

		expect(fillRatios.every((fillRatio) => Math.abs(fillRatio - 1) < 0.000001)).toBe(true);
		// Sparse rows are explicitly allowed to exceed the usual target area so
		// they can span the full container width.
		expect(upperArea / lowerArea).toBeLessThan(3.5);
		expect(orientationAreaRatio).toBeGreaterThan(0.5);
		expect(orientationAreaRatio).toBeLessThan(2.25);
	});

	it('does not shrink landscape photos merely to fill a narrow row', () => {
		const layout = createOrientationRowLayout(mixedImages, 360, {
			reorderWithinGroup: true,
		});
		const landscapeAreas = layout.boxes
			.filter((box) => box.aspectRatio >= 1)
			.map((box) => box.width * box.height);
		const portraitAreas = layout.boxes
			.filter((box) => box.aspectRatio < 1)
			.map((box) => box.width * box.height);
		const average = (values: number[]) =>
			values.reduce((sum, value) => sum + value, 0) / values.length;

		expect(average(landscapeAreas) / average(portraitAreas)).toBeGreaterThan(0.8);
	});

	it('preserves strict input order when group reordering is disabled', () => {
		const layout = createOrientationRowLayout(mixedImages, 1200, {
			reorderWithinGroup: false,
		});
		const visualOrder = layout.boxes
			.map((box, index) => ({ box, index }))
			.sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left)
			.map(({ index }) => index);

		expect(visualOrder).toEqual(mixedImages.map((_, index) => index));
	});

	it('keeps sparse result rows near the shared target area when expansion is disabled', () => {
		const [box] = createOrientationRowLayout([{ width: 1600, height: 900 }], 1200, {
			expandRowsToFullWidth: false,
		}).boxes;

		expect(box.width).toBeLessThan(600);
		expect(box.left).toBeGreaterThan(250);
		expect(box.width * box.height).toBeLessThan(150_000);
	});
});
