# Rantao Dong Photography Portfolio

A personal photography portfolio built with Astro. Photographs can be browsed independently by year, place, or subject, with a minimal responsive gallery and lightbox presentation.

## Development

Requirements: a current Node.js release and npm.

```bash
npm install
npm run dev
```

Useful checks:

```bash
npm run lint
npm test
npm run build
npm run preview
```

## Site content

- General identity and social links: `site.config.mts`
- About text: `src/content/about.md`
- Profile image: `public/images/profile.webp`
- Gallery metadata: `src/gallery/gallery.yaml`
- Gallery images: `src/gallery/photos/`
- GitHub Pages URL and base path: `astro.config.mts`

## Photo workflow

### Import photographs

1. Put exported, web-ready JPG or JPEG files into `incoming/`.
2. Run `npm run photo:import`.
3. Enter batch defaults for year, place, subjects, optional series, browsing visibility, and featured status.
4. Accept those defaults or override them for individual photographs.
5. Review the complete preview and confirm the import.

Confirmed imports receive stable sequential IDs and filenames such as `photo-0001`. The files are moved into `src/gallery/photos/`, while their metadata is appended to `src/gallery/gallery.yaml`. EXIF data is not used to determine gallery taxonomy.

### Check consistency

```bash
npm run photo:check
```

This reports metadata entries with missing files and image files without metadata. It never silently deletes metadata. If stale metadata is found, removal requires interactive confirmation and defaults to no.

### Remove photographs

```bash
npm run photo:remove
```

The command lists available photo IDs and accepts one or more selections. IDs can also be supplied directly:

```bash
npm run photo:remove -- photo-0001 photo-0002
```

Removal previews both the files and metadata, requires explicit confirmation, and uses a staged transaction with rollback protection.

## Metadata

All photo metadata remains in one YAML file. Titles, descriptions, series, technical data, and generated features are optional.

```yaml
- id: photo-0001
  file: photos/photo-0001.jpg
  taxonomy:
    year: ['2026']
    place: [Stockholm]
    subject: [Street]
  browse:
    year: true
    place: true
    subject: true
  featured: false
  technical: {}
  features: {}
```

`taxonomy` records a photograph's attributes. The corresponding `browse` flags independently control whether it appears under each browsing dimension. Set `featured: true` to show it in the homepage featured section.

## Deployment

Pushing `main` runs the repository's GitHub Actions checks and deploys the generated `dist/` directory to GitHub Pages.

## Acknowledgement

Adapted from [rockem/astro-photography-portfolio](https://github.com/rockem/astro-photography-portfolio).
