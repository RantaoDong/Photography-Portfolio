Live site: https://rantaodong.github.io/Photography-Portfolio/

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

## Local color analysis

Generate color features for every photograph currently registered in `src/gallery/gallery.yaml`:

```bash
npm run color:analyze
```

The command analyzes registered photographs whether public or hidden and replaces
`src/generated/photo-color-features.json` atomically. The generated file contains its schema and
analysis versions, analysis settings, perceptual average color, dominant colors and proportions,
brightness, saturation, a 24-bin hue distribution, neutral-color proportion, and a 4×4 spatial
grid with up to three local dominant colors per cell. Color diversity, palette concentration, and
separate chromatic and neutral tone-strength values keep multicolor photographs from being treated
as a confident single overall color. Very dark or low-chroma pixels are excluded from reliable hue
coverage so small near-black color casts do not create false hue matches. It is derived data and should not be edited manually.
`gallery.yaml` is never changed by this command.

Inspect the generated results and test color matching in the separate local-only debug interface:

```bash
npm run color:debug
```

The debug server binds to `127.0.0.1`, opens in the default browser, and stops with `Ctrl+C`. It is
not an Astro page and is not included in the public site build. Regenerate the feature file after
adding, removing, or changing photographs.

## Color Path

The public Color Path mode lets visitors define three to five ordered points on a two-dimensional
hue-and-saturation disk. It converts those anchors into a continuous path, chooses an adaptive
five-to-fifteen-photo sequence using the shared overall-color features, and keeps results stable
until an edited draft path is confirmed again.

Previous/Next navigation uses a fixed, contain-fitted photo stage. Its Canvas transition removes
detail from the current photograph, shifts a restrained color bias between the two corresponding
path positions while preserving broad spatial color regions, then restores detail in the next
photograph. Adjacent images are preloaded, overlapping navigation is disabled during the effect,
and `prefers-reduced-motion: reduce` switches immediately without animation. Sequence settings
live in `src/color/color-path-config.ts`, while public transition defaults and validation live
separately in `src/color/color-path-transition-config.ts`. The renderer lives in
`src/color/color-path-transition.ts` and does not participate in sequence selection.
The viewer's minimal linear indicator uses a softened gradient sampled from the committed path and
places each result at its actual normalized path position, so adaptively spaced photographs are not
displayed at artificial, uniform intervals. This display-only color treatment does not affect
matching or transition colors.

### Color Path Debug tool

Start the integrated, local-only sequence inspector and transition tuner:

```bash
npm run color-path:debug
```

The tool binds to `127.0.0.1:4178`, opens in the default browser, and stops with `Ctrl+C`. It is a
separate Vite development surface, not an Astro route, so it is excluded from the public build. It
reads the registered gallery and generated color features without editing `gallery.yaml`.

First create a three-to-five-point path and select **Generate sequence**. The inspector calls the
same public path interpolation, Color Tone scoring, sequence generator, ordering, and adaptive
length logic, then presents the resulting photographs as ordered thumbnails with their IDs, path
positions, target colors, and similarity values. Numbered sequence markers are also drawn over the
path for diagnosing gaps and density.

Select an arrow between any two adjacent thumbnails to feed those real sequence entries into the
shared transition renderer. The fixed-stage preview supports forward and reverse playback,
direction-aware 0–100% scrubbing, and controls for duration, detail loss, color pull, grain amount,
grain scale, spread irregularity, and spread softness. **Save as current defaults** validates and
atomically writes the current values to the centralized transition configuration; it never changes
sequence weights.

Clear frames remain contain-fitted inside the stable stage. During the abstract middle, the active
transition region interpolates between the two photographs' actual contained bounds, so portrait
and landscape combinations expand or contract without moving the page. A lightweight,
deterministic distance-field mask adds soft watercolor-like edge variation while the shared blur,
path-color bias, residual spatial structure, and film-like grain remain intact.

## Color Walk development tool

Start the separate local-only Color Walk development tool:

```bash
npm run color-walk:tune
```

The tool binds to `127.0.0.1`, opens in the default browser, and stops with `Ctrl+C`. It is not an
Astro route and is excluded from the production build. It reads registered gallery photographs but
never edits `src/gallery/gallery.yaml`.

The tool keeps two concerns in separate views:

- **Effect Tuner** keeps the single-photo workflow for inspecting Original, Raw pixel mask,
  Refined mask, and Final effect while tuning rendering and region parameters.
- **Ranking Debug** applies one continuously selected color to the registered library and presents
  the eligible photographs in ranked visual order. Each card exposes expandable presence,
  coherence, boundary clarity, color separation, reveal impact, overspread penalty, support ratio,
  and final-score diagnostics. Five high-level controls tune presence, coherence, color separation,
  reveal impact, and overspread penalty without mixing ranking controls into the renderer panel.

Use the color wheel or exact color field, choose representative photographs, and adjust the
human-readable preservation, transition, saturation, brightness, and region controls. The
**Pixel-only / Region-aware** switch compares the existing independent-pixel result with the
edge-aware refinement without changing the public default. Four synchronized views show Original,
Raw pixel mask, Refined mask, and Final effect; white mask pixels are preserved most strongly. Hold
the Final effect preview to reveal the original photograph.

Region-aware mode keeps the Lab-distance mask as its raw signal, reduces the source guidance and
mask to a maximum 360px long edge, then applies a fixed-radius separable joint bilateral refinement.
Source-color differences gate the support at visible edges. The upsampled result is combined with
the full-resolution raw mask using `max`, so refinement can fill weak variations inside coherent
regions but cannot weaken a pixel that the raw Lab mask already preserves. `Region smoothing`,
`Edge sensitivity`, and `Region support` are deliberately centralized beside the original effect
parameters in `src/color/color-walk-config.ts`.

Slider changes are previews only. To make the current combination the public Color Walk default,
select **Apply as public defaults**, review the confirmation message, then select **Confirm update**.
The local server validates the values and updates only `colorWalkRenderingDefaults` in
`src/color/color-walk-config.ts`. Reset and the Balanced preset then use the newly saved defaults.
The technical values can also be copied for review.

The Effect Tuner and public Color Walk share the same renderer, rendering schema, and default
object. Ranking Debug and the public walk call the same `findColorWalkMatches` scoring and sorting
function; the debugger does not maintain an approximation. Ranking weights live separately in
`src/color/color-walk-ranking-config.ts`, while rendering and region defaults remain in
`src/color/color-walk-config.ts`. Ranking slider changes are local previews until **Apply ranking
defaults** is confirmed; the local server then updates only `colorWalkRankingDefaults`.

Prepared image pixels and perceptual distance data are cached so ordinary slider changes do not
reload or decode the photograph. The public viewer prepares only the active photograph at a bounded
1200px long edge, caches each completed photo/color result, and never recomputes either mask when
the user holds or releases the photograph. No semantic or ML segmentation is used.

Run the repeatable region-refinement benchmark with:

```bash
npm run color-walk:benchmark
```

The benchmark automatically selects one portrait and one landscape gallery photograph, uses the
same 1200px working-image and 360px refinement limits, warms the implementation once, and reports
the median of seven cached-guidance mask runs. On the development machine used for the initial
implementation, `photo-0001` at 900×1200 took approximately 279ms cold / 195ms cached and
`photo-0002` at 1200×900 took approximately 264ms cold / 190ms cached; one-time Lab preparation was
approximately 1.05s in the Node benchmark. These figures exclude image decode and are
device/runtime dependent. The tuner also includes
**Benchmark active photo**, which measures one-time Lab preparation plus the median edge-mask and
final Canvas-render costs in the actual browser. The active public refinement mode is always the
explicit `refinementMode` saved in `colorWalkRenderingDefaults`; changing the comparison switch by
itself never changes that default.

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
