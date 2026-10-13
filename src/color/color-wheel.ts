import type { RgbColor } from './color-types.ts';

export function drawHueWheel(canvas: HTMLCanvasElement, selectedHue: number | null) {
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

export function hueToRgb(hue: number): RgbColor {
	const segment = normalizeHue(hue) / 60;
	const intermediate = 1 - Math.abs((segment % 2) - 1);
	const [red, green, blue] =
		segment < 1
			? [1, intermediate, 0]
			: segment < 2
				? [intermediate, 1, 0]
				: segment < 3
					? [0, 1, intermediate]
					: segment < 4
						? [0, intermediate, 1]
						: segment < 5
							? [intermediate, 0, 1]
							: [1, 0, intermediate];
	return [red, green, blue].map((channel) => Math.round(channel * 255)) as RgbColor;
}

export function normalizeHue(value: number) {
	return ((value % 360) + 360) % 360;
}
