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
- Profile image: `public/images/profile.jpg`
- Gallery metadata: `src/gallery/gallery.yaml`
- Gallery images: `src/gallery/photos/`
- GitHub Pages URL and base path: `astro.config.mts`

## Photo workflow

### Local photo manager

Start the local-only browser manager:

```bash
npm run photo:manage
```

The command binds to `127.0.0.1`, opens the manager in the default browser, and stops with `Ctrl+C`. The manager is not included in the public Astro build. It provides thumbnail browsing, incoming-photo import, individual and batch metadata editing, dynamic taxonomy options, gallery-preview filters, visibility controls, safe deletion, and consistency reporting.

Year, Place, and Subject choices are derived directly from `src/gallery/gallery.yaml`. New values become reusable after they are assigned and saved. Batch editing saves the values shown in the form without separate enable checkboxes. A mixed field keeps each photograph's existing value until a replacement is selected; subjects retain explicit add, remove, and replace operations.

The library can be filtered using the same All, Year, Place, and Subject visibility rules used by the public gallery. It also provides Featured and Not featured views. Separate publication filters show public, hidden, or all photographs, and the Missing metadata group finds photographs without Year, Place, or Subject values.

### Import photographs

1. Put exported, web-ready JPG or JPEG files into `incoming/`.
2. Run `npm run photo:import`.
3. Enter batch defaults for year, place, subjects, browsing visibility, and featured status.
4. Accept those defaults or override them for individual photographs.
5. Review the complete preview and confirm the import.

Confirmed imports receive stable sequential IDs and filenames such as `photo-0001`. The files are moved into `src/gallery/photos/`, while their metadata is appended to `src/gallery/gallery.yaml`. EXIF data is not used to determine gallery taxonomy.

Files left in `incoming/` are staging files only and never appear on the public site before a confirmed import.

### Check consistency

```bash
npm run photo:check
```

This reports metadata entries with missing files and image files without metadata. It never silently deletes metadata. If stale metadata is found, removal requires interactive confirmation and defaults to no.

### Optimize photographs for the web

```bash
npm run photo:optimize
```

The command previews the number and total size of affected JPEGs, then asks for confirmation. By default it limits the long edge to 2560 pixels and writes progressive JPEGs at quality 84. Replacement is staged and validated per file; filenames, paths, and YAML metadata entries remain unchanged. Keep archival originals outside this website repository.

Preview without changing files, or override the defaults:

```bash
npm run photo:optimize -- --dry-run
npm run photo:optimize -- --max-edge 2560 --quality 84
```

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

All photo metadata remains in one YAML file. Titles, descriptions, technical data, and generated features are optional.

```yaml
- id: photo-0001
  file: photos/photo-0001.jpg
  taxonomy:
    year: ['2026']
    place: [Stockholm]
    subject: [Street]
  browse:
    all: true
    year: true
    place: true
    subject: true
  featured: false
  technical: {}
  features: {}
```

`taxonomy` records a photograph's attributes. The corresponding `browse` flags independently control whether it appears on the All page or under each browsing dimension. Missing `browse.all` values are treated as `true` for backward compatibility. New manager imports default All, Year, Place, and Subject visibility to `true`. Set `featured: true` to show a photograph in the homepage featured section.

Set `published: false` to hide a photograph from the public site without deleting its image or metadata. The local manager can make it public again later. Permanent deletion remains a separate preview-and-confirm action.

## Deployment

Pushing `main` runs the repository's GitHub Actions checks and deploys the generated `dist/` directory to GitHub Pages.

## Acknowledgement

Adapted from [rockem/astro-photography-portfolio](https://github.com/rockem/astro-photography-portfolio).
