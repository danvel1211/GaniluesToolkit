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
    l.vertical = !!opts.vertical;
    return l;
  }

  var SHAPE_NAMES = { rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', triangle: 'Triangle', star: 'Star' };

  function createShape(kind, x, y, w, h, opts) {
    var l = base('shape', SHAPE_NAMES[kind] || 'Shape', x, y);
    l.shape = kind;
    l.w = Math.max(1, w);
    l.h = Math.max(1, h);
    l.fill = opts.fill || '#4f46e5';
    l.fillEnabled = opts.fillEnabled !== false;
    l.strokeColor = opts.strokeColor || '#111111';
    l.strokeWidth = opts.strokeWidth || 0;
    l.radius = opts.radius || 0;
    l.points = opts.points || 5;
    return l;
  }

  /* ---- layer effects: drop shadow and outline ---- */

  function fxDefault() {
    return {
      shadow: { on: false, color: '#000000', opacity: 0.5, blur: 10, dx: 6, dy: 6 },
      outline: { on: false, color: '#ffffff', width: 4 }
    };
  }

  // A full effects object (filling in anything missing); safe to modify.
  function fxCopy(fx) {
    var d = fxDefault();
    if (fx) {
      for (var g in d) for (var k in d[g]) if (fx[g] && fx[g][k] !== undefined) d[g][k] = fx[g][k];
    }
    return d;
  }

  function fxActive(l) {
    return !!(l.fx && (l.fx.shadow.on || (l.fx.outline.on && l.fx.outline.width > 0)));
  }

  function tinted(src, color, padLeft, w, h) {
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    var ctx = c.getContext('2d');
    ctx.drawImage(src, padLeft, padLeft);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    return c;
  }

  // Builds (and caches) the outlined picture and the blurred shadow for a layer's current look.
  function fxBuild(l, img) {
    var key = JSON.stringify(l.fx);
    if (l._fx && l._fxSrc === img && l._fxKey === key) return l._fx;
    var o = l.fx.outline, sh = l.fx.shadow;
    var ow = o.on ? Math.max(0, o.width) : 0, pad = Math.ceil(ow) + 2;
    var w = img.width + pad * 2, h = img.height + pad * 2;
    var outlined = document.createElement('canvas');
    outlined.width = w;
    outlined.height = h;
    var octx = outlined.getContext('2d');
    if (ow > 0) {
      var tint = tinted(img, o.color, pad, w, h);
      var rings = ow > 6 ? [ow, ow / 2] : [ow];
      rings.forEach(function (r) {
        var steps = Math.max(16, Math.min(72, Math.ceil(r * Math.PI * 2)));
        for (var i = 0; i < steps; i++) {
          var a = (i / steps) * Math.PI * 2;
          octx.drawImage(tint, Math.cos(a) * r, Math.sin(a) * r);
        }
      });
    }
    octx.drawImage(img, pad, pad);
    var built = { outlined: outlined, pad: pad, shadow: null, spad: 0 };
    if (sh.on) {
      var spad = Math.ceil(sh.blur * 2) + 2, sw = w + spad * 2, shh = h + spad * 2;
      var sil = tinted(outlined, sh.color, spad, sw, shh);
      built.shadow = sh.blur > 0 ? Filters.apply(sil, (function () { var f = Filters.defaults(); f.blur = Math.min(50, sh.blur); return f; })()) : sil;
      built.spad = spad;
    }
    l._fx = built;
    l._fxSrc = img;
    l._fxKey = key;
    return built;
  }

  // Shallow copy for history snapshots. Render caches are shared: they are keyed on content,
  // so a later edit to either copy simply misses the cache.
  function clone(l) {
    var c = {};
    for (var k in l) c[k] = l[k];
    c.filters = {};
    for (var f in l.filters) c.filters[f] = l.filters[f];
    if (l.fx) c.fx = fxCopy(l.fx);
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

  var LINE_HEIGHT = 1.25;

  // Space around the glyphs so outlines and descenders aren't clipped.
  function textPadding(l) {
    return Math.ceil(l.fontSize * 0.2 + l.strokeWidth);
  }

  function drawGlyphs(ctx, l, str, x, y) {
    if (l.strokeWidth > 0) {
      ctx.strokeStyle = l.strokeColor;
      ctx.lineWidth = l.strokeWidth * 2;
      ctx.strokeText(str, x, y);
    }
    ctx.fillStyle = l.color;
    ctx.fillText(str, x, y);
  }

  // Vertical text: upright characters stacked top to bottom, lines run right to left.
  function renderVerticalText(l) {
    var cols = String(l.text || ' ').split('\n').map(function (s) { return Array.from(s || ' '); });
    var maxLen = Math.max.apply(null, cols.map(function (c) { return c.length; }));
    var colWidth = l.fontSize * LINE_HEIGHT, pad = textPadding(l);
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(cols.length * colWidth + pad * 2));
    c.height = Math.max(1, Math.ceil(maxLen * l.fontSize + pad * 2));
    var ctx = c.getContext('2d');
    ctx.font = fontString(l);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    cols.forEach(function (chars, i) {
      var cx = c.width - pad - colWidth * (i + 0.5);
      var offset = l.align === 'center' ? (maxLen - chars.length) / 2 : l.align === 'right' ? maxLen - chars.length : 0;
      chars.forEach(function (ch, j) {
        drawGlyphs(ctx, l, ch, cx, pad + (offset + j + 0.5) * l.fontSize);
      });
    });
    return c;
  }

  function renderText(l) {
    if (l.vertical) return renderVerticalText(l);
    var lines = String(l.text || ' ').split('\n');
    measureCtx.font = fontString(l);
    var widths = lines.map(function (s) { return measureCtx.measureText(s || ' ').width; });
    var lineHeight = l.fontSize * LINE_HEIGHT;
    var pad = textPadding(l);
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
      drawGlyphs(ctx, l, line, x, pad + lineHeight * (i + 0.5));
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
    } else if (l.shape === 'line') {
      // A line is a bar with round ends; its length is w and its weight is h.
      ctx.roundRect ? ctx.roundRect(x, y, iw, ih, ih / 2) : ctx.rect(x, y, iw, ih);
    } else if (l.shape === 'triangle') {
      ctx.moveTo(w / 2, y);
      ctx.lineTo(x + iw, y + ih);
      ctx.lineTo(x, y + ih);
      ctx.closePath();
    } else if (l.shape === 'star') {
      var n = Math.max(3, l.points || 5);
      for (var i = 0; i < n * 2; i++) {
        var a = -Math.PI / 2 + (i * Math.PI) / n, k = i % 2 ? 0.45 : 1;
        var px = w / 2 + Math.cos(a) * (iw / 2) * k, py = h / 2 + Math.sin(a) * (ih / 2) * k;
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath();
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
      return [l.text, fontString(l), l.color, l.align, l.strokeColor, l.strokeWidth, l.vertical].join('|');
    }
    if (l.type === 'shape') {
      return [l.shape, l.w, l.h, l.fill, l.fillEnabled, l.strokeColor, l.strokeWidth, l.radius, l.points].join('|');
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
    var img = rendered(l);
    if (fxActive(l)) {
      var fx = fxBuild(l, img);
      if (fx.shadow) {
        // The shadow keeps pointing the same way on screen however the layer is rotated or scaled.
        var r = (-l.rotation * Math.PI) / 180, dx = l.fx.shadow.dx, dy = l.fx.shadow.dy;
        var lx = (dx * Math.cos(r) - dy * Math.sin(r)) / (l.scaleX || 1), ly = (dx * Math.sin(r) + dy * Math.cos(r)) / (l.scaleY || 1);
        ctx.globalAlpha = l.opacity * l.fx.shadow.opacity;
        ctx.drawImage(fx.shadow, -fx.pad - fx.spad + lx, -fx.pad - fx.spad + ly);
        ctx.globalAlpha = l.opacity;
      }
      ctx.drawImage(fx.outlined, -fx.pad, -fx.pad);
    } else {
      ctx.drawImage(img, 0, 0);
    }
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
    LINE_HEIGHT: LINE_HEIGHT,
    fontString: fontString,
    textPadding: textPadding,
    createImage: createImage,
    createEmpty: createEmpty,
    createText: createText,
    createShape: createShape,
    clone: clone,
    fxDefault: fxDefault,
    fxCopy: fxCopy,
    fxActive: fxActive,
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
