/*
 * Collage Maker: photos in grid layouts with spacing, border, rounded corners and background.
 * Each cell shows its photo cropped to fill ("cover"); the user can pan and zoom inside a cell,
 * drag a photo onto another cell to swap them, and export at full resolution.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var MAX_PHOTO_SIDE = 4000; // keeps memory reasonable with phone photos
  var T = 1 / 3, TT = 2 / 3;

  // Cell rectangles as fractions of the area inside the border: [x, y, w, h].
  var LAYOUTS = [
    { name: 'Side by side', cells: [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]] },
    { name: 'Stacked', cells: [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]] },
    { name: 'Feature left', cells: [[0, 0, 0.62, 1], [0.62, 0, 0.38, 0.5], [0.62, 0.5, 0.38, 0.5]] },
    { name: 'Feature top', cells: [[0, 0, 1, 0.6], [0, 0.6, 0.5, 0.4], [0.5, 0.6, 0.5, 0.4]] },
    { name: 'Three columns', cells: [[0, 0, T, 1], [T, 0, T, 1], [TT, 0, T, 1]] },
    { name: 'Three rows', cells: [[0, 0, 1, T], [0, T, 1, T], [0, TT, 1, T]] },
    { name: 'Grid 2 × 2', cells: [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]] },
    { name: 'Feature + 3', cells: [[0, 0, 0.66, 1], [0.66, 0, 0.34, T], [0.66, T, 0.34, T], [0.66, TT, 0.34, T]] },
    { name: 'Banner + 3', cells: [[0, 0, 1, 0.58], [0, 0.58, T, 0.42], [T, 0.58, T, 0.42], [TT, 0.58, T, 0.42]] },
    { name: '2 + 3', cells: [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, T, 0.5], [T, 0.5, T, 0.5], [TT, 0.5, T, 0.5]] },
    { name: 'Feature + 4', cells: [[0, 0, 0.5, 1], [0.5, 0, 0.25, 0.5], [0.75, 0, 0.25, 0.5], [0.5, 0.5, 0.25, 0.5], [0.75, 0.5, 0.25, 0.5]] },
    { name: 'Grid 3 × 2', cells: [[0, 0, T, 0.5], [T, 0, T, 0.5], [TT, 0, T, 0.5], [0, 0.5, T, 0.5], [T, 0.5, T, 0.5], [TT, 0.5, T, 0.5]] },
    { name: 'Grid 2 × 3', cells: [[0, 0, 0.5, T], [0.5, 0, 0.5, T], [0, T, 0.5, T], [0.5, T, 0.5, T], [0, TT, 0.5, T], [0.5, TT, 0.5, T]] },
    { name: 'Mosaic', cells: [[0, 0, TT, TT], [TT, 0, T, T], [TT, T, T, T], [0, TT, T, T], [T, TT, T, T], [TT, TT, T, T]] },
    { name: 'Grid 4 × 2', cells: [[0, 0, 0.25, 0.5], [0.25, 0, 0.25, 0.5], [0.5, 0, 0.25, 0.5], [0.75, 0, 0.25, 0.5], [0, 0.5, 0.25, 0.5], [0.25, 0.5, 0.25, 0.5], [0.5, 0.5, 0.25, 0.5], [0.75, 0.5, 0.25, 0.5]] },
    { name: 'Grid 3 × 3', cells: [[0, 0, T, T], [T, 0, T, T], [TT, 0, T, T], [0, T, T, T], [T, T, T, T], [TT, T, T, T], [0, TT, T, T], [T, TT, T, T], [TT, TT, T, T]] }
  ];

  var state = {
    photos: [], // { id, name, source, w, h, thumb }
    layout: 6,
    cells: [], // { photo: id | null, zoom, ox, oy } per layout cell
    selected: -1,
    width: 1080,
    height: 1080,
    gap: 16,
    border: 16,
    radius: 12,
    background: '#ffffff',
    transparent: false,
    format: 'png',
    filter: 'all',
    nextId: 1
  };

  var canvas = $('collage');
  var ctx = canvas.getContext('2d');
  var view = { scale: 1 }; // preview pixels per output pixel

  /* ---------- helpers ---------- */

  var toastTimer;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  function photoById(id) {
    for (var i = 0; i < state.photos.length; i++) if (state.photos[i].id === id) return state.photos[i];
    return null;
  }

  function newCell(photo) { return { photo: photo || null, zoom: 1, ox: 0, oy: 0 }; }

  /* ---------- photos ---------- */

  function addFiles(files, intoCell) {
    files = Array.prototype.filter.call(files, function (f) { return /^image\//.test(f.type); });
    if (!files.length) { toast('Add image files (JPG, PNG, WebP…).'); return Promise.resolve(); }
    return Promise.all(files.map(loadPhoto)).then(function (photos) {
      photos = photos.filter(Boolean);
      photos.forEach(function (p) { state.photos.push(p); });
      if (intoCell !== undefined && photos.length) {
        state.cells[intoCell] = newCell(photos[0].id);
        photos = photos.slice(1);
      }
      fillEmptyCells();
      renderStrip();
      draw();
    });
  }

  function loadPhoto(file) {
    return createImageBitmap(file).then(function (bmp) {
      var k = Math.min(1, MAX_PHOTO_SIDE / Math.max(bmp.width, bmp.height));
      var c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k);
      c.height = Math.round(bmp.height * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
      var t = document.createElement('canvas');
      var tk = 120 / Math.max(c.width, c.height);
      t.width = Math.max(1, Math.round(c.width * tk));
      t.height = Math.max(1, Math.round(c.height * tk));
      t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
      return { id: state.nextId++, name: file.name, source: c, w: c.width, h: c.height, thumb: t.toDataURL('image/jpeg', 0.8) };
    }, function () {
      toast(file.name + ' can\'t be opened.');
      return null;
    });
  }

  function usedIds() {
    return state.cells.map(function (c) { return c.photo; }).filter(function (id) { return id !== null; });
  }

  function fillEmptyCells() {
    var used = usedIds();
    var free = state.photos.filter(function (p) { return used.indexOf(p.id) < 0; });
    state.cells.forEach(function (c, i) {
      if (c.photo === null && free.length) state.cells[i] = newCell(free.shift().id);
    });
  }

  function removePhoto(id) {
    state.photos = state.photos.filter(function (p) { return p.id !== id; });
    state.cells.forEach(function (c, i) { if (c.photo === id) state.cells[i] = newCell(null); });
    fillEmptyCells();
    renderStrip();
    draw();
  }

  function renderStrip() {
    var strip = $('photo-strip');
    strip.innerHTML = '';
    var used = usedIds();
    state.photos.forEach(function (p) {
      var item = document.createElement('div');
      item.className = 'strip-item' + (used.indexOf(p.id) >= 0 ? ' used' : '');
      item.draggable = true;
      item.title = p.name + (used.indexOf(p.id) >= 0 ? ' (in the collage)' : ' (drag onto a cell)');
      item.innerHTML = '<img alt=""><button type="button" class="strip-x" aria-label="Remove photo">×</button>';
      item.querySelector('img').src = p.thumb;
      item.querySelector('.strip-x').onclick = function () { removePhoto(p.id); };
      item.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/x-photo', String(p.id));
        e.dataTransfer.effectAllowed = 'copy';
      });
      strip.appendChild(item);
    });
    $('photo-actions').hidden = state.photos.length === 0;
  }

  /* ---------- layouts ---------- */

  function layoutMatches(l) {
    var n = l.cells.length;
    if (state.filter === 'all') return true;
    if (state.filter === '5') return n >= 5 && n <= 6;
    if (state.filter === '9') return n >= 7;
    return n === +state.filter;
  }

  function renderLayouts() {
    var grid = $('layout-grid');
    grid.innerHTML = '';
    LAYOUTS.forEach(function (l, i) {
      if (!layoutMatches(l)) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'layout-btn';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(i === state.layout));
      b.title = l.name + ' · ' + l.cells.length + ' photos';
      var svg = '<svg viewBox="0 0 40 40" aria-hidden="true">';
      l.cells.forEach(function (c) {
        svg += '<rect x="' + (c[0] * 36 + 2 + 1) + '" y="' + (c[1] * 36 + 2 + 1) + '" width="' + Math.max(1, c[2] * 36 - 2) + '" height="' + Math.max(1, c[3] * 36 - 2) + '" rx="1.5"/>';
      });
      b.innerHTML = svg + '</svg><span>' + l.cells.length + '</span>';
      b.onclick = function () { setLayout(i); };
      grid.appendChild(b);
    });
  }

  function setLayout(i) {
    var n = LAYOUTS[i].cells.length;
    var kept = state.cells.slice(0, n);
    while (kept.length < n) kept.push(newCell(null));
    state.layout = i;
    state.cells = kept;
    state.selected = -1;
    fillEmptyCells();
    renderLayouts();
    renderStrip();
    updateCellPanel();
    draw();
  }

  /* ---------- geometry & drawing ---------- */

  // Cell rectangles in output pixels, with spacing between neighbours but not at the outer edge.
  function cellRects(W, H) {
    var b = state.border, g = state.gap / 2, iw = W - b * 2, ih = H - b * 2;
    return LAYOUTS[state.layout].cells.map(function (c) {
      var x = b + c[0] * iw, y = b + c[1] * ih, w = c[2] * iw, h = c[3] * ih;
      var l = c[0] > 0.001 ? g : 0, t = c[1] > 0.001 ? g : 0;
      var r = c[0] + c[2] < 0.999 ? g : 0, bt = c[1] + c[3] < 0.999 ? g : 0;
      return { x: x + l, y: y + t, w: Math.max(1, w - l - r), h: Math.max(1, h - t - bt) };
    });
  }

  function roundRect(c, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  // Where a cell's photo is drawn (cover fit, then zoom and pan).
  function photoPlacement(cell, rect) {
    var p = photoById(cell.photo);
    if (!p) return null;
    var k = Math.max(rect.w / p.w, rect.h / p.h) * cell.zoom;
    var dw = p.w * k, dh = p.h * k;
    var x = rect.x + (rect.w - dw) / 2 + cell.ox * (dw - rect.w) / 2;
    var y = rect.y + (rect.h - dh) / 2 + cell.oy * (dh - rect.h) / 2;
    return { p: p, x: x, y: y, w: dw, h: dh };
  }

  function render(c, W, H, opts) {
    opts = opts || {};
    c.save();
    c.clearRect(0, 0, W, H);
    if (!state.transparent || opts.forceBackground) {
      c.fillStyle = state.transparent ? '#ffffff' : state.background;
      c.fillRect(0, 0, W, H);
    }
    c.imageSmoothingQuality = 'high';
    var rects = cellRects(W, H);
    rects.forEach(function (r, i) {
      var cell = state.cells[i];
      c.save();
      roundRect(c, r.x, r.y, r.w, r.h, state.radius);
      c.clip();
      var place = cell && photoPlacement(cell, r);
      if (place) {
        c.drawImage(place.p.source, place.x, place.y, place.w, place.h);
      } else if (opts.preview) {
        c.fillStyle = 'rgba(128, 128, 140, 0.18)';
        c.fillRect(r.x, r.y, r.w, r.h);
        c.fillStyle = 'rgba(128, 128, 140, 0.75)';
        c.font = '600 ' + Math.max(14, Math.min(r.w, r.h) * 0.12) + 'px system-ui, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('+ Add photo', r.x + r.w / 2, r.y + r.h / 2);
      }
      c.restore();
      if (opts.preview && (i === state.selected || i === opts.target)) {
        c.save();
        c.lineWidth = 3 / view.scale;
        c.strokeStyle = i === opts.target ? '#22c55e' : getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#5b4cf0';
        roundRect(c, r.x, r.y, r.w, r.h, state.radius);
        c.stroke();
        c.restore();
      }
    });
    c.restore();
  }

  var dragTarget = -1;
  function draw() {
    var stage = $('stage');
    var availW = stage.clientWidth - 32, availH = stage.clientHeight - 32;
    var k = Math.min(availW / state.width, availH / state.height);
    var dpr = window.devicePixelRatio || 1;
    var cssW = Math.max(1, Math.floor(state.width * k)), cssH = Math.max(1, Math.floor(state.height * k));
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    view.scale = (cssW * dpr) / state.width;
    view.css = cssW / state.width;
    ctx.setTransform(view.scale, 0, 0, view.scale, 0, 0);
    render(ctx, state.width, state.height, { preview: true, target: dragTarget });
    $('caption').textContent = state.width + ' × ' + state.height + ' px · ' + LAYOUTS[state.layout].name +
      ' · drag photos between cells to swap · drag inside a cell to reposition · scroll to zoom';
  }

  /* ---------- canvas interaction ---------- */

  function toOutput(e) {
    var r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / view.css, y: (e.clientY - r.top) / view.css };
  }

  function cellAt(pt) {
    var rects = cellRects(state.width, state.height);
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      if (pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h) return i;
    }
    return -1;
  }

  function selectCell(i) {
    state.selected = i;
    updateCellPanel();
    draw();
  }

  function updateCellPanel() {
    var cell = state.cells[state.selected];
    $('cell-panel').hidden = !(cell && cell.photo !== null);
    if (cell) {
      $('zoom').value = Math.round(cell.zoom * 100);
      $('zoom-out').textContent = Math.round(cell.zoom * 100) + '%';
    }
  }

  function bindCanvas() {
    var drag = null;
    canvas.addEventListener('pointerdown', function (e) {
      var pt = toOutput(e), i = cellAt(pt);
      if (i < 0) { selectCell(-1); return; }
      selectCell(i);
      if (state.cells[i].photo === null) { pickInto(i); return; }
      canvas.setPointerCapture(e.pointerId);
      drag = { cell: i, start: pt, ox: state.cells[i].ox, oy: state.cells[i].oy, moved: false };
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var pt = toOutput(e), over = cellAt(pt);
      drag.moved = true;
      if (over >= 0 && over !== drag.cell) { // dragging onto another cell: swap on release
        dragTarget = over;
        canvas.style.cursor = 'copy';
      } else {
        dragTarget = -1;
        canvas.style.cursor = 'grabbing';
        var cell = state.cells[drag.cell], r = cellRects(state.width, state.height)[drag.cell];
        var place = photoPlacement(cell, r);
        var spareX = place.w - r.w, spareY = place.h - r.h;
        cell.ox = spareX > 0.5 ? Math.max(-1, Math.min(1, drag.ox + ((pt.x - drag.start.x) * 2) / spareX)) : 0;
        cell.oy = spareY > 0.5 ? Math.max(-1, Math.min(1, drag.oy + ((pt.y - drag.start.y) * 2) / spareY)) : 0;
      }
      draw();
    });
    var end = function () {
      if (!drag) return;
      if (dragTarget >= 0) {
        var a = state.cells[drag.cell], b = state.cells[dragTarget];
        state.cells[drag.cell] = b;
        state.cells[dragTarget] = a;
        state.selected = dragTarget;
        updateCellPanel();
      }
      dragTarget = -1;
      drag = null;
      canvas.style.cursor = '';
      draw();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', function (e) {
      var i = cellAt(toOutput(e));
      if (i < 0 || state.cells[i].photo === null) return;
      e.preventDefault();
      var cell = state.cells[i];
      cell.zoom = Math.max(1, Math.min(4, cell.zoom * Math.exp(-e.deltaY * 0.0015)));
      if (state.selected !== i) state.selected = i;
      updateCellPanel();
      draw();
    }, { passive: false });

    // Photos dragged from the strip, or files dropped straight onto a cell.
    canvas.addEventListener('dragover', function (e) {
      e.preventDefault();
      var i = cellAt(toOutput(e));
      if (i !== dragTarget) { dragTarget = i; draw(); }
    });
    canvas.addEventListener('dragleave', function () { dragTarget = -1; draw(); });
    canvas.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var i = cellAt(toOutput(e));
      dragTarget = -1;
      var id = +e.dataTransfer.getData('text/x-photo');
      if (i >= 0 && id) {
        state.cells.forEach(function (c, j) { if (c.photo === id && j !== i) state.cells[j] = newCell(null); });
        state.cells[i] = newCell(id);
        fillEmptyCells();
        renderStrip();
        selectCell(i);
      } else if (e.dataTransfer.files.length) {
        addFiles(e.dataTransfer.files, i >= 0 ? i : undefined);
      } else {
        draw();
      }
    });
  }

  var pickTarget = -1;
  function pickInto(i) {
    pickTarget = i;
    $('cell-input').click();
  }

  /* ---------- export ---------- */

  function renderFormats() {
    var grid = $('formats');
    grid.innerHTML = '';
    ['png', 'jpeg', 'webp', 'pdf'].forEach(function (id) {
      var o = Encoders.get(id);
      if (!o || !o.supported) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'format-btn';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(id === state.format));
      b.textContent = o.label;
      b.onclick = function () { state.format = id; renderFormats(); };
      grid.appendChild(b);
    });
    $('quality-field').hidden = !Encoders.get(state.format).lossy;
  }

  function exportCollage() {
    if (!state.cells.some(function (c) { return c.photo !== null; })) { toast('Add some photos first.'); return; }
    var out = Encoders.get(state.format);
    var c = document.createElement('canvas');
    c.width = state.width;
    c.height = state.height;
    render(c.getContext('2d', { willReadFrequently: true }), state.width, state.height, { forceBackground: !out.alpha });
    var name = ($('out-name').value.trim() || 'collage').replace(/[\\/:*?"<>|]+/g, '-') + '.' + out.ext;
    var dpi = /2480x3508|3600x2400/.test($('size-preset').value) ? (state.width === 3600 ? 600 : 300) : 72;
    $('status').textContent = 'Exporting…';
    Encoders.encode(state.format, c, { quality: +$('quality').value / 100, dpi: dpi, title: name }).then(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 15000);
      $('status').textContent = 'Saved ' + name + ' · ' + state.width + ' × ' + state.height + ' px · ' +
        (blob.size > 1048576 ? (blob.size / 1048576).toFixed(1) + ' MB' : Math.round(blob.size / 1024) + ' KB');
    }, function (err) {
      $('status').textContent = 'Export failed: ' + err.message;
    });
  }

  /* ---------- wiring ---------- */

  function bind() {
    var input = $('file-input');
    input.onchange = function () { addFiles(input.files); input.value = ''; };
    $('dropzone').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    $('cell-input').onchange = function () {
      var f = this.files;
      if (f.length && pickTarget >= 0) addFiles(f, pickTarget).then(function () { selectCell(pickTarget); });
      this.value = '';
    };
    document.addEventListener('dragover', function (e) { if (e.dataTransfer.types.indexOf('Files') >= 0) e.preventDefault(); });
    document.addEventListener('drop', function (e) {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      addFiles(e.dataTransfer.files);
    });
    document.addEventListener('paste', function (e) {
      var files = Array.prototype.filter.call(e.clipboardData.files || [], function (f) { return /^image\//.test(f.type); });
      if (files.length) addFiles(files);
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-count]'), function (b) {
      b.onclick = function () {
        state.filter = b.dataset.count;
        Array.prototype.forEach.call(document.querySelectorAll('[data-count]'), function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        renderLayouts();
      };
    });
    $('shuffle').onclick = function () {
      var ids = state.photos.map(function (p) { return p.id; });
      for (var i = ids.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = ids[i]; ids[i] = ids[j]; ids[j] = t; }
      state.cells = state.cells.map(function (c, i) { return newCell(ids[i] !== undefined ? ids[i] : null); });
      renderStrip();
      draw();
    };
    $('clear-photos').onclick = function () {
      state.photos = [];
      state.cells = state.cells.map(function () { return newCell(null); });
      state.selected = -1;
      renderStrip();
      updateCellPanel();
      draw();
    };

    $('size-preset').onchange = function () {
      $('custom-size').hidden = this.value !== 'custom';
      applySize();
    };
    $('custom-w').oninput = $('custom-h').oninput = applySize;
    function bindRange(id, key) {
      $(id).oninput = function () { state[key] = +this.value; $(id + '-out').textContent = this.value; draw(); };
    }
    bindRange('gap', 'gap');
    bindRange('border', 'border');
    bindRange('radius', 'radius');
    $('bg').oninput = function () { state.background = this.value; draw(); };
    $('bg-none').onchange = function () { state.transparent = this.checked; $('bg').disabled = this.checked; draw(); };

    $('zoom').oninput = function () {
      var cell = state.cells[state.selected];
      if (!cell) return;
      cell.zoom = +this.value / 100;
      $('zoom-out').textContent = this.value + '%';
      draw();
    };
    $('cell-center').onclick = function () {
      var cell = state.cells[state.selected];
      if (cell) { cell.ox = 0; cell.oy = 0; cell.zoom = 1; updateCellPanel(); draw(); }
    };
    $('cell-replace').onclick = function () { if (state.selected >= 0) pickInto(state.selected); };
    $('cell-clear').onclick = function () {
      if (state.selected < 0) return;
      state.cells[state.selected] = newCell(null);
      renderStrip();
      updateCellPanel();
      draw();
    };

    $('quality').oninput = function () { $('quality-out').textContent = this.value; };
    $('export').onclick = exportCollage;
    window.addEventListener('resize', function () { clearTimeout(bind.t); bind.t = setTimeout(draw, 80); });
    document.addEventListener('keydown', function (e) {
      if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected >= 0) $('cell-clear').onclick();
      if (e.key === 'Escape') selectCell(-1);
    });
  }

  function applySize() {
    var v = $('size-preset').value;
    var wh = v === 'custom' ? [+$('custom-w').value || 2000, +$('custom-h').value || 2000] : v.split('x').map(Number);
    state.width = Math.max(100, Math.min(8000, wh[0]));
    state.height = Math.max(100, Math.min(8000, wh[1]));
    draw();
  }

  bind();
  bindCanvas();
  renderLayouts();
  setLayout(6);
  renderFormats();
})();
