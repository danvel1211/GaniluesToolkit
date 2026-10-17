/*
 * Layer model. A layer is a plain object; its pixels come from content():
 *   image → its own canvas (painted on by the brush), text → rendered text, shape → rendered shape.
 * Position (x, y) is the layer's centre in document pixels.
 */
(function (global) {
  'use strict';

  var nextId = 1;

  var BLEND_MODES = [
    ['source-over', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'],
    ['darken', 'Darken'], ['lighten', 'Lighten'], ['color-dodge', 'Color dodge'], ['color-burn', 'Color burn'],
    ['hard-light', 'Hard light'], ['soft-light', 'Soft light'], ['difference', 'Difference'],
    ['exclusion', 'Exclusion'], ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'],
    ['luminosity', 'Luminosity']
  ];

  var FONTS = [
    ['system-ui, sans-serif', 'Sans serif'],
    ['Georgia, "Times New Roman", serif', 'Serif'],
    ['"Courier New", ui-monospace, monospace', 'Monospace'],
    ['Impact, "Arial Black", sans-serif', 'Impact'],
    ['"Brush Script MT", "Segoe Script", cursive', 'Script'],
    ['"Trebuchet MS", Verdana, sans-serif', 'Trebuchet']
  ];

  function base(type, name, x, y) {
    return {
      id: nextId++,
      type: type,
      name: name,
      visible: true,
      opacity: 1,
      blend: 'source-over',
      x: x,
      y: y,
      scaleX: 1,
      scaleY: 1,
      rotation: 0, // degrees
      filters: Filters.defaults(),
      rev: 0 // bumped whenever an image layer's pixels change in place
    };
  }

  function createImage(name, canvas, x, y) {
    var l = base('image', name, x, y);
    l.canvas = canvas;
    return l;
  }

  function createEmpty(name, w, h, x, y) {
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return createImage(name, c, x, y);
  }

  function createText(text, x, y, opts) {
    var l = base('text', 'Text', x, y);
    l.text = text;
    l.fontFamily = opts.fontFamily || FONTS[0][0];
    l.fontSize = opts.fontSize || 64;
    l.color = opts.color || '#111111';
    l.bold = !!opts.bold;
    l.italic = !!opts.italic;
    l.align = opts.align || 'left';
    l.strokeColor = opts.strokeColor || '#ffffff';
    l.strokeWidth = opts.strokeWidth || 0;
    return l;
  }

  function createShape(kind, x, y, w, h, opts) {
    var l = base('shape', kind === 'ellipse' ? 'Ellipse' : 'Rectangle', x, y);
    l.shape = kind;
    l.w = Math.max(1, w);
    l.h = Math.max(1, h);
    l.fill = opts.fill || '#4f46e5';
    l.fillEnabled = opts.fillEnabled !== false;
    l.strokeColor = opts.strokeColor || '#111111';
    l.strokeWidth = opts.strokeWidth || 0;
    l.radius = opts.radius || 0;
    return l;
  }

  // Shallow copy for history snapshots. Render caches are shared: they are keyed on content,
  // so a later edit to either copy simply misses the cache.
  function clone(l) {
    var c = {};
    for (var k in l) c[k] = l[k];
    c.filters = {};
    for (var f in l.filters) c.filters[f] = l.filters[f];
    return c;
  }

  // Copy with a fresh id (for "Duplicate layer").
  function duplicate(l) {
    var c = clone(l);
    c.id = nextId++;
    c.name = l.name + ' copy';
    if (l.type === 'image') {
      var cv = document.createElement('canvas');
      cv.width = l.canvas.width;
      cv.height = l.canvas.height;
      cv.getContext('2d').drawImage(l.canvas, 0, 0);
      c.canvas = cv;
    }
    return c;
  }

  /* ---- content rendering ---- */

  function fontString(l) {
    return (l.italic ? 'italic ' : '') + (l.bold ? 'bold ' : '') + l.fontSize + 'px ' + l.fontFamily;
  }

  var measureCtx = document.createElement('canvas').getContext('2d');

  function renderText(l) {
    var lines = String(l.text || ' ').split('\n');
    measureCtx.font = fontString(l);
    var widths = lines.map(function (s) { return measureCtx.measureText(s || ' ').width; });
    var lineHeight = l.fontSize * 1.25;
    var pad = Math.ceil(l.fontSize * 0.2 + l.strokeWidth);
    var w = Math.max(1, Math.ceil(Math.max.apply(null, widths) + pad * 2));
    var h = Math.max(1, Math.ceil(lines.length * lineHeight + pad * 2));
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    var ctx = c.getContext('2d');
    ctx.font = fontString(l);
    ctx.textBaseline = 'middle';
    ctx.textAlign = l.align;
    ctx.lineJoin = 'round';
    var x = l.align === 'center' ? w / 2 : l.align === 'right' ? w - pad : pad;
    lines.forEach(function (line, i) {
      var y = pad + lineHeight * (i + 0.5);
      if (l.strokeWidth > 0) {
        ctx.strokeStyle = l.strokeColor;
        ctx.lineWidth = l.strokeWidth * 2;
        ctx.strokeText(line, x, y);
      }
      ctx.fillStyle = l.color;
      ctx.fillText(line, x, y);
    });
    return c;
  }

  function renderShape(l) {
    var sw = l.strokeWidth || 0;
    var w = Math.max(1, Math.round(l.w)), h = Math.max(1, Math.round(l.h));
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    var ctx = c.getContext('2d');
    var x = sw / 2, y = sw / 2, iw = Math.max(0, w - sw), ih = Math.max(0, h - sw);
    ctx.beginPath();
    if (l.shape === 'ellipse') {
      ctx.ellipse(w / 2, h / 2, iw / 2, ih / 2, 0, 0, Math.PI * 2);
    } else {
      var r = Math.min(l.radius || 0, iw / 2, ih / 2);
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + iw, y, x + iw, y + ih, r);
      ctx.arcTo(x + iw, y + ih, x, y + ih, r);
      ctx.arcTo(x, y + ih, x, y, r);
      ctx.arcTo(x, y, x + iw, y, r);
      ctx.closePath();
    }
    if (l.fillEnabled) {
      ctx.fillStyle = l.fill;
      ctx.fill();
    }
    if (sw > 0) {
      ctx.strokeStyle = l.strokeColor;
      ctx.lineWidth = sw;
      ctx.stroke();
    }
    return c;
  }

  function contentKey(l) {
    if (l.type === 'text') {
      return [l.text, fontString(l), l.color, l.align, l.strokeColor, l.strokeWidth].join('|');
    }
    if (l.type === 'shape') {
      return [l.shape, l.w, l.h, l.fill, l.fillEnabled, l.strokeColor, l.strokeWidth, l.radius].join('|');
    }
    return '';
  }

  function content(l) {
    if (l.type === 'image') return l.canvas;
    var key = contentKey(l);
    if (l._contentKey !== key || !l._content) {
      l._content = l.type === 'text' ? renderText(l) : renderShape(l);
      l._contentKey = key;
    }
    return l._content;
  }

  // Content with adjustments applied (cached until content or filters change).
  function rendered(l) {
    var src = content(l);
    var key = JSON.stringify(l.filters) + '|' + l.rev;
    if (l._filtered && l._filterSrc === src && l._filterKey === key) return l._filtered;
    l._filtered = Filters.apply(src, l.filters);
    l._filterSrc = src;
    l._filterKey = key;
    return l._filtered;
  }

  function size(l) {
    var c = content(l);
    return { w: c.width, h: c.height };
  }

  // Maps layer-local pixels to document pixels.
  function matrix(l) {
    var s = size(l);
    return new DOMMatrix()
      .translate(l.x, l.y)
      .rotate(l.rotation)
      .scale(l.scaleX, l.scaleY)
      .translate(-s.w / 2, -s.h / 2);
  }

  function corners(l, m) {
    var s = size(l);
    m = m || matrix(l);
    return [[0, 0], [s.w, 0], [s.w, s.h], [0, s.h]].map(function (p) {
      return m.transformPoint(new DOMPoint(p[0], p[1]));
    });
  }

  function hitTest(l, x, y) {
    if (!l.visible) return false;
    var p = matrix(l).inverse().transformPoint(new DOMPoint(x, y));
    var s = size(l);
    if (p.x < 0 || p.y < 0 || p.x >= s.w || p.y >= s.h) return false;
    try { // ignore clicks on fully transparent pixels
      var px = rendered(l).getContext('2d').getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data;
      return px[3] > 8;
    } catch (e) {
      return true;
    }
  }

  function draw(ctx, l) {
    if (!l.visible || l.opacity <= 0) return;
    var m = matrix(l);
    ctx.save();
    ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
    ctx.globalAlpha = l.opacity;
    ctx.globalCompositeOperation = l.blend;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(rendered(l), 0, 0);
    ctx.restore();
  }

  // Composites a stack of layers onto a document-sized canvas.
  function flatten(doc, layers, background) {
    var c = document.createElement('canvas');
    c.width = doc.w;
    c.height = doc.h;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    var bg = background !== undefined ? background : doc.background;
    if (bg) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, doc.w, doc.h);
    }
    layers.forEach(function (l) { draw(ctx, l); });
    return c;
  }

  function thumbnail(l, sizePx) {
    var src = rendered(l);
    var c = document.createElement('canvas');
    var k = Math.min(sizePx / src.width, sizePx / src.height);
    c.width = Math.max(1, Math.round(src.width * k));
    c.height = Math.max(1, Math.round(src.height * k));
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  global.Layers = {
    BLEND_MODES: BLEND_MODES,
    FONTS: FONTS,
    createImage: createImage,
    createEmpty: createEmpty,
    createText: createText,
    createShape: createShape,
    clone: clone,
    duplicate: duplicate,
    content: content,
    rendered: rendered,
    size: size,
    matrix: matrix,
    corners: corners,
    hitTest: hitTest,
    draw: draw,
    flatten: flatten,
    thumbnail: thumbnail
  };
})(window);
