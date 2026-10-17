/*
 * Image Editor: canvas view, tools, layers panel, adjustments, history and export.
 */
(function () {
  'use strict';

  var MAX_DOC = 8192;
  var HISTORY_LIMIT = 60;
  var HANDLE = 6; // half-size of a resize handle, CSS px
  var ROTATE_OFFSET = 28;

  var $ = function (id) { return document.getElementById(id); };
  var view = $('view');
  var wrap = $('stage-wrap');
  var vctx = view.getContext('2d');
  var comp = document.createElement('canvas');
  var cctx = comp.getContext('2d');

  var state = {
    doc: null, // { w, h, background: '#rrggbb' | null }
    layers: [], // bottom → top
    selectedId: null,
    tool: 'move',
    zoom: 1,
    panX: 0,
    panY: 0,
    color: '#e11d48',
    secondary: '#ffffff',
    brush: { size: 24, opacity: 1, soft: 0 },
    sprayDensity: 40,
    tolerance: 32,
    contiguous: true,
    gradientType: 'linear',
    gradientEnd: 'secondary',
    lineWeight: 8,
    starPoints: 5,
    editing: null, // text layer being typed into on the canvas
    crop: null,
    op: null, // active pointer operation
    hover: null, // pointer position in document coords
    spaceDown: false,
    history: [],
    hIndex: -1,
    exportFormat: 'png'
  };

  var ADJUSTMENTS = [
    ['brightness', 'Brightness', -100, 100],
    ['contrast', 'Contrast', -100, 100],
    ['saturation', 'Saturation', -100, 100],
    ['hue', 'Hue', -180, 180],
    ['temperature', 'Temperature', -100, 100],
    ['grayscale', 'Grayscale', 0, 100],
    ['sepia', 'Sepia', 0, 100],
    ['invert', 'Invert', 0, 100],
    ['blur', 'Blur', 0, 50],
    ['sharpen', 'Sharpen', 0, 100],
    ['vignette', 'Vignette', 0, 100]
  ];

  /* ---------- small helpers ---------- */

  function dpr() { return window.devicePixelRatio || 1; }

  function selected() {
    for (var i = 0; i < state.layers.length; i++) if (state.layers[i].id === state.selectedId) return state.layers[i];
    return null;
  }

  function newCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  var toastTimer;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  function isTyping(el) {
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
  }

  function round(n) { return Math.round(n); }

  /* ---------- view & coordinates ---------- */

  function resizeView() {
    var w = wrap.clientWidth, h = wrap.clientHeight, r = dpr();
    view.width = comp.width = Math.max(1, Math.round(w * r));
    view.height = comp.height = Math.max(1, Math.round(h * r));
    view.style.width = w + 'px';
    view.style.height = h + 'px';
    requestRender();
  }

  function toDoc(e) {
    var rect = view.getBoundingClientRect();
    return { x: (e.clientX - rect.left - state.panX) / state.zoom, y: (e.clientY - rect.top - state.panY) / state.zoom };
  }

  function toScreen(p) {
    return { x: p.x * state.zoom + state.panX, y: p.y * state.zoom + state.panY };
  }

  function fit() {
    if (!state.doc) return;
    var w = wrap.clientWidth, h = wrap.clientHeight;
    state.zoom = Math.min(1, (w - 48) / state.doc.w, (h - 48) / state.doc.h);
    state.zoom = Math.max(0.01, state.zoom);
    state.panX = (w - state.doc.w * state.zoom) / 2;
    state.panY = (h - state.doc.h * state.zoom) / 2;
    updateZoomLabel();
    requestRender();
  }

  function zoomAt(factor, cx, cy) {
    if (!state.doc) return;
    if (cx === undefined) { cx = wrap.clientWidth / 2; cy = wrap.clientHeight / 2; }
    var z = Math.min(32, Math.max(0.01, state.zoom * factor));
    var dx = (cx - state.panX) / state.zoom, dy = (cy - state.panY) / state.zoom;
    state.zoom = z;
    state.panX = cx - dx * z;
    state.panY = cy - dy * z;
    updateZoomLabel();
    requestRender();
  }

  function updateZoomLabel() {
    $('zoom-label').textContent = Math.round(state.zoom * 100) + '%';
  }

  /* ---------- rendering ---------- */

  var checker = (function () {
    var c = newCanvas(16, 16), x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 16, 16);
    x.fillStyle = '#d9dce3'; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8);
    return vctx.createPattern(c, 'repeat');
  })();

  var renderQueued = false;
  function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () {
      renderQueued = false;
      render();
    });
  }

  function render() {
    var W = view.width, H = view.height, r = dpr();
    vctx.setTransform(1, 0, 0, 1, 0, 0);
    vctx.clearRect(0, 0, W, H);
    var doc = state.doc;
    if (!doc) return;
    var z = state.zoom * r, ox = state.panX * r, oy = state.panY * r;

    vctx.save();
    vctx.shadowColor = 'rgba(0,0,0,0.3)';
    vctx.shadowBlur = 18 * r;
    vctx.fillStyle = doc.background ? doc.background : checker;
    vctx.fillRect(ox, oy, doc.w * z, doc.h * z);
    vctx.restore();

    // Composite layers on their own canvas so blend modes only mix with the document.
    cctx.setTransform(1, 0, 0, 1, 0, 0);
    cctx.clearRect(0, 0, W, H);
    cctx.setTransform(z, 0, 0, z, ox, oy);
    cctx.save();
    cctx.beginPath();
    cctx.rect(0, 0, doc.w, doc.h);
    cctx.clip();
    if (doc.background) {
      cctx.fillStyle = doc.background;
      cctx.fillRect(0, 0, doc.w, doc.h);
    }
    var hidden = state.editing && state.editing.hide ? state.editing.layer : null;
    state.layers.forEach(function (l) { if (l !== hidden) Layers.draw(cctx, l); });
    cctx.restore();
    vctx.drawImage(comp, 0, 0);

    vctx.setTransform(r, 0, 0, r, 0, 0);
    drawOverlay();
    updateTextEditor();
  }

  function selectionGeometry(l) {
    var pts = Layers.corners(l).map(toScreen);
    var cx = (pts[0].x + pts[2].x) / 2, cy = (pts[0].y + pts[2].y) / 2;
    var top = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    var dx = top.x - cx, dy = top.y - cy, len = Math.hypot(dx, dy) || 1;
    var rot = { x: top.x + (dx / len) * ROTATE_OFFSET, y: top.y + (dy / len) * ROTATE_OFFSET };
    return { pts: pts, top: top, rot: rot, center: { x: cx, y: cy } };
  }

  function drawOverlay() {
    var accent = '#4f46e5';
    var l = selected();
    var showBox = state.tool === 'move' || state.tool === 'text' || state.tool === 'text-vertical' || SHAPE_TOOLS.indexOf(state.tool) >= 0;
    if (l && showBox && !state.editing) {
      var g = selectionGeometry(l);
      vctx.lineWidth = 1;
      vctx.strokeStyle = accent;
      vctx.beginPath();
      g.pts.forEach(function (p, i) { if (i) vctx.lineTo(p.x, p.y); else vctx.moveTo(p.x, p.y); });
      vctx.closePath();
      vctx.stroke();
      if (state.tool === 'move') {
        vctx.beginPath();
        vctx.moveTo(g.top.x, g.top.y);
        vctx.lineTo(g.rot.x, g.rot.y);
        vctx.stroke();
        vctx.fillStyle = '#ffffff';
        g.pts.forEach(function (p) {
          vctx.fillRect(p.x - HANDLE, p.y - HANDLE, HANDLE * 2, HANDLE * 2);
          vctx.strokeRect(p.x - HANDLE + 0.5, p.y - HANDLE + 0.5, HANDLE * 2 - 1, HANDLE * 2 - 1);
        });
        vctx.beginPath();
        vctx.arc(g.rot.x, g.rot.y, HANDLE, 0, Math.PI * 2);
        vctx.fill();
        vctx.stroke();
      }
    }

    if (state.tool === 'crop' && state.crop) {
      var a = toScreen({ x: state.crop.x, y: state.crop.y });
      var w = state.crop.w * state.zoom, h = state.crop.h * state.zoom;
      vctx.fillStyle = 'rgba(0,0,0,0.55)';
      vctx.beginPath();
      vctx.rect(0, 0, wrap.clientWidth, wrap.clientHeight);
      vctx.rect(a.x, a.y, w, h);
      vctx.fill('evenodd');
      vctx.strokeStyle = '#ffffff';
      vctx.lineWidth = 1;
      vctx.strokeRect(a.x + 0.5, a.y + 0.5, w - 1, h - 1);
      vctx.strokeStyle = 'rgba(255,255,255,0.45)';
      vctx.beginPath();
      for (var i = 1; i < 3; i++) {
        vctx.moveTo(a.x + (w * i) / 3, a.y); vctx.lineTo(a.x + (w * i) / 3, a.y + h);
        vctx.moveTo(a.x, a.y + (h * i) / 3); vctx.lineTo(a.x + w, a.y + (h * i) / 3);
      }
      vctx.stroke();
    }

    var op = state.op;
    if (op && op.type === 'gradient' && op.p1) {
      var g0 = toScreen(op.p0), g1 = toScreen(op.p1);
      vctx.lineWidth = 1.5;
      vctx.strokeStyle = '#ffffff';
      vctx.beginPath(); vctx.moveTo(g0.x, g0.y); vctx.lineTo(g1.x, g1.y); vctx.stroke();
      vctx.fillStyle = accent;
      [g0, g1].forEach(function (pt) { vctx.beginPath(); vctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2); vctx.fill(); vctx.stroke(); });
    }

    if (PAINT_TOOLS.indexOf(state.tool) >= 0 && state.hover && !state.spaceDown) {
      var c = toScreen(state.hover);
      var rad = Math.max(1, (state.brush.size / 2) * state.zoom);
      vctx.lineWidth = 1;
      vctx.strokeStyle = 'rgba(0,0,0,0.7)';
      vctx.beginPath(); vctx.arc(c.x, c.y, rad, 0, Math.PI * 2); vctx.stroke();
      vctx.strokeStyle = 'rgba(255,255,255,0.9)';
      vctx.beginPath(); vctx.arc(c.x, c.y, rad + 1, 0, Math.PI * 2); vctx.stroke();
    }
  }

  /* ---------- history ---------- */

  function snapshot() {
    var d = state.doc;
    return {
      doc: d ? { w: d.w, h: d.h, background: d.background } : null,
      layers: state.layers.map(Layers.clone),
      selectedId: state.selectedId
    };
  }

  function commit() {
    state.history = state.history.slice(0, state.hIndex + 1);
    state.history.push(snapshot());
    if (state.history.length > HISTORY_LIMIT) state.history.shift();
    state.hIndex = state.history.length - 1;
    refreshPanels();
  }

  function restore(snap) {
    state.doc = snap.doc ? { w: snap.doc.w, h: snap.doc.h, background: snap.doc.background } : null;
    state.layers = snap.layers.map(Layers.clone);
    state.selectedId = snap.selectedId;
    refreshPanels();
    requestRender();
  }

  function undo() {
    if (state.hIndex <= 0) return;
    state.hIndex--;
    restore(state.history[state.hIndex]);
  }

  function redo() {
    if (state.hIndex >= state.history.length - 1) return;
    state.hIndex++;
    restore(state.history[state.hIndex]);
  }

  /* ---------- document & layers ---------- */

  function newDocument(w, h, background) {
    state.doc = { w: Math.min(MAX_DOC, Math.max(1, round(w))), h: Math.min(MAX_DOC, Math.max(1, round(h))), background: background };
    state.layers = [];
    state.selectedId = null;
    state.crop = null;
    state.history = [];
    state.hIndex = -1;
    $('start-screen').hidden = true;
    commit();
    fit();
  }

  function addLayer(l, select) {
    var sel = selected();
    var idx = sel ? state.layers.indexOf(sel) + 1 : state.layers.length;
    state.layers.splice(idx, 0, l);
    if (select !== false) state.selectedId = l.id;
  }

  function select(l) {
    if (state.editing && state.editing.layer !== l) finishTextEdit();
    state.selectedId = l ? l.id : null;
    refreshPanels();
    requestRender();
  }

  function topmostAt(p) {
    for (var i = state.layers.length - 1; i >= 0; i--) {
      if (Layers.hitTest(state.layers[i], p.x, p.y)) return state.layers[i];
    }
    return null;
  }

  function sourceToCanvas(img) {
    var c = newCanvas(img.width, img.height);
    c.getContext('2d').drawImage(img.source, 0, 0, img.width, img.height);
    if (img.source.close) img.source.close();
    if (img.url) URL.revokeObjectURL(img.url);
    return c;
  }

  function loadFiles(files, asNewDocument) {
    files = Array.prototype.filter.call(files, function (f) { return f; });
    if (!files.length) return;
    toast('Opening ' + files.length + ' image' + (files.length > 1 ? 's' : '') + '…');
    Promise.all(files.map(function (f) {
      return ImageDecode.load(f).then(function (img) {
        return { name: f.name || 'Pasted image', canvas: sourceToCanvas(img), note: img.note };
      }, function (err) {
        toast((f.name || 'File') + ': ' + err.message);
        return null;
      });
    })).then(function (loaded) {
      loaded = loaded.filter(Boolean);
      if (!loaded.length) return;
      if (asNewDocument || !state.doc) {
        var first = loaded[0].canvas;
        var k = Math.min(1, MAX_DOC / Math.max(first.width, first.height));
        newDocument(first.width * k, first.height * k, null);
      }
      loaded.forEach(function (item, i) {
        var name = item.name.replace(/\.[^.]+$/, '') || 'Image';
        var l = Layers.createImage(name, item.canvas, state.doc.w / 2, state.doc.h / 2);
        var k = Math.min(1, state.doc.w / item.canvas.width, state.doc.h / item.canvas.height);
        l.scaleX = l.scaleY = k;
        addLayer(l);
        if (i === 0 && state.layers.length === 1) $('exp-name').value = name;
      });
      commit();
      requestRender();
      var notes = loaded.filter(function (item) { return item.note; });
      if (notes.length) toast(notes[0].name + ': ' + notes[0].note);
      else toast(loaded.length === 1 ? 'Added "' + loaded[0].name + '"' : 'Added ' + loaded.length + ' images as layers');
    });
  }

  function deleteLayer(l) {
    if (!l) return;
    var idx = state.layers.indexOf(l);
    state.layers.splice(idx, 1);
    var next = state.layers[Math.min(idx, state.layers.length - 1)];
    state.selectedId = next ? next.id : null;
    commit();
    requestRender();
  }

  function moveLayer(l, delta) {
    var i = state.layers.indexOf(l), j = i + delta;
    if (!l || j < 0 || j >= state.layers.length) return;
    state.layers.splice(i, 1);
    state.layers.splice(j, 0, l);
    commit();
    requestRender();
  }

  function duplicateLayer(l) {
    if (!l) return;
    var c = Layers.duplicate(l);
    c.x += 20;
    c.y += 20;
    addLayer(c);
    commit();
    requestRender();
  }

  function rasterize(l) {
    if (l.type === 'image') return;
    var src = Layers.content(l);
    var c = newCanvas(src.width, src.height);
    c.getContext('2d').drawImage(src, 0, 0);
    l.type = 'image';
    l.canvas = c;
    l.rev++;
  }

  function mergeDown(l) {
    var i = state.layers.indexOf(l);
    if (!l || i <= 0) { toast('There is no layer below to merge into.'); return; }
    var below = state.layers[i - 1];
    var merged = Layers.createImage(below.name, Layers.flatten(state.doc, [below, l], null), state.doc.w / 2, state.doc.h / 2);
    state.layers.splice(i - 1, 2, merged);
    state.selectedId = merged.id;
    commit();
    requestRender();
  }

  function flattenAll() {
    if (!state.layers.length) return;
    var flat = Layers.createImage('Flattened', Layers.flatten(state.doc, state.layers, null), state.doc.w / 2, state.doc.h / 2);
    state.layers = [flat];
    state.selectedId = flat.id;
    commit();
    requestRender();
  }

  /* ---------- layer geometry helpers (panel values) ---------- */

  function displaySize(l) {
    var s = Layers.size(l);
    return { w: s.w * Math.abs(l.scaleX), h: s.h * Math.abs(l.scaleY) };
  }

  function bounds(l) {
    var pts = Layers.corners(l);
    var xs = pts.map(function (p) { return p.x; }), ys = pts.map(function (p) { return p.y; });
    return { x: Math.min.apply(null, xs), y: Math.min.apply(null, ys), r: Math.max.apply(null, xs), b: Math.max.apply(null, ys) };
  }

  // Resizes a layer to a displayed width/height (text scales its font, shapes their box).
  function setDisplaySize(l, w, h) {
    var cur = displaySize(l);
    w = Math.max(1, w);
    h = Math.max(1, h);
    if (l.type === 'text') {
      var k = Math.abs(w - cur.w) > 0.5 ? w / cur.w : h / cur.h;
      l.fontSize = Math.max(4, Math.round(l.fontSize * k));
    } else if (l.type === 'shape') {
      l.w = w / Math.abs(l.scaleX);
      l.h = h / Math.abs(l.scaleY);
    } else {
      var s = Layers.size(l);
      l.scaleX = (l.scaleX < 0 ? -1 : 1) * (w / s.w);
      l.scaleY = (l.scaleY < 0 ? -1 : 1) * (h / s.h);
    }
  }

  /* ---------- pointer tools ---------- */

  function handleAt(l, e) {
    var rect = view.getBoundingClientRect();
    var p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    var g = selectionGeometry(l);
    if (Math.hypot(p.x - g.rot.x, p.y - g.rot.y) <= HANDLE + 4) return { type: 'rotate' };
    for (var i = 0; i < 4; i++) {
      if (Math.abs(p.x - g.pts[i].x) <= HANDLE + 3 && Math.abs(p.y - g.pts[i].y) <= HANDLE + 3) return { type: 'scale', index: i };
    }
    return null;
  }

  function transformState(l) {
    return { x: l.x, y: l.y, scaleX: l.scaleX, scaleY: l.scaleY, rotation: l.rotation, fontSize: l.fontSize, w: l.w, h: l.h };
  }

  var SHAPE_TOOLS = ['rect', 'ellipse', 'line', 'triangle', 'star'];
  var PAINT_TOOLS = ['brush', 'pencil', 'spray', 'eraser'];

  function onPointerDown(e) {
    if (!state.doc || state.op) return;
    if (e.button === 2) return;
    var tool = state.tool;
    // Clicking the canvas while typing finishes the text (and doesn't start a new one).
    if (state.editing) {
      finishTextEdit();
      if (tool === 'text' || tool === 'text-vertical') return;
    }
    view.setPointerCapture(e.pointerId);
    var p = toDoc(e);

    if (e.button === 1 || state.spaceDown || tool === 'hand') {
      state.op = { type: 'pan', sx: e.clientX, sy: e.clientY, px: state.panX, py: state.panY };
      wrap.classList.add('panning');
      return;
    }

    if (tool === 'move') {
      var l = selected();
      var h = l ? handleAt(l, e) : null;
      if (h) {
        state.op = { type: h.type, layer: l, p0: p, start: transformState(l) };
        return;
      }
      var hit = topmostAt(p);
      if (hit) {
        if (hit !== l) select(hit);
        state.op = { type: 'move', layer: hit, p0: p, start: transformState(hit) };
      } else {
        select(null);
      }
    } else if (PAINT_TOOLS.indexOf(tool) >= 0) {
      startPaint(p, tool);
    } else if (tool === 'bucket' || tool === 'magic-eraser') {
      floodAt(p, tool === 'magic-eraser');
    } else if (tool === 'gradient') {
      startGradient(p);
    } else if (tool === 'text' || tool === 'text-vertical') {
      e.preventDefault(); // otherwise the click moves focus away from the text box we open
      var t = textLayerAt(p);
      if (t) startTextEdit(t, false);
      else createTextAt(p, tool === 'text-vertical');
    } else if (SHAPE_TOOLS.indexOf(tool) >= 0) {
      state.op = { type: 'shape', kind: tool, p0: p, layer: null };
    } else if (tool === 'crop') {
      state.op = { type: 'crop', p0: p };
    } else if (tool === 'eyedropper') {
      pickColor(p, e.altKey);
    } else if (tool === 'zoom') {
      var rect = view.getBoundingClientRect();
      zoomAt(e.altKey ? 1 / 1.5 : 1.5, e.clientX - rect.left, e.clientY - rect.top);
    }
  }

  function onPointerMove(e) {
    var p = state.doc ? toDoc(e) : null;
    if (PAINT_TOOLS.indexOf(state.tool) >= 0) {
      state.hover = p;
      requestRender();
    }
    var op = state.op;
    if (!op) return;
    var l = op.layer;

    if (op.type === 'pan') {
      state.panX = op.px + e.clientX - op.sx;
      state.panY = op.py + e.clientY - op.sy;
      requestRender();
    } else if (op.type === 'move') {
      var nx = op.start.x + p.x - op.p0.x, ny = op.start.y + p.y - op.p0.y;
      // Snap the layer centre to the canvas centre lines.
      var snap = 6 / state.zoom;
      if (Math.abs(nx - state.doc.w / 2) < snap) nx = state.doc.w / 2;
      if (Math.abs(ny - state.doc.h / 2) < snap) ny = state.doc.h / 2;
      l.x = nx;
      l.y = ny;
      op.changed = true;
      requestRender();
    } else if (op.type === 'scale') {
      var a = (-l.rotation * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
      var vx = p.x - op.start.x, vy = p.y - op.start.y;
      var ux = op.p0.x - op.start.x, uy = op.p0.y - op.start.y;
      var lx = vx * cos - vy * sin, ly = vx * sin + vy * cos;
      var l0x = ux * cos - uy * sin, l0y = ux * sin + uy * cos;
      var k = Math.hypot(lx, ly) / (Math.hypot(l0x, l0y) || 1);
      var kx = Math.abs(l0x) > 1e-6 ? Math.abs(lx / l0x) : k;
      var ky = Math.abs(l0y) > 1e-6 ? Math.abs(ly / l0y) : k;
      var free = e.shiftKey && l.type !== 'text';
      if (!free) { kx = k; ky = k; }
      kx = Math.max(kx, 0.01);
      ky = Math.max(ky, 0.01);
      if (l.type === 'text') l.fontSize = Math.max(4, Math.round(op.start.fontSize * k));
      else if (l.type === 'shape') { l.w = Math.max(1, op.start.w * kx); l.h = Math.max(1, op.start.h * ky); }
      else { l.scaleX = op.start.scaleX * kx; l.scaleY = op.start.scaleY * ky; }
      op.changed = true;
      requestRender();
      renderProps();
    } else if (op.type === 'rotate') {
      var ang = function (q) { return (Math.atan2(q.y - op.start.y, q.x - op.start.x) * 180) / Math.PI; };
      var rot = op.start.rotation + ang(p) - ang(op.p0);
      if (e.shiftKey) rot = Math.round(rot / 15) * 15;
      rot = ((((rot + 180) % 360) + 360) % 360) - 180;
      l.rotation = rot;
      op.changed = true;
      requestRender();
      renderProps();
    } else if (op.type === 'paint') {
      paintTo(p);
    } else if (op.type === 'gradient') {
      op.p1 = p;
      drawGradient(op);
    } else if (op.type === 'shape') {
      dragShape(op, p, e.shiftKey);
    } else if (op.type === 'crop') {
      var x0 = Math.max(0, Math.min(op.p0.x, p.x)), y0 = Math.max(0, Math.min(op.p0.y, p.y));
      var x1 = Math.min(state.doc.w, Math.max(op.p0.x, p.x)), y1 = Math.min(state.doc.h, Math.max(op.p0.y, p.y));
      state.crop = { x: round(x0), y: round(y0), w: round(x1 - x0), h: round(y1 - y0) };
      updateCropUi();
      requestRender();
    }
  }

  function onPointerUp() {
    var op = state.op;
    if (!op) return;
    state.op = null;
    wrap.classList.remove('panning');
    if ((op.type === 'move' || op.type === 'scale' || op.type === 'rotate') && op.changed) commit();
    else if (op.type === 'paint') endPaint(op);
    else if (op.type === 'gradient') endGradient(op);
    else if (op.type === 'shape' && op.layer) commit();
    requestRender();
  }

  /* ---- shapes ---- */

  function dragShape(op, p, shift) {
    var dx = p.x - op.p0.x, dy = p.y - op.p0.y;
    if (!op.layer) {
      if (Math.hypot(dx, dy) * state.zoom < 3) return;
      op.layer = Layers.createShape(op.kind, op.p0.x, op.p0.y, 1, 1, { fill: state.color, points: state.starPoints });
      addLayer(op.layer);
    }
    var l = op.layer;
    if (op.kind === 'line') {
      var angle = Math.atan2(dy, dx), len = Math.hypot(dx, dy);
      if (shift) angle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
      l.w = Math.max(1, len);
      l.h = state.lineWeight;
      l.rotation = (angle * 180) / Math.PI;
      l.x = op.p0.x + (Math.cos(angle) * len) / 2;
      l.y = op.p0.y + (Math.sin(angle) * len) / 2;
    } else {
      if (shift) {
        var m = Math.max(Math.abs(dx), Math.abs(dy));
        dx = (dx < 0 ? -1 : 1) * m;
        dy = (dy < 0 ? -1 : 1) * m;
      }
      l.w = Math.max(1, Math.abs(dx));
      l.h = Math.max(1, Math.abs(dy));
      l.x = op.p0.x + dx / 2;
      l.y = op.p0.y + dy / 2;
    }
    requestRender();
  }

  /* ---- painting target ---- */

  // The layer a pixel tool works on. Brush-like tools start a new layer when nothing paintable is selected.
  function paintTarget(createIfMissing, name) {
    var l = selected();
    if (l && l.type !== 'image') {
      if (createIfMissing) l = null;
      else if (window.confirm('This tool works on pixels. Convert "' + l.name + '" to a pixel layer?')) rasterize(l);
      else return null;
    }
    if (!l || (createIfMissing && !l.visible)) {
      if (!createIfMissing) { toast('Select a layer first.'); return null; }
      l = Layers.createEmpty(name, state.doc.w, state.doc.h, state.doc.w / 2, state.doc.h / 2);
      addLayer(l);
      refreshPanels();
      return { layer: l, created: true };
    }
    return { layer: l, created: false };
  }

  /* ---- brush, pencil, spray & eraser ---- */

  function startPaint(p, tool) {
    var erase = tool === 'eraser';
    var target = paintTarget(!erase, 'Paint');
    if (!target) return;
    var l = target.layer;
    var base = l.canvas;
    var work = newCanvas(base.width, base.height);
    work.getContext('2d').drawImage(base, 0, 0);
    l.canvas = work;
    var scale = (Math.abs(l.scaleX) + Math.abs(l.scaleY)) / 2;
    var op = {
      type: 'paint',
      tool: tool,
      layer: l,
      base: base,
      work: work,
      stroke: newCanvas(base.width, base.height),
      inv: Layers.matrix(l).inverse(),
      width: state.brush.size / scale,
      erase: erase,
      last: null
    };
    state.op = op;
    paintTo(p);
    if (tool === 'spray') {
      // Keep spraying while the pointer is held still.
      op.timer = setInterval(function () {
        if (state.op !== op) return clearInterval(op.timer);
        sprayAt(op, op.last);
        composeStroke(op);
      }, 40);
    }
  }

  function paintTo(p) {
    var op = state.op;
    var q = op.inv.transformPoint(new DOMPoint(p.x, p.y));
    var from = op.last || q;
    if (op.tool === 'pencil') pencilLine(op, from, q);
    else if (op.tool === 'spray') sprayAt(op, q);
    else brushLine(op, from, q);
    op.last = q;
    composeStroke(op);
  }

  function brushLine(op, from, q) {
    var ctx = op.stroke.getContext('2d');
    var shift = 0;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = op.width;
    ctx.strokeStyle = op.erase ? '#000000' : state.color;
    if (state.brush.soft > 0) {
      // Soft edges: draw the stroke off-canvas and keep only its blurred shadow.
      shift = 100000;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = (op.width * state.brush.soft) / 100;
      ctx.shadowOffsetX = shift;
    }
    ctx.beginPath();
    ctx.moveTo(from.x - shift, from.y);
    ctx.lineTo(q.x - shift + (from === q ? 0.01 : 0), q.y);
    ctx.stroke();
  }

  // Hard-edged square stamps on whole pixels: no anti-aliasing.
  function pencilLine(op, from, q) {
    var ctx = op.stroke.getContext('2d');
    var size = Math.max(1, Math.round(op.width));
    ctx.fillStyle = state.color;
    var steps = Math.max(1, Math.ceil(Math.hypot(q.x - from.x, q.y - from.y)));
    for (var i = 0; i <= steps; i++) {
      var x = from.x + ((q.x - from.x) * i) / steps, y = from.y + ((q.y - from.y) * i) / steps;
      ctx.fillRect(Math.round(x - size / 2), Math.round(y - size / 2), size, size);
    }
  }

  function sprayAt(op, q) {
    if (!q) return;
    var ctx = op.stroke.getContext('2d');
    var r = op.width / 2;
    var dots = Math.max(2, Math.round((state.sprayDensity / 100) * r * 1.5));
    var dot = Math.max(1, op.width / 50);
    ctx.fillStyle = state.color;
    for (var i = 0; i < dots; i++) {
      var d = r * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
      ctx.fillRect(q.x + Math.cos(a) * d, q.y + Math.sin(a) * d, dot, dot);
    }
  }

  function composeStroke(op) {
    var w = op.work.getContext('2d');
    w.globalCompositeOperation = 'source-over';
    w.globalAlpha = 1;
    w.clearRect(0, 0, op.work.width, op.work.height);
    w.drawImage(op.base, 0, 0);
    w.globalAlpha = state.brush.opacity;
    w.globalCompositeOperation = op.erase ? 'destination-out' : 'source-over';
    w.drawImage(op.stroke, 0, 0);
    w.globalAlpha = 1;
    w.globalCompositeOperation = 'source-over';
    op.layer.rev++;
    requestRender();
  }

  function endPaint(op) {
    clearInterval(op.timer);
    commit();
  }

  /* ---- paint bucket & magic eraser ---- */

  function hexToRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // Pixels similar to the one at (sx, sy): either the connected area or all matches.
  function floodMask(d, w, h, sx, sy, tol, contiguous) {
    var mask = new Uint8Array(w * h);
    var i0 = (sy * w + sx) * 4;
    var r0 = d[i0], g0 = d[i0 + 1], b0 = d[i0 + 2], a0 = d[i0 + 3];
    function match(p) {
      var i = p * 4;
      return Math.abs(d[i] - r0) <= tol && Math.abs(d[i + 1] - g0) <= tol &&
        Math.abs(d[i + 2] - b0) <= tol && Math.abs(d[i + 3] - a0) <= tol;
    }
    if (!contiguous) {
      for (var p = 0; p < w * h; p++) if (match(p)) mask[p] = 1;
      return mask;
    }
    var stack = [sx, sy];
    while (stack.length) {
      var y = stack.pop(), x = stack.pop(), q = y * w + x;
      while (x > 0 && !mask[q - 1] && match(q - 1)) { x--; q--; }
      var up = false, down = false;
      while (x < w && !mask[q] && match(q)) {
        mask[q] = 1;
        if (y > 0) {
          if (!mask[q - w] && match(q - w)) { if (!up) { stack.push(x, y - 1); up = true; } } else up = false;
        }
        if (y < h - 1) {
          if (!mask[q + w] && match(q + w)) { if (!down) { stack.push(x, y + 1); down = true; } } else down = false;
        }
        x++;
        q++;
      }
    }
    return mask;
  }

  function floodAt(p, erase) {
    var target = paintTarget(!erase, 'Fill');
    if (!target) return;
    var l = target.layer;
    var q = Layers.matrix(l).inverse().transformPoint(new DOMPoint(p.x, p.y));
    var w = l.canvas.width, h = l.canvas.height;
    var x = Math.floor(q.x), y = Math.floor(q.y);
    if (x < 0 || y < 0 || x >= w || y >= h) { toast('Click inside the selected layer.'); return; }
    var out = newCanvas(w, h);
    var ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(l.canvas, 0, 0);
    var img = ctx.getImageData(0, 0, w, h), d = img.data;
    var mask = floodMask(d, w, h, x, y, state.tolerance, state.contiguous);
    var rgb = hexToRgb(state.color);
    for (var i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      if (erase) d[i * 4 + 3] = 0;
      else { d[i * 4] = rgb[0]; d[i * 4 + 1] = rgb[1]; d[i * 4 + 2] = rgb[2]; d[i * 4 + 3] = 255; }
    }
    ctx.putImageData(img, 0, 0);
    l.canvas = out;
    l.rev++;
    commit();
    requestRender();
  }

  /* ---- gradient ---- */

  function startGradient(p) {
    var target = paintTarget(true, 'Gradient');
    if (!target) return;
    var l = target.layer;
    var base = l.canvas;
    var work = newCanvas(base.width, base.height);
    work.getContext('2d').drawImage(base, 0, 0);
    l.canvas = work;
    state.op = { type: 'gradient', layer: l, base: base, work: work, inv: Layers.matrix(l).inverse(), p0: p, p1: null, created: target.created };
  }

  function drawGradient(op) {
    var a = op.inv.transformPoint(new DOMPoint(op.p0.x, op.p0.y));
    var b = op.inv.transformPoint(new DOMPoint(op.p1.x, op.p1.y));
    var ctx = op.work.getContext('2d');
    ctx.clearRect(0, 0, op.work.width, op.work.height);
    ctx.drawImage(op.base, 0, 0);
    var g = state.gradientType === 'radial'
      ? ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)))
      : ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    var rgb = hexToRgb(state.color);
    g.addColorStop(0, state.color);
    g.addColorStop(1, state.gradientEnd === 'transparent' ? 'rgba(' + rgb.join(',') + ',0)' : state.secondary);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, op.work.width, op.work.height);
    op.layer.rev++;
    requestRender();
  }

  function endGradient(op) {
    if (op.p1 && Math.hypot(op.p1.x - op.p0.x, op.p1.y - op.p0.y) * state.zoom >= 3) {
      commit();
      return;
    }
    op.layer.canvas = op.base; // a click without a drag does nothing
    if (op.created) deleteLayerQuietly(op.layer);
    refreshPanels();
  }

  function deleteLayerQuietly(l) {
    var i = state.layers.indexOf(l);
    if (i >= 0) state.layers.splice(i, 1);
    if (state.selectedId === l.id) state.selectedId = null;
  }

  /* ---- text editing on the canvas ---- */

  var textEditor = $('text-editor');

  // Text layers are picked by their box, which is easier to hit than the glyphs.
  function textLayerAt(p) {
    for (var i = state.layers.length - 1; i >= 0; i--) {
      var l = state.layers[i];
      if (l.type !== 'text' || !l.visible) continue;
      var q = Layers.matrix(l).inverse().transformPoint(new DOMPoint(p.x, p.y));
      var s = Layers.size(l);
      if (q.x >= 0 && q.y >= 0 && q.x <= s.w && q.y <= s.h) return l;
    }
    return null;
  }

  function createTextAt(p, vertical) {
    var size = Math.max(16, Math.round(Math.min(state.doc.w, state.doc.h) / 12));
    var l = Layers.createText('', p.x, p.y, { color: state.color, fontSize: size, vertical: vertical });
    var s = Layers.size(l), pad = Layers.textPadding(l), line = l.fontSize * Layers.LINE_HEIGHT;
    if (vertical) { // first column centred on the click, starting at it
      l.x = p.x + line / 2 + pad - s.w / 2;
      l.y = p.y - pad + s.h / 2;
    } else { // first line starts at the click, vertically centred on it
      l.x = p.x - pad + s.w / 2;
      l.y = p.y - pad - line / 2 + s.h / 2;
    }
    addLayer(l);
    startTextEdit(l, true);
  }

  // Where text stays put while it changes: the start of the first line for its alignment.
  function textAnchor(l) {
    var s = Layers.size(l);
    var along = l.align === 'center' ? 0.5 : l.align === 'right' ? 1 : 0;
    var pt = l.vertical ? new DOMPoint(s.w, s.h * along) : new DOMPoint(s.w * along, 0);
    return Layers.matrix(l).transformPoint(pt);
  }

  function applyTextChange(l, mutate) {
    var before = textAnchor(l);
    mutate(l);
    var after = textAnchor(l);
    l.x += before.x - after.x;
    l.y += before.y - after.y;
  }

  function startTextEdit(l, isNew) {
    if (state.editing && state.editing.layer !== l) finishTextEdit();
    state.selectedId = l.id;
    state.editing = { layer: l, isNew: isNew, before: l.text, hide: !!l.vertical };
    textEditor.value = l.text;
    textEditor.hidden = false;
    textEditor.classList.toggle('vertical', !!l.vertical);
    refreshPanels();
    updateTextEditor();
    requestRender();
    textEditor.focus();
    textEditor.setSelectionRange(textEditor.value.length, textEditor.value.length);
  }

  // Lays the textarea exactly over the layer so the caret lines up with the rendered text.
  function updateTextEditor() {
    var ed = state.editing;
    if (!ed) return;
    var l = ed.layer, s = Layers.size(l);
    var m = new DOMMatrix([state.zoom, 0, 0, state.zoom, state.panX, state.panY]).multiply(Layers.matrix(l));
    var st = textEditor.style;
    st.width = s.w + 'px';
    st.height = s.h + 'px';
    st.font = Layers.fontString(l);
    st.lineHeight = l.fontSize * Layers.LINE_HEIGHT + 'px';
    st.padding = Layers.textPadding(l) + 'px';
    st.textAlign = l.align;
    // Horizontal text shows the live canvas rendering under a transparent textarea; vertical
    // text can't be matched glyph-for-glyph, so the textarea shows it while the layer is hidden.
    st.color = l.vertical ? l.color : 'transparent';
    st.caretColor = l.color;
    st.transform = 'matrix(' + [m.a, m.b, m.c, m.d, m.e, m.f].join(',') + ')';
  }

  function finishTextEdit() {
    var ed = state.editing;
    if (!ed) return;
    state.editing = null;
    textEditor.hidden = true;
    var l = ed.layer;
    if (!String(l.text).trim()) {
      deleteLayerQuietly(l);
      if (ed.isNew) refreshPanels(); else commit();
    } else if (ed.isNew || l.text !== ed.before) {
      commit();
    } else {
      refreshPanels();
    }
    requestRender();
  }

  function refocusEditor() {
    if (state.editing) textEditor.focus();
  }

  /* ---- eyedropper & crop ---- */

  function pickColor(p, secondary) {
    if (p.x < 0 || p.y < 0 || p.x >= state.doc.w || p.y >= state.doc.h) return;
    var c = newCanvas(1, 1), ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.translate(-Math.floor(p.x), -Math.floor(p.y));
    if (state.doc.background) {
      ctx.fillStyle = state.doc.background;
      ctx.fillRect(0, 0, state.doc.w, state.doc.h);
    }
    state.layers.forEach(function (l) { Layers.draw(ctx, l); });
    var d = ctx.getImageData(0, 0, 1, 1).data;
    if (d[3] === 0) { toast('That spot is transparent.'); return; }
    var hex = '#' + [d[0], d[1], d[2]].map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
    if (secondary) setSecondary(hex); else setColor(hex);
    toast('Picked ' + hex + (secondary ? ' as the second colour' : ''));
  }

  function updateCropUi() {
    var ok = state.crop && state.crop.w >= 1 && state.crop.h >= 1;
    $('crop-apply').disabled = !ok;
    $('crop-cancel').disabled = !state.crop;
    $('crop-hint').textContent = ok ? state.crop.w + ' × ' + state.crop.h + ' px · Enter to apply, Esc to cancel' : 'Drag to choose the area to keep';
  }

  function applyCrop() {
    var c = state.crop;
    if (!c || c.w < 1 || c.h < 1) return;
    state.doc.w = c.w;
    state.doc.h = c.h;
    state.layers.forEach(function (l) { l.x -= c.x; l.y -= c.y; });
    state.crop = null;
    updateCropUi();
    commit();
    fit();
  }

  function cancelCrop() {
    state.crop = null;
    updateCropUi();
    requestRender();
  }

  /* ---------- tools & options ---------- */

  // Called by the toolbar whenever a tool is picked.
  function setTool(tool) {
    if (state.tool === 'crop' && tool !== 'crop') cancelCrop();
    if (state.editing) finishTextEdit();
    state.tool = tool;
    state.hover = null;
    Array.prototype.forEach.call(document.querySelectorAll('.opt-group'), function (g) {
      g.hidden = g.dataset.for.split(' ').indexOf(tool) < 0;
    });
    wrap.dataset.tool = tool;
    requestRender();
  }

  function setColor(hex) {
    state.color = hex;
    $('primary-color').value = hex;
  }

  function setSecondary(hex) {
    state.secondary = hex;
    $('secondary-color').value = hex;
  }

  /* ---------- panels ---------- */

  function refreshPanels() {
    var has = !!state.doc;
    ['act-add', 'act-resize', 'act-canvas', 'act-flatten', 'act-export'].forEach(function (id) { $(id).disabled = !has; });
    $('act-flatten').disabled = state.layers.length < 1;
    $('act-undo').disabled = state.hIndex <= 0;
    $('act-redo').disabled = state.hIndex >= state.history.length - 1;
    renderLayers();
    renderProps();
    renderAdjustments();
  }

  function renderLayers() {
    var ul = $('layer-list');
    ul.innerHTML = '';
    $('layers-empty').hidden = state.layers.length > 0;
    var sel = selected();
    ['l-dup', 'l-up', 'l-down', 'l-merge', 'l-del'].forEach(function (id) { $(id).disabled = !sel; });
    $('l-add').disabled = !state.doc;
    if (sel) {
      var i = state.layers.indexOf(sel);
      $('l-up').disabled = i === state.layers.length - 1;
      $('l-down').disabled = i === 0;
      $('l-merge').disabled = i === 0;
    }
    state.layers.slice().reverse().forEach(function (l) {
      var li = document.createElement('li');
      li.className = 'layer' + (l === sel ? ' active' : '') + (l.visible ? '' : ' hidden-layer');
      li.draggable = true;
      li.dataset.id = l.id;

      var eye = document.createElement('button');
      eye.type = 'button';
      eye.className = 'eye';
      eye.title = l.visible ? 'Hide layer' : 'Show layer';
      eye.setAttribute('aria-label', eye.title);
      eye.innerHTML = l.visible
        ? '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>'
        : '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10 10 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3 3.8M6.6 6.6C3.9 8.3 2 12 2 12s3.5 7 10 7a9.8 9.8 0 005.4-1.6"/></svg>';
      eye.onclick = function (ev) {
        ev.stopPropagation();
        l.visible = !l.visible;
        commit();
        requestRender();
      };

      var thumb = document.createElement('span');
      thumb.className = 'layer-thumb';
      thumb.appendChild(Layers.thumbnail(l, 36));

      var name = document.createElement('span');
      name.className = 'layer-name';
      name.textContent = l.name;
      name.title = 'Double-click to rename';
      name.ondblclick = function (ev) {
        ev.stopPropagation();
        var input = document.createElement('input');
        input.value = l.name;
        input.className = 'rename';
        name.replaceWith(input);
        input.focus();
        input.select();
        var done = function (save) {
          if (save && input.value.trim()) { l.name = input.value.trim(); commit(); } else renderLayers();
        };
        input.onkeydown = function (k) {
          if (k.key === 'Enter') done(true);
          if (k.key === 'Escape') done(false);
          k.stopPropagation();
        };
        input.onblur = function () { done(true); };
      };

      var meta = document.createElement('span');
      meta.className = 'layer-meta';
      meta.textContent = { image: 'Pixels', text: 'Text', shape: 'Shape' }[l.type] +
        (l.opacity < 1 ? ' · ' + Math.round(l.opacity * 100) + '%' : '') +
        (l.blend !== 'source-over' ? ' · ' + blendLabel(l.blend) : '') +
        (Filters.isIdentity(l.filters) ? '' : ' · fx');

      var text = document.createElement('span');
      text.className = 'layer-text';
      text.appendChild(name);
      text.appendChild(meta);

      li.appendChild(eye);
      li.appendChild(thumb);
      li.appendChild(text);
      li.onclick = function () { select(l); };

      li.addEventListener('dragstart', function (ev) {
        ev.dataTransfer.setData('text/x-layer', String(l.id));
        ev.dataTransfer.effectAllowed = 'move';
        li.classList.add('dragging');
      });
      li.addEventListener('dragend', function () { li.classList.remove('dragging'); });
      li.addEventListener('dragover', function (ev) {
        if (ev.dataTransfer.types.indexOf('text/x-layer') < 0) return;
        ev.preventDefault();
        li.classList.add('drop-target');
      });
      li.addEventListener('dragleave', function () { li.classList.remove('drop-target'); });
      li.addEventListener('drop', function (ev) {
        var id = +ev.dataTransfer.getData('text/x-layer');
        if (!id) return;
        ev.preventDefault();
        ev.stopPropagation();
        var dragged = state.layers.filter(function (x) { return x.id === id; })[0];
        if (!dragged || dragged === l) { renderLayers(); return; }
        var to = state.layers.indexOf(l);
        state.layers.splice(state.layers.indexOf(dragged), 1);
        state.layers.splice(to, 0, dragged);
        commit();
        requestRender();
      });
      ul.appendChild(li);
    });
  }

  function blendLabel(mode) {
    for (var i = 0; i < Layers.BLEND_MODES.length; i++) if (Layers.BLEND_MODES[i][0] === mode) return Layers.BLEND_MODES[i][1];
    return mode;
  }

  function renderProps() {
    var l = selected();
    var doc = state.doc;
    $('doc-props').hidden = !!l;
    $('layer-props').hidden = !l;
    $('props-title').textContent = l ? l.name : 'Document';
    if (!l) {
      $('doc-size').textContent = doc ? doc.w + ' × ' + doc.h + ' px' : 'No document';
      $('doc-transparent').checked = doc ? !doc.background : false;
      $('doc-bg').disabled = !doc || !doc.background;
      if (doc && doc.background) $('doc-bg').value = doc.background;
      return;
    }
    var b = bounds(l), ds = displaySize(l);
    setIfIdle('p-x', round(b.x));
    setIfIdle('p-y', round(b.y));
    setIfIdle('p-w', round(ds.w));
    setIfIdle('p-h', round(ds.h));
    setIfIdle('p-rot', round(l.rotation));
    $('p-rot-out').textContent = round(l.rotation) + '°';
    setIfIdle('p-opacity', round(l.opacity * 100));
    $('p-opacity-out').textContent = round(l.opacity * 100) + '%';
    $('p-blend').value = l.blend;
    $('p-raster').hidden = l.type === 'image';

    $('text-props').hidden = l.type !== 'text';
    $('shape-props').hidden = l.type !== 'shape';
    if (l.type === 'text') {
      setIfIdle('t-text', l.text);
      $('t-font').value = l.fontFamily;
      setIfIdle('t-size', l.fontSize);
      $('t-color').value = l.color;
      $('t-stroke').value = l.strokeColor;
      setIfIdle('t-stroke-w', l.strokeWidth);
      $('t-bold').setAttribute('aria-pressed', String(l.bold));
      $('t-italic').setAttribute('aria-pressed', String(l.italic));
      $('t-vertical').setAttribute('aria-pressed', String(!!l.vertical));
      Array.prototype.forEach.call(document.querySelectorAll('[data-align]'), function (btn) {
        btn.setAttribute('aria-pressed', String(btn.dataset.align === l.align));
      });
    } else if (l.type === 'shape') {
      $('s-fill').value = l.fill;
      $('s-fill-on').checked = l.fillEnabled;
      $('s-stroke').value = l.strokeColor;
      setIfIdle('s-stroke-w', l.strokeWidth);
      $('s-radius-field').hidden = l.shape !== 'rect';
      setIfIdle('s-radius', l.radius);
      $('s-points-field').hidden = l.shape !== 'star';
      setIfIdle('s-points', l.points || 5);
      $('s-radius-out').textContent = l.radius;
    }
  }

  // Avoid overwriting a field while the user is typing in it.
  function setIfIdle(id, value) {
    var el = $(id);
    if (document.activeElement !== el) el.value = value;
  }

  function renderAdjustments() {
    var l = selected();
    $('adjust-empty').hidden = !!l;
    $('adjust-body').hidden = !l;
    if (!l) return;
    ADJUSTMENTS.forEach(function (a) {
      $('f-' + a[0]).value = l.filters[a[0]] || 0;
      $('f-' + a[0] + '-out').textContent = l.filters[a[0]] || 0;
    });
  }

  function buildAdjustments() {
    var box = $('sliders');
    ADJUSTMENTS.forEach(function (a) {
      var key = a[0];
      var field = document.createElement('div');
      field.className = 'field compact';
      field.innerHTML = '<label for="f-' + key + '">' + a[1] + ' <output id="f-' + key + '-out">0</output></label>' +
        '<input type="range" id="f-' + key + '" min="' + a[2] + '" max="' + a[3] + '" value="0" title="Double-click to reset">';
      box.appendChild(field);
      var input = field.querySelector('input');
      input.addEventListener('input', function () {
        var l = selected();
        if (!l) return;
        l.filters[key] = +input.value;
        $('f-' + key + '-out').textContent = input.value;
        requestRender();
      });
      input.addEventListener('change', function () { commit(); });
      input.addEventListener('dblclick', function () {
        input.value = 0;
        input.dispatchEvent(new Event('input'));
        commit();
      });
    });

    var presets = $('presets');
    Filters.PRESETS.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = p.name;
      b.onclick = function () {
        var l = selected();
        if (!l) return;
        l.filters = Filters.defaults();
        for (var k in p.values) l.filters[k] = p.values[k];
        commit();
        requestRender();
      };
      presets.appendChild(b);
    });
  }

  /* ---------- dialogs ---------- */

  function openDialog(id, onOk) {
    var d = $(id);
    d.returnValue = '';
    d.onclose = function () { if (d.returnValue === 'ok') onOk(); };
    d.showModal();
  }

  function showNewDialog() {
    $('new-bg').disabled = $('new-transparent').checked;
    openDialog('dlg-new', function () {
      var w = +$('new-w').value || 1920, h = +$('new-h').value || 1080;
      newDocument(w, h, $('new-transparent').checked ? null : $('new-bg').value);
      $('exp-name').value = 'untitled';
    });
  }

  function showSizeDialog(mode) {
    var doc = state.doc;
    if (!doc) return;
    $('size-title').textContent = mode === 'image' ? 'Image size' : 'Canvas size';
    $('size-desc').textContent = mode === 'image'
      ? 'Scales the whole image, including every layer.'
      : 'Changes the canvas area around the centre without scaling layers.';
    $('size-w').value = doc.w;
    $('size-h').value = doc.h;
    $('size-lock').checked = mode === 'image';
    openDialog('dlg-size', function () {
      var w = Math.min(MAX_DOC, Math.max(1, +$('size-w').value || doc.w));
      var h = Math.min(MAX_DOC, Math.max(1, +$('size-h').value || doc.h));
      if (mode === 'image') {
        var kx = w / doc.w, ky = h / doc.h;
        state.layers.forEach(function (l) {
          l.x *= kx;
          l.y *= ky;
          if (l.type === 'text') l.fontSize = Math.max(4, Math.round(l.fontSize * Math.sqrt(kx * ky)));
          else if (l.type === 'shape') { l.w *= kx; l.h *= ky; }
          else { l.scaleX *= kx; l.scaleY *= ky; }
        });
      } else {
        var dx = (w - doc.w) / 2, dy = (h - doc.h) / 2;
        state.layers.forEach(function (l) { l.x += dx; l.y += dy; });
      }
      doc.w = round(w);
      doc.h = round(h);
      commit();
      fit();
    });
  }

  function renderExportFormats() {
    var grid = $('exp-formats');
    grid.innerHTML = '';
    Encoders.list.forEach(function (o) {
      if (!o.supported) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'format-btn';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(o.id === state.exportFormat));
      b.textContent = o.label;
      b.onclick = function () { state.exportFormat = o.id; renderExportFormats(); };
      grid.appendChild(b);
    });
    var out = Encoders.get(state.exportFormat);
    $('exp-note').textContent = out.note + (out.alpha ? '' : ' Transparent areas become ' + (state.doc && state.doc.background ? 'the background colour.' : 'white.'));
    $('exp-quality-field').hidden = !out.lossy;
    updateExportSize();
  }

  function updateExportSize() {
    if (!state.doc) return;
    var k = +$('exp-scale').value / 100;
    $('exp-scale-out').textContent = $('exp-scale').value + '%';
    $('exp-size').textContent = 'Output: ' + Math.max(1, round(state.doc.w * k)) + ' × ' + Math.max(1, round(state.doc.h * k)) + ' px';
  }

  function showExportDialog() {
    if (!state.doc) return;
    renderExportFormats();
    openDialog('dlg-export', doExport);
  }

  function doExport() {
    var out = Encoders.get(state.exportFormat);
    var bg = out.alpha ? state.doc.background : (state.doc.background || '#ffffff');
    var flat = Layers.flatten(state.doc, state.layers, bg);
    var k = +$('exp-scale').value / 100;
    if (k !== 1) {
      var scaled = newCanvas(Math.max(1, round(flat.width * k)), Math.max(1, round(flat.height * k)));
      var sctx = scaled.getContext('2d', { willReadFrequently: true });
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(flat, 0, 0, scaled.width, scaled.height);
      flat = scaled;
    }
    var name = ($('exp-name').value.trim() || 'image').replace(/[\\/:*?"<>|]+/g, '-') + '.' + out.ext;
    toast('Exporting ' + name + '…');
    Encoders.encode(out.id, flat, { quality: +$('exp-quality').value / 100, dpi: 72, title: name }).then(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
      toast('Saved ' + name);
    }, function (err) {
      toast('Export failed: ' + err.message);
    });
  }

  /* ---------- wiring ---------- */

  function bindPanels() {
    var blend = $('p-blend');
    Layers.BLEND_MODES.forEach(function (m) { blend.add(new Option(m[1], m[0])); });
    var font = $('t-font');
    Layers.FONTS.forEach(function (f) { font.add(new Option(f[1], f[0])); });

    // Live edit on input, history entry on change.
    function bindLayerInput(id, apply, ev) {
      $(id).addEventListener(ev || 'input', function () {
        var l = selected();
        if (!l) return;
        apply(l, this);
        requestRender();
        if (ev === 'change') { commit(); return; }
        renderProps();
      });
      if (!ev) $(id).addEventListener('change', function () { if (selected()) commit(); });
    }

    function moveBoundsTo(l, x, y) {
      var b = bounds(l);
      l.x += x - b.x;
      l.y += y - b.y;
    }

    bindLayerInput('p-x', function (l, el) { if (el.value !== '') moveBoundsTo(l, +el.value, bounds(l).y); });
    bindLayerInput('p-y', function (l, el) { if (el.value !== '') moveBoundsTo(l, bounds(l).x, +el.value); });
    bindLayerInput('p-w', function (l, el) {
      var w = +el.value;
      if (!w) return;
      var ds = displaySize(l);
      setDisplaySize(l, w, $('p-lock').checked ? (ds.h * w) / ds.w : ds.h);
    });
    bindLayerInput('p-h', function (l, el) {
      var h = +el.value;
      if (!h) return;
      var ds = displaySize(l);
      setDisplaySize(l, $('p-lock').checked ? (ds.w * h) / ds.h : ds.w, h);
    });
    bindLayerInput('p-rot', function (l, el) { l.rotation = +el.value; });
    bindLayerInput('p-opacity', function (l, el) { l.opacity = +el.value / 100; });
    bindLayerInput('p-blend', function (l, el) { l.blend = el.value; }, 'change');

    $('p-fliph').onclick = function () { var l = selected(); if (l) { l.scaleX *= -1; commit(); requestRender(); } };
    $('p-flipv').onclick = function () { var l = selected(); if (l) { l.scaleY *= -1; commit(); requestRender(); } };
    $('p-center').onclick = function () {
      var l = selected();
      if (!l) return;
      l.x = state.doc.w / 2;
      l.y = state.doc.h / 2;
      commit();
      requestRender();
    };
    $('p-fit').onclick = function () {
      var l = selected();
      if (!l) return;
      var ds = displaySize(l);
      var k = Math.min(state.doc.w / ds.w, state.doc.h / ds.h);
      setDisplaySize(l, ds.w * k, ds.h * k);
      l.x = state.doc.w / 2;
      l.y = state.doc.h / 2;
      l.rotation = 0;
      commit();
      requestRender();
    };
    $('p-raster').onclick = function () {
      var l = selected();
      if (l) { rasterize(l); commit(); requestRender(); }
    };

    // Text edits keep the start of the first line in place as the text grows or shrinks.
    function textInput(id, apply, ev) {
      bindLayerInput(id, function (l, el) {
        applyTextChange(l, function () { apply(l, el); });
        if (state.editing && state.editing.layer === l) textEditor.value = l.text;
      }, ev);
    }
    function textToggle(id, apply) {
      (typeof id === 'string' ? $(id) : id).onclick = function () {
        var l = selected();
        if (!l || l.type !== 'text') return;
        apply(l);
        commit();
        requestRender();
        refocusEditor();
      };
    }
    textInput('t-text', function (l, el) { l.text = el.value; });
    textInput('t-font', function (l, el) { l.fontFamily = el.value; }, 'change');
    textInput('t-size', function (l, el) { if (+el.value >= 4) l.fontSize = +el.value; });
    bindLayerInput('t-color', function (l, el) { l.color = el.value; });
    bindLayerInput('t-stroke', function (l, el) { l.strokeColor = el.value; });
    textInput('t-stroke-w', function (l, el) { l.strokeWidth = Math.max(0, +el.value || 0); });
    textToggle('t-bold', function (l) { applyTextChange(l, function () { l.bold = !l.bold; }); });
    textToggle('t-italic', function (l) { applyTextChange(l, function () { l.italic = !l.italic; }); });
    textToggle('t-vertical', function (l) {
      l.vertical = !l.vertical;
      if (state.editing && state.editing.layer === l) {
        state.editing.hide = l.vertical;
        textEditor.classList.toggle('vertical', l.vertical);
      }
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-align]'), function (b) {
      textToggle(b, function (l) { l.align = b.dataset.align; });
    });
    $('t-edit').onclick = function () { var l = selected(); if (l && l.type === 'text') startTextEdit(l, false); };

    bindLayerInput('s-fill', function (l, el) { l.fill = el.value; });
    bindLayerInput('s-fill-on', function (l, el) { l.fillEnabled = el.checked; }, 'change');
    bindLayerInput('s-stroke', function (l, el) { l.strokeColor = el.value; });
    bindLayerInput('s-stroke-w', function (l, el) { l.strokeWidth = Math.max(0, +el.value || 0); });
    bindLayerInput('s-radius', function (l, el) { l.radius = +el.value; });
    bindLayerInput('s-points', function (l, el) { l.points = Math.min(24, Math.max(3, +el.value || 5)); });

    $('doc-transparent').onchange = function () {
      if (!state.doc) return;
      state.doc.background = this.checked ? null : $('doc-bg').value;
      commit();
      requestRender();
    };
    $('doc-bg').oninput = function () {
      if (!state.doc || !state.doc.background) return;
      state.doc.background = this.value;
      requestRender();
    };
    $('doc-bg').onchange = function () { if (state.doc) commit(); };

    $('adjust-reset').onclick = function () {
      var l = selected();
      if (!l) return;
      l.filters = Filters.defaults();
      commit();
      requestRender();
    };

    $('l-add').onclick = function () {
      if (!state.doc) return;
      addLayer(Layers.createEmpty('Layer ' + (state.layers.length + 1), state.doc.w, state.doc.h, state.doc.w / 2, state.doc.h / 2));
      commit();
      requestRender();
    };
    $('l-dup').onclick = function () { duplicateLayer(selected()); };
    $('l-up').onclick = function () { moveLayer(selected(), 1); };
    $('l-down').onclick = function () { moveLayer(selected(), -1); };
    $('l-merge').onclick = function () { mergeDown(selected()); };
    $('l-del').onclick = function () { deleteLayer(selected()); };
  }

  function bindOptions() {
    $('brush-size').oninput = function () {
      state.brush.size = +this.value;
      $('brush-size-out').textContent = this.value;
    };
    $('brush-opacity').oninput = function () {
      state.brush.opacity = +this.value / 100;
      $('brush-opacity-out').textContent = this.value + '%';
    };
    $('brush-soft').oninput = function () { state.brush.soft = +this.value; };
    $('spray-density').oninput = function () { state.sprayDensity = +this.value; };
    $('fill-tolerance').oninput = function () {
      state.tolerance = +this.value;
      $('fill-tolerance-out').textContent = this.value;
    };
    $('fill-contiguous').onchange = function () { state.contiguous = this.checked; };
    $('gradient-type').onchange = function () { state.gradientType = this.value; };
    $('gradient-end').onchange = function () { state.gradientEnd = this.value; };
    $('line-weight').oninput = function () { state.lineWeight = Math.max(1, +this.value || 1); };
    $('star-points').oninput = function () { state.starPoints = Math.min(24, Math.max(3, +this.value || 5)); };
    $('primary-color').oninput = function () { state.color = this.value; };
    $('secondary-color').oninput = function () { state.secondary = this.value; };
    $('swap-colors').onclick = swapColors;
    $('crop-apply').onclick = applyCrop;
    $('crop-cancel').onclick = cancelCrop;
    $('zoom-in').onclick = function () { zoomAt(1.25); };
    $('zoom-out').onclick = function () { zoomAt(1 / 1.25); };
    $('zoom-label').onclick = fit;
  }

  function bindMenu() {
    $('act-new').onclick = showNewDialog;
    $('start-new').onclick = showNewDialog;
    $('act-open').onclick = function () { $('open-input').click(); };
    $('start-open').onclick = function () { $('open-input').click(); };
    $('act-add').onclick = function () { $('add-input').click(); };
    $('open-input').onchange = function () { loadFiles(this.files, true); this.value = ''; };
    $('add-input').onchange = function () { loadFiles(this.files, false); this.value = ''; };
    $('act-undo').onclick = undo;
    $('act-redo').onclick = redo;
    $('act-resize').onclick = function () { showSizeDialog('image'); };
    $('act-canvas').onclick = function () { showSizeDialog('canvas'); };
    $('act-flatten').onclick = flattenAll;
    $('act-export').onclick = showExportDialog;

    Array.prototype.forEach.call(document.querySelectorAll('#new-presets [data-size]'), function (b) {
      b.onclick = function () {
        var p = b.dataset.size.split('x');
        $('new-w').value = p[0];
        $('new-h').value = p[1];
      };
    });
    $('new-transparent').onchange = function () { $('new-bg').disabled = this.checked; };

    var lockRatio = function (src, dst) {
      $(src).addEventListener('input', function () {
        if (!$('size-lock').checked || !state.doc) return;
        var ratio = src === 'size-w' ? state.doc.h / state.doc.w : state.doc.w / state.doc.h;
        $(dst).value = Math.max(1, round(+this.value * ratio));
      });
    };
    lockRatio('size-w', 'size-h');
    lockRatio('size-h', 'size-w');

    $('exp-quality').oninput = function () { $('exp-quality-out').textContent = this.value; };
    $('exp-scale').oninput = updateExportSize;
  }

  function bindCanvas() {
    view.addEventListener('pointerdown', onPointerDown);
    view.addEventListener('pointermove', onPointerMove);
    view.addEventListener('pointerup', onPointerUp);
    view.addEventListener('pointercancel', onPointerUp);
    view.addEventListener('pointerleave', function () {
      if (state.hover) { state.hover = null; requestRender(); }
    });
    view.addEventListener('dblclick', function (e) {
      if (!state.doc || state.tool !== 'move') return;
      var l = textLayerAt(toDoc(e));
      if (l) startTextEdit(l, false);
    });

    textEditor.setAttribute('wrap', 'off');
    textEditor.addEventListener('input', function () {
      var ed = state.editing;
      if (!ed) return;
      applyTextChange(ed.layer, function (l) { l.text = textEditor.value; });
      renderProps();
      requestRender();
    });
    // The textarea is sized to the text; keep it from scrolling out of line with the canvas.
    textEditor.addEventListener('scroll', function () { textEditor.scrollLeft = 0; textEditor.scrollTop = 0; });
    textEditor.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        finishTextEdit();
      }
    });
    textEditor.addEventListener('blur', function (e) {
      // Keep editing while the user adjusts the text in the side panel.
      if (e.relatedTarget && $('side').contains(e.relatedTarget)) return;
      finishTextEdit();
    });
    view.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    wrap.addEventListener('wheel', function (e) {
      if (!state.doc) return;
      e.preventDefault();
      var rect = view.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(Math.exp(-e.deltaY * 0.0025), e.clientX - rect.left, e.clientY - rect.top);
      } else {
        state.panX -= e.deltaX;
        state.panY -= e.deltaY;
        requestRender();
      }
    }, { passive: false });

    // Drop images anywhere on the page.
    document.addEventListener('dragover', function (e) {
      if (e.dataTransfer.types.indexOf('Files') >= 0) {
        e.preventDefault();
        wrap.classList.add('drop-hover');
      }
    });
    document.addEventListener('dragleave', function (e) {
      if (!e.relatedTarget) wrap.classList.remove('drop-hover');
    });
    document.addEventListener('drop', function (e) {
      wrap.classList.remove('drop-hover');
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      loadFiles(e.dataTransfer.files, !state.doc);
    });
    document.addEventListener('paste', function (e) {
      if (isTyping(e.target)) return;
      var files = Array.prototype.filter.call(e.clipboardData.files || [], function (f) { return /^image\//.test(f.type); });
      if (files.length) loadFiles(files, !state.doc);
    });

    window.addEventListener('resize', resizeView);
    window.addEventListener('beforeunload', function (e) {
      if (state.history.length > 1) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  function swapColors() {
    var c = state.color;
    setColor(state.secondary);
    setSecondary(c);
  }

  function bindKeys() {
    document.addEventListener('keydown', function (e) {
      if (isTyping(e.target) || document.querySelector('dialog[open]')) return;
      var key = e.key.toLowerCase();
      var mod = e.ctrlKey || e.metaKey;
      if (mod) {
        if (key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
        else if (key === 'y') { e.preventDefault(); redo(); }
        else if (key === 'j') { e.preventDefault(); duplicateLayer(selected()); }
        else if (key === 'e') { e.preventDefault(); mergeDown(selected()); }
        else if (key === '0') { e.preventDefault(); fit(); }
        else if (key === '=' || key === '+') { e.preventDefault(); zoomAt(1.25); }
        else if (key === '-') { e.preventDefault(); zoomAt(1 / 1.25); }
        else if (key === 's') { e.preventDefault(); showExportDialog(); }
        else if (key === 'o') { e.preventDefault(); $('open-input').click(); }
        return;
      }
      if (key === ' ') {
        e.preventDefault();
        if (!state.spaceDown) { state.spaceDown = true; wrap.classList.add('space-pan'); requestRender(); }
        return;
      }
      if (key === 'x') { swapColors(); return; }
      if (key === 'd') { setColor('#000000'); setSecondary('#ffffff'); return; }
      if (key.length === 1 && Toolbar.shortcut(key, e.shiftKey)) return;
      if (key === '[' || key === ']') {
        var size = Math.max(1, Math.min(300, state.brush.size + (key === ']' ? 4 : -4)));
        $('brush-size').value = size;
        $('brush-size').oninput();
        requestRender();
        return;
      }
      var l = selected();
      if ((key === 'delete' || key === 'backspace') && l) { e.preventDefault(); deleteLayer(l); return; }
      if (key === 'escape') {
        if (state.crop) cancelCrop(); else select(null);
        return;
      }
      if (key === 'enter' && state.crop) { applyCrop(); return; }
      if (l && key.indexOf('arrow') === 0) {
        e.preventDefault();
        var step = e.shiftKey ? 10 : 1;
        if (key === 'arrowleft') l.x -= step;
        if (key === 'arrowright') l.x += step;
        if (key === 'arrowup') l.y -= step;
        if (key === 'arrowdown') l.y += step;
        renderProps();
        requestRender();
        clearTimeout(bindKeys.nudgeTimer);
        bindKeys.nudgeTimer = setTimeout(commit, 400);
      }
    });
    document.addEventListener('keyup', function (e) {
      if (e.key === ' ') {
        state.spaceDown = false;
        wrap.classList.remove('space-pan');
        requestRender();
      }
    });
  }

  buildAdjustments();
  bindPanels();
  bindOptions();
  bindMenu();
  bindCanvas();
  bindKeys();
  Toolbar.init($('toolbar'), setTool);
  setTool('move');
  refreshPanels();
  resizeView();
})();
