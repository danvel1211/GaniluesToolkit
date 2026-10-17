# Ganilues Toolkit · Image Converter & Editor

Two standalone web apps for working with images:

- **Converter** (`index.html`): convert, view, inspect and resize images, one at a time or in batches.
- **Editor** (`editor.html`): a layer-based image editor with selections, object removal, filters, painting, text, shapes and crop.

Both run entirely in the browser: files never leave your device, there is no server, and they work offline.

## Editor

- **Layers:** add images, text, shapes and empty paint layers. Show or hide, rename (double-click), reorder by dragging, duplicate, merge down, flatten, delete.
- **Per-layer settings:** position, size, rotation, opacity, 16 blend modes (Multiply, Screen, Overlay, etc.), flip, center, fit to canvas.
- **Filters & adjustments** (per layer, non-destructive): brightness, contrast, saturation, hue, temperature, grayscale, sepia, invert, blur, sharpen, vignette, plus one-click presets (B&W, Vintage, Warm, Cool, Vivid, Fade, Dramatic).
- **Tool groups:** related tools share a toolbar button. Right-click it, long-press it or click its corner triangle to pick a sub-tool; Shift + the shortcut cycles through them.

  | Group | Tools |
  |---|---|
  | Move (V) | Move & transform: drag, resize with corner handles, rotate with the round handle |
  | Select (M, L, W) | Rectangle select, Ellipse select, Lasso, Magic wand |
  | Brush (B) | Brush (size, opacity, softness), Pencil (hard edge), Spray paint |
  | Eraser (E) | Eraser, Magic eraser (erases similar colours) |
  | Fill (G) | Paint bucket, Gradient (linear / radial, to second colour or transparent) |
  | Text (T) | Horizontal text, Vertical text |
  | Shape (U) | Rectangle, Ellipse, Line, Triangle, Star |
  | Crop (C) | Crop |
  | Picker (I) | Colour picker (Alt+click picks the second colour) |
  | Hand (H, Z) | Hand (pan), Zoom (Alt+click zooms out) |

- **Text on the canvas:** click with the Text tool and type straight onto the image; double-click existing text to edit it. Esc or clicking outside finishes. Font, size, colour, outline, bold, italic, alignment and vertical text are in the side panel.
- **Selections:** Shift adds to a selection, Alt subtracts. With a selection you can:
  - **Remove object:** rebuilds the selected area from the rest of the photo (see below)
  - Delete, fill with the main colour, copy to a new layer, crop to it, invert, deselect
- **Main and second colour** swatches (X swaps, D resets to black/white).
- **Document:** new blank canvas with presets, image size, canvas size, transparent or coloured background.
- **Undo / redo** (60 steps), zoom and pan, drag & drop and paste.
- **Export** to any converter format (PNG, JPEG, WebP, GIF, BMP, TIFF, ICO, EPS, PDF, SVG) with quality and scale.

### Removing objects (no AI)

Select a person or object (the Lasso is easiest; include a little background around it), select the photo layer and click **Remove object**. The area is rebuilt from similar patches found around it using **PatchMatch**, the same non-AI technique behind Photoshop's original Content-Aware Fill. It runs entirely in your browser in a background worker: about a second for a person in a normal photo and a few seconds for a large object in a full-size phone photo. A Cancel button stops a long removal. The result stays at full resolution and is built from real pixels of the photo, so it isn't blurred or stretched.

It works best on textures and backgrounds: sky, water, sand, grass, walls, roads. Large objects in front of detailed or structured backgrounds (faces, text, straight architectural lines) can come out smudged or repeated. Ctrl+Z undoes it, and you can run it again on a smaller area.

### Shortcuts

| Key | Action | Key | Action |
|---|---|---|---|
| V | Move | Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| M / L / W | Select / lasso / magic wand | Ctrl+A / Ctrl+D | Select all / deselect |
| B / E / G | Brush / eraser / fill group | Ctrl+Shift+I | Invert selection |
| T | Text | Ctrl+J | Duplicate layer (or copy selection to a layer) |
| U | Shapes | Ctrl+E | Merge down |
| C | Crop (Enter applies, Esc cancels) | Ctrl+S | Export |
| I | Colour picker | Ctrl+0 / Ctrl + scroll | Fit / zoom |
| H, Z or hold Space | Pan / zoom | [ / ] | Brush size |
| Shift + tool key | Next tool in that group | X / D | Swap / reset colours |
| Arrows | Nudge layer (Shift = 10 px) | Delete | Delete selected pixels, or the layer |

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
| EPS | ✅ see below | ✅ | Saves PostScript Level 2, opens in Illustrator, Photoshop, InDesign, Affinity, etc. |
| PDF | ℹ️ info only | ✅ | One-page PDF, page size from the DPI setting |
| AVIF | ✅ | ✅ where supported | Saving depends on the browser (button is greyed out if not available) |
| HEIC | ✅ in Safari | — | Other browsers can't open HEIC |
| PSD, PS | ℹ️ info only | — | |

**Opening EPS files.** Browsers can't run PostScript, so the apps show the image stored inside the EPS:

- EPS files saved by this toolkit and **Photoshop EPS** files open at full resolution (RGB, CMYK, greyscale; raw, hex or JPEG-encoded).
- **Illustrator and most other EPS files** open from their embedded **TIFF preview**. Illustrator adds one by default, usually at 72 ppi, so it's fine for viewing and light edits but isn't the full-quality vector artwork.
- Files with only a black & white **EPSI preview** open at that preview's resolution.
- A vector-only EPS with no preview can't be shown. Re-save it from Illustrator with a TIFF preview, or export it as SVG/PDF/PNG.

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
js/eps.js           EPS reader (embedded image / TIFF preview / EPSI preview)
js/encoders.js      Output encoders (BMP, TIFF, ICO, GIF, EPS, PDF and SVG are written by hand; the rest use the browser)
js/app.js           Converter UI, preview, resize/rotate pipeline, conversion
js/editor/filters.js  Adjustments engine (colour matrix, blur, sharpen, vignette)
js/editor/layers.js   Layer model, transforms, rendering
js/editor/editor.js   Editor UI, tools, selections, history, export
js/editor/toolbar.js  Tool groups and flyout menus
js/editor/inpaint.js  Object removal (PatchMatch image completion)
js/vendor/          UTIF.js (TIFF decoding) and pako (Deflate), both MIT-licensed
```

## Limitations

- **Raster to vector:** EPS, PDF and SVG output contain the original pixels. Turning a photo or logo into real vector paths (tracing) is a separate feature that could be added later.
- **Rendering EPS vector artwork** (rather than its preview) and opening PDF/PSD would need a much heavier engine (e.g. Ghostscript compiled to WebAssembly).
- **Animated GIF/WebP:** only the first frame is converted.
- **Size:** very large images are capped at 16,384 px per side in the converter and 8,192 px in the editor (browser canvas limits).
- **Editor projects** aren't saved between visits yet. Export your result before closing the tab (the page warns you).
- **Editor selections** limit Remove object, Delete, Fill and Copy to layer. Painting and filters still apply to the whole layer.
