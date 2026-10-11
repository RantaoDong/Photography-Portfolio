import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
	site: 'https://rantaodong.github.io',
	base: 'Photography-Portfolio',
	vite: {
		plugins: [tailwindcss()],
	},
});
