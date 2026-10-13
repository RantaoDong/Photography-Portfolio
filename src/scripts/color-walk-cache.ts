import type { RgbColor } from '../color/color-types.ts';

export class ColorWalkImageCache {
	private readonly entries = new Map<string, Promise<HTMLCanvasElement>>();

	get(photoId: string, color: RgbColor, create: () => HTMLCanvasElement) {
		const key = `${photoId}:${color.join(',')}`;
		const existing = this.entries.get(key);
		if (existing) return existing;

		const pending = Promise.resolve().then(create);
		this.entries.set(key, pending);
		pending.catch(() => this.entries.delete(key));
		return pending;
	}

	clear() {
		this.entries.clear();
	}
}
