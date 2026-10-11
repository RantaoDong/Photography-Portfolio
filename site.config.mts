import type { AstroInstance } from 'astro';
import { Instagram } from 'lucide-astro';

export interface SocialLink {
	name: string;
	url: string;
	icon: AstroInstance;
}

export default {
	title: 'RD',
	browserTitle: 'Rantao_photogrpahy',
	owner: 'Rantao Dong',
	profileImage: 'profile.jpg',
	socialLinks: [
		{
			name: 'Instagram',
			url: 'https://www.instagram.com/tttemora_?vrfl=MXF6czIwZzN0OWlkZg%3D%3D&utm_source=qr',
			icon: Instagram,
		} as SocialLink,
	],
};
