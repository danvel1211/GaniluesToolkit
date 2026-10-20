# Off the Clock Creative Suite

*Private creative and file tools that run in your browser.*

Off the Clock Creative Suite is a set of standalone web tools for working with files and images. It is free for anyone to use. Open `index.html` to get the home screen:

- **File combination** (`pdf.html`): merge PDFs and images into one PDF, arrange, rotate, duplicate and delete pages, or extract selected pages.
- **Fill & sign PDF** (`sign.html`): fill in PDF forms, detect blank fields in ordinary PDFs, add text, dates, ticks and white-out, and sign with a drawn, typed or uploaded signature.
- **Edit image** (`editor.html`): a layer-based image editor with selections, object removal, filters, painting (right-click the canvas with the Brush or Eraser for seven brush styles with live previews), retouch tools (clone stamp, blur, sharpen, smudge, dodge, burn), blur or pixelate a selection to hide faces and plates, drop shadow and outline for any layer, one-click auto enhance, layer alignment, text, shapes and crop with ratio presets (1:1, 4:5, 16:9, 9:16 and more).
- **Collage maker** (`collage.html`): photo collages and grids with 16 layouts, adjustable spacing, borders and rounded corners, drag to swap or reposition photos, and export for social media or print (PNG, JPEG, WebP, PDF).
- **File converter** (`converter.html`): convert, view, inspect and resize images, one at a time or in batches.

Everything runs in the browser, works offline, opens with an animated loading screen that preloads each tool, and has a light and a dark theme (dark by default; the switch is in every header). A floating tool switcher at the top of every page jumps between the tools.

## Editions

The same app ships under two brands, listed in `brands/editions.json`:

| Edition | Logo | Accent colour |
|---|---|---|
| Off the Clock Creative Suite | none yet | indigo / blue |
| Studiolo | arched window (`brands/studiolo/logo.svg`) | amber / terracotta (`brands/studiolo/brand.css`) |

**Studiolo ships two ways:**

1. **Portable Windows app** (`dist/Studiolo-portable.zip`, from `tools/build_exe.py`): a single `Studiolo.exe`. Double-click it and it opens in its own window — no installer, no setup wizard, no admin rights, nothing written outside a small per-user settings folder. It can run from the Desktop, any folder, or a USB stick, and copying or moving the file is all "installing" it ever needs. This is the one to use on a work laptop that locks down installers — there's nothing to install.
2. **HTML package** (`dist/studiolo.zip`, from `tools/build_editions.py`), for Mac/Linux or anyone who'd rather keep the readable web files. Its folder contains only:

   ```
   Studiolo/
   ├── Studiolo.html                 opens the app in the browser
   ├── Add Studiolo to Desktop.cmd   optional Windows setup for the icon
   ├── Read Me.txt
   └── resources/                    the app itself
   ```

   An `.html` file always shows the default browser's icon on Windows, so the Studiolo icon (`brands/studiolo/Studiolo.ico`, designed in `app-icon.svg`) is applied by `Add Studiolo to Desktop.cmd`. Run once, it creates Desktop and Start-menu shortcuts to `Studiolo.html` with the icon and gives the folder the icon via a hidden `desktop.ini`. It's a plain-text script that installs and downloads nothing. Inside the app, the icon is also the browser-tab icon.

### The portable app (`brands/studiolo/app/`)

A small Go program (`main.go`) that serves the whole web app from memory on `127.0.0.1` (never reachable from outside the machine) and shows it in a plain window, using the WebView2 engine already built into Windows 10/11 — no browser chrome, no address bar, and the right-click "Inspect"/F12 developer tools are turned off.

Unlike the HTML package, **none of the app's HTML, CSS or JavaScript is readable inside the `.exe`.** `tools/build_exe.py` packs the built web app into one ZIP, encrypts it with AES-256-GCM, and embeds only that encrypted blob (`app.bin`) plus a split, masked key (`keydata.go`) — both generated, not committed. The running app decrypts it in memory only; no plain files ever touch disk. `winres/` holds the icon and version info embedded in the executable.

```
python3 tools/build_exe.py
```

runs the whole pipeline (build the Studiolo edition → pack & encrypt it → cross-compile `Studiolo.exe` for Windows → zip it) from any machine with Go 1.22+, no Windows box or C compiler needed. Like scrambled JavaScript, this raises the bar a lot — it stops casual copying and "paste it into an AI" — but it isn't unbreakable; a determined reverse engineer with native-code tools could still get at it. The licence codes stay safe either way, since even full access to the code can't recover them from their one-way fingerprints.

The first run may show Windows' "protected your PC" notice, because the app isn't signed with a paid publisher certificate; choosing "More info → Run anyway" is a one-time step, not an install.

### In-app updater (paused: backend done, button not built yet)

Groundwork for a "Check for updates" button in the portable app. **Nothing is switched on in the shipped app yet.**

- `brands/studiolo/app/update.go` (tested with `go test` in `brands/studiolo/app/`): asks the licence script for the newest version, downloads `Studiolo.exe` in pieces, checks its size and SHA-256 fingerprint, then swaps it in by renaming the running program to `Studiolo.old.exe`, putting the new one in its place and restarting. It clears the window engine's *cache* but keeps the saved licence, because deleting that would lock customers out (each code works once).
- `brands/studiolo/app/main.go` already contains the bridge functions the page will call (`__sxu_*`) and the start-up cleanup.
- `brands/studiolo/activation-server/Code.gs` has the matching `update` and `chunk` actions and a `setUpdate()` function that publishes a new version from a private Drive file. The script already deployed in Google does **not** have these yet.
- Still to do: the side "Updates" button and panel in the page (progress, notes, restart), a `version.txt` read by `tools/build_exe.py`, and a trial on a real Windows PC. The first updater-enabled build must be handed out by hand; later versions can update themselves.

### Studiolo licensing

Studiolo is locked until the user enters **their name and a licence code** (like `7KQ2-M9XA-P4TD-WZ3R`). The name personalises the app ("Good evening, Maria", "Licensed to Maria Santos"); the code unlocks it. Off the Clock Creative Suite has no licensing.

- **How codes are checked:** the app holds only one-way fingerprints of the codes (`brands/studiolo/license-codes.js`, SHA-512 with a per-batch salt), never the codes themselves, so they can't be read out of the files. Each code is 16 random characters (80 bits), far too many to guess. Checking happens offline.
- **Making codes:** `python3 tools/make_license_batch.py --count 1000 --out "<private folder outside this project>"` creates a new batch: the real codes go to a spreadsheet and CSV in that folder (keep them private), and their fingerprints are added to the app. Rebuild with `tools/build_editions.py` and ship the update; older codes keep working. The script refuses to write codes inside the project.
- **Developer code:** a one-code batch named `DEV` (`--count 1 --batch-id DEV`) is the creator's own licence; the app shows "Developer" instead of "Licensed to".
- **Disguised in the package:** in the Studiolo build, the licence check, the fingerprints (as one opaque base64 block) and TweetNaCl are merged into a minified `js/core.js` (via `npx terser`), storage keys and element names are neutral, and this README is left out. This makes the mechanism hard to spot, not impossible to find; the codes themselves can't be recovered either way. The readable sources stay in `brands/studiolo/`.
- **One person per code (optional online check):** a small Google Apps Script (`brands/studiolo/activation-server/`, setup in `SETUP.md`) checks the code against your private Google Sheet when someone activates. A code works once: if its "Activated by" cell in the sheet is empty, the name is registered; if any name is already there, the app says the code is used. To let a customer activate again, clear their row's Activated by and Activated on cells. This applies to every Studiolo build (portable .exe and HTML package). The sheet's link is never in the app; the script's address is kept in the git-ignored `brands/studiolo/activation.json`, stored scrambled inside the bundle, and the Content Security Policy is opened only to `script.google.com` for this one call. Activation needs the internet once; afterwards the licence works offline. Without `activation.json`, Studiolo stays fully offline. Only the name and code are sent, never files.
- **Checked on every launch:** each time Studiolo opens it asks the script whether the code is still registered to that name, once per launch and without blocking the screen. If the "Activated by" cell was cleared or changed (a refund, a leaked code), Studiolo locks within a few minutes of its next launch. If the computer is offline, Studiolo keeps working for **7 days** since the last successful check, then asks the user to connect once. Checks are read-only and cached by the script for 5 minutes, so many people opening the app at once is fine; only claiming a code is queued.
- **Activation** is remembered in the browser. The About page shows the licence, lets the user change their name, and can remove the licence from that browser.
- **Limits of offline licensing:** the name isn't tied to the code (codes are made before names are known; your spreadsheet records who got which code), one code can be shared between people, codes can't be cancelled remotely, and someone with programming skills could remove the check from the code. Stopping those would need an online licence server, which would break the no-internet design.

Studiolo also has an **About** page (`brands/studiolo/about.html`, with `about.css` and `about.js`) crediting its creator, Daniel Velasquez. It's linked from every Studiolo page and the home screen. Pages and links that belong to one edition are listed under `extraFiles` and `navLinks` in `brands/editions.json`.

The files in this folder are the Off the Clock Creative Suite edition. To build both editions as ready-to-share folders and ZIP files in `dist/`, run:

```
python3 tools/build_editions.py
```

The script swaps in each edition's name, tagline, logo, favicon and colours, so new features only need to be written once. To give Off the Clock Creative Suite a logo later, add an SVG and point its `logo` entry in `brands/editions.json` at it. Logos go where the `<!-- brand-logo -->` placeholders are in each page.

## Games

`games/ring-breaker/` is **Ring Breaker**, an idle game, separate from the creative tools and left out of both editions. A ball bounces inside rings; every hit damages the ring, and when its HP number hits zero the ball escapes to the next, bigger ring. Cash buys upgrades (Damage, Cash Income, Ball Speed, Extra Ball), each level-up offers three cards (Power, Fortune, Swift, Prospector, Crit, Burn, Bomb, Lightning, Twin, Finisher; Power unlocks the combat cards), bosses and chests drop keys and gems, and it keeps earning while you're away.

- `core.js` holds the rules and balance (tested with `Core.simulate`), `game.js` the drawing, sound, menus and saving.
- `python3 tools/build_game.py` builds one self-contained file, `out/Ring-Breaker.html`, that works offline on a phone or PC. Progress is saved in the browser on the device; nothing is sent anywhere.
- **Android app:** `python3 tools/build_apk.py` builds `out/Ring-Breaker.apk` (about 0.1 MB, Android 7.0 or newer) with no Android Studio: the game page is bundled in a small full-screen WebView app (`games/ring-breaker/android/`). The app has **no internet permission**, only vibration. Build tools are downloaded once from Maven Central into `out/android-tools/`. The first build creates a signing key in `out/ringbreaker.jks` (password in `out/ringbreaker-keystore-password.txt`): **back both up**, because an update must be signed with the same key or phones will refuse to install it over the old version. To install on a phone, copy the `.apk` over, open it, and allow "install unknown apps" for the app you opened it with.

## Privacy

- **Nothing is uploaded and nothing is downloaded from the internet.** Every library, icon and font the app uses ships inside this folder (the handwriting fonts for typed signatures are in `fonts/`). There are no CDNs, web fonts, analytics, cookies or trackers.
- **Enforced by the browser:** every page carries a Content Security Policy that blocks connections to any other address, so even a future mistake in the code couldn't send your files anywhere or pull content from the web.
- **Stored on your device:** only the light/dark theme choice, in the browser's local storage. Files you open stay in memory and are gone when you close the tab.

## File combination

- Add PDFs and images (JPG, PNG, WebP, GIF, BMP). All pages appear as thumbnails, colour-coded by file.
- **Arrange:** drag pages (several at once after Shift/Ctrl+click), or use Alt+←/→. Rotate (R), duplicate (Ctrl+D), delete (Del), reverse, reset.
- **Preview** a page by double-clicking it.
- **Download** everything as one PDF, or only the selected pages (also a quick way to split a PDF).
- Pages are copied, not re-rendered, so text stays selectable and graphics stay sharp. Images can be placed on A4 or Letter pages, or at their own size.
- `samples/` has three small PDFs to try it with (a 3-page report, a 2-page invoice with a landscape page, and a 4-page gallery with one page stored rotated).

## Fill & sign PDF

- **Fillable forms:** form fields in the PDF (text boxes, tick boxes, radio buttons, dropdowns) are found automatically and shown as inputs right on the page. Your answers are saved into the real form fields. Tick **Lock the form after filling** to flatten them so they can't be changed.
- **Detect fields** (for PDFs without real fields): finds blanks such as `Name: ______`, `Date: ____` and `Signature: ________` from the page text and highlights them. Click one to type, add today's date, or sign, and the entry is placed on the line. It looks at text, so blanks drawn only as lines with no label, or scanned paper pages, aren't detected; use the Text and Signature tools there.
- **Signatures:** draw one (mouse, pen or finger; pen pressure is used), type your name in a handwriting style, or upload a photo/scan, and the paper background is removed automatically. Signatures are kept only until you close the tab.
- **Other tools:** text (any size and colour), today's date, ✓ and ✗ marks, and white-out for covering existing content (type on top of it to replace words). Drag to move, drag the corner to resize, Del to remove, Ctrl+Z to undo.
- Everything is drawn into the PDF itself, including on rotated pages. Text uses the standard Helvetica font; characters it can't show (emoji, Chinese, etc.) are added as an image so they still appear.
- **This is not a certified digital signature.** The signature is a picture of your handwriting placed on the page, the same as signing a printout. Some contracts or government forms require a certificate-based digital signature from an approved provider instead.
- Samples: `Sample-D-Form.pdf` (a fillable form) and `Sample-E-Agreement.pdf` (a plain agreement with blank lines).

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

- **Double-click `index.html`** for the home screen. It works straight from disk, offline.
- **Serve the folder** with any static web server, e.g. `python3 -m http.server` and open <http://localhost:8000>.
- **Publish it with GitHub Pages:** repository *Settings → Pages → Deploy from a branch*, pick the branch and `/ (root)`.

## Project layout

```
index.html          Home screen
converter.html      Converter page
pdf.html            File combination page
brands/             Edition names, logos and colours
tools/build_editions.py  Builds each edition into dist/
css/styles.css      Shared styling and light/dark themes
css/pdf.css         File combination styling
js/theme.js         Applies the saved theme before the page paints
js/theme-toggle.js  Light/dark switch
js/dock.js          Floating tool switcher at the top of every page
collage.html        Collage maker page
css/collage.css     Collage maker styling
js/collage.js       Collage layouts, editing and export
js/pdf/combine.js   File combination logic
sign.html           Fill & sign page
css/sign.css        Fill & sign styling
js/pdf/sign.js      Fill & sign logic (form fields, field detection, signatures, saving)
samples/            Sample PDFs
editor.html         Editor page
css/editor.css      Editor styling
js/detect.js        Format detection from magic bytes, EXIF reader
js/decode.js        Image decoding shared by both apps
js/eps.js           EPS reader (embedded image / TIFF preview / EPSI preview)
js/encoders.js      Output encoders (BMP, TIFF, ICO, GIF, EPS, PDF and SVG are written by hand; the rest use the browser)
js/app.js           Converter UI, preview, resize/rotate pipeline, conversion
js/editor/filters.js  Adjustments engine (colour matrix, blur, sharpen, vignette)
js/editor/layers.js   Layer model, transforms, rendering
js/editor/brushes.js  Brush styles and the right-click brush menu
js/editor/editor.js   Editor UI, tools, selections, history, export
js/editor/toolbar.js  Tool groups and flyout menus
js/editor/inpaint.js  Object removal (PatchMatch image completion)
js/vendor/          Third-party libraries (see below)
```

## Third-party libraries

All bundled in `js/vendor/` and `fonts/` with their licence files. Every licence allows free use, including commercial use, as long as the licence notices are kept with the code.

| Library | Used for | Licence |
|---|---|---|
| [pdf.js](https://github.com/mozilla/pdf.js) 3.11 (Mozilla) | Showing PDF pages | Apache 2.0 |
| [pdf-lib](https://github.com/Hopding/pdf-lib) 1.17 | Building combined PDFs, filling forms, adding signatures | MIT |
| [UTIF.js](https://github.com/photopea/UTIF.js) 3.1 | Reading TIFF files | MIT |
| [pako](https://github.com/nodeca/pako) 1.0 | Deflate decompression for TIFF | MIT |
| Dancing Script, Great Vibes, Allura, Caveat (in `fonts/`) | Typed signature styles | SIL Open Font License 1.1 |
| [TweetNaCl.js](https://github.com/dchest/tweetnacl-js) 1.0 (Studiolo only) | Fingerprinting licence codes (SHA-512) | Public domain (Unlicense) |

Everything else (encoders, editor, object removal, EPS reader) is original code in this repository.

## Limitations

- **Raster to vector:** EPS, PDF and SVG output contain the original pixels. Turning a photo or logo into real vector paths (tracing) is a separate feature that could be added later.
- **Rendering EPS vector artwork** (rather than its preview) and opening PDF/PSD would need a much heavier engine (e.g. Ghostscript compiled to WebAssembly).
- **Animated GIF/WebP:** only the first frame is converted.
- **Size:** very large images are capped at 16,384 px per side in the converter and 8,192 px in the editor (browser canvas limits).
- **Editor projects** aren't saved between visits yet. Export your result before closing the tab (the page warns you).
- **Editor selections** limit Remove object, Delete, Fill and Copy to layer. Painting and filters still apply to the whole layer.
