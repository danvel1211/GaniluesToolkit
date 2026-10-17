# Ganilues Toolkit · Image Converter & Editor

Two standalone web apps for working with images:

- **Converter** (`index.html`): convert, view, inspect and resize images, one at a time or in batches.
- **Editor** (`editor.html`): a layer-based image editor with filters, brush, text, shapes and crop.

Both run entirely in the browser: files never leave your device, there is no server, and they work offline.

## Editor

- **Layers:** add images, text, shapes and empty paint layers. Show or hide, rename (double-click), reorder by dragging, duplicate, merge down, flatten, delete.
- **Per-layer settings:** position, size, rotation, opacity, 16 blend modes (Multiply, Screen, Overlay, etc.), flip, center, fit to canvas.
- **Filters & adjustments** (per layer, non-destructive): brightness, contrast, saturation, hue, temperature, grayscale, sepia, invert, blur, sharpen, vignette, plus one-click presets (B&W, Vintage, Warm, Cool, Vivid, Fade, Dramatic).
- **Tools:** Move/transform (drag, resize with corner handles, rotate with the round handle), Brush (size, opacity, softness), Eraser, Text (font, size, colour, outline, bold, italic, alignment), Shapes (rectangle / ellipse with fill, outline and rounded corners), Crop, Colour picker, Hand (pan).
- **Document:** new blank canvas with presets, image size, canvas size, transparent or coloured background.
- **Undo / redo** (60 steps), zoom and pan, drag & drop and paste.
- **Export** to any converter format (PNG, JPEG, WebP, GIF, BMP, TIFF, ICO, EPS, PDF, SVG) with quality and scale.

### Shortcuts

| Key | Action | Key | Action |
|---|---|---|---|
| V | Move | Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| B / E | Brush / eraser | Ctrl+J | Duplicate layer |
| T | Text | Ctrl+E | Merge down |
| U | Shape | Ctrl+S | Export |
| C | Crop (Enter applies, Esc cancels) | Ctrl+0 | Fit to screen |
| I | Colour picker | Ctrl + scroll | Zoom |
| H or hold Space | Pan | [ / ] | Brush size |
| Arrows | Nudge layer (Shift = 10 px) | Delete | Delete layer |

## Converter features

- **Convert** between image formats (see the table below), one file or a whole batch at once.
- **View** images with zoom (fit, 100%, zoom in/out) on a transparency checkerboard.
- **Inspect** each file: its real format (detected from the file's bytes, so a mislabelled extension is flagged), MIME type, file size, dimensions, megapixels, aspect ratio, transparency, and camera EXIF data for JPEGs (make, model, date, orientation, software).
- **Resize** by percentage, to fit inside a box (keeps proportions), or to an exact size, with presets.
- **Rotate and flip.**
- **Quality** control for JPEG, WebP, AVIF and PDF. **Background colour** for formats without transparency. **DPI** for EPS, PDF, TIFF and BMP.
- Drag and drop, file picker, or paste from the clipboard (Ctrl+V).

## Supported formats

| Format | Open | Save as | Notes |
|---|:-:|:-:|---|
| JPEG | ✅ | ✅ | |
| PNG | ✅ | ✅ | |
| WebP | ✅ | ✅ | |
| GIF | ✅ (first frame) | ✅ | 256-colour palette, 1-bit transparency |
| BMP | ✅ | ✅ | 24-bit |
| TIFF | ✅ | ✅ | Opens LZW, Deflate, PackBits and uncompressed TIFFs; saves uncompressed RGBA |
| ICO | ✅ | ✅ | Saves a multi-size icon (16–256 px), good for favicons |
| SVG | ✅ | ✅ | Saved SVGs embed the image. They are not traced into vector paths |
| EPS | ℹ️ info only | ✅ | PostScript Level 2, opens in Illustrator, Photoshop, InDesign, Affinity, etc. |
| PDF | ℹ️ info only | ✅ | One-page PDF, page size from the DPI setting |
| AVIF | ✅ | ✅ where supported | Saving depends on the browser (button is greyed out if not available) |
| HEIC | ✅ in Safari | — | Other browsers can't open HEIC |
| PSD, PS | ℹ️ info only | — | |

## Run it

No build step and no install. Either:

- **Double-click `index.html`.** It works straight from disk, offline.
- **Serve the folder** with any static web server, e.g. `python3 -m http.server` and open <http://localhost:8000>.
- **Publish it with GitHub Pages:** repository *Settings → Pages → Deploy from a branch*, pick the branch and `/ (root)`.

## Project layout

```
index.html          Page layout
css/styles.css      Styling (light and dark mode)
editor.html         Editor page
css/editor.css      Editor styling
js/detect.js        Format detection from magic bytes, EXIF reader
js/decode.js        Image decoding shared by both apps
js/encoders.js      Output encoders (BMP, TIFF, ICO, GIF, EPS, PDF and SVG are written by hand; the rest use the browser)
js/app.js           Converter UI, preview, resize/rotate pipeline, conversion
js/editor/filters.js  Adjustments engine (colour matrix, blur, sharpen, vignette)
js/editor/layers.js   Layer model, transforms, rendering
js/editor/editor.js   Editor UI, tools, history, export
js/vendor/          UTIF.js (TIFF decoding) and pako (Deflate), both MIT-licensed
```

## Limitations

- **Raster to vector:** EPS, PDF and SVG output contain the original pixels. Turning a photo or logo into real vector paths (tracing) is a separate feature that could be added later.
- **Opening EPS/PDF/PSD** files as images would need a much heavier engine (e.g. Ghostscript compiled to WebAssembly). The app shows their file details but cannot preview them.
- **Animated GIF/WebP:** only the first frame is converted.
- **Size:** very large images are capped at 16,384 px per side in the converter and 8,192 px in the editor (browser canvas limits).
- **Editor projects** aren't saved between visits yet. Export your result before closing the tab (the page warns you).
- **Editor selections:** there are no lasso or magic-wand selections yet. Tools work on whole layers.
