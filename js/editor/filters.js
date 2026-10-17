/*
 * Layer adjustments. Colour adjustments are folded into one affine colour matrix so a layer
 * is processed in a single pass; blur, sharpen and vignette run after it.
 */
(function (global) {
  'use strict';

  var DEFAULTS = {
    brightness: 0, // -100..100
    contrast: 0, // -100..100
    saturation: 0, // -100..100
    hue: 0, // -180..180 degrees
    temperature: 0, // -100..100 (cool..warm)
    grayscale: 0, // 0..100
    sepia: 0, // 0..100
    invert: 0, // 0..100
    blur: 0, // 0..50 px
    sharpen: 0, // 0..100
    vignette: 0 // 0..100
  };

  var PRESETS = [
    { name: 'Original', values: {} },
    { name: 'B&W', values: { grayscale: 100, contrast: 15 } },
    { name: 'Vintage', values: { sepia: 55, contrast: -10, saturation: -15, vignette: 45 } },
    { name: 'Warm', values: { temperature: 35, saturation: 10 } },
    { name: 'Cool', values: { temperature: -35, brightness: 5 } },
    { name: 'Vivid', values: { saturation: 45, contrast: 15 } },
    { name: 'Fade', values: { contrast: -25, brightness: 10, saturation: -25 } },
    { name: 'Dramatic', values: { contrast: 40, saturation: -15, vignette: 55 } },
    { name: 'Invert', values: { invert: 100 } }
  ];

  function defaults() {
    var o = {};
    for (var k in DEFAULTS) o[k] = DEFAULTS[k];
    return o;
  }

  function isIdentity(f) {
    for (var k in DEFAULTS) if (f[k] && f[k] !== DEFAULTS[k]) return false;
    return true;
  }

  /* ---- colour matrix (3 rows × [r, g, b, offset]) ---- */

  var IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

  // Returns the matrix that applies b, then a.
  function compose(a, b) {
    var out = new Array(12);
    for (var r = 0; r < 3; r++) {
      for (var c = 0; c < 4; c++) {
        var v = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c];
        if (c === 3) v += a[r * 4 + 3];
        out[r * 4 + c] = v;
      }
    }
    return out;
  }

  function linear(m) { // 3×3 → 3×4
    return [m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0];
  }

  function colorMatrix(f) {
    var m = IDENTITY;
    if (f.brightness) {
      var o = f.brightness * 2.55;
      m = compose([1, 0, 0, o, 0, 1, 0, o, 0, 0, 1, o], m);
    }
    if (f.contrast) {
      var c = f.contrast * 2.55;
      var k = (259 * (c + 255)) / (255 * (259 - c));
      var off = 128 * (1 - k);
      m = compose([k, 0, 0, off, 0, k, 0, off, 0, 0, k, off], m);
    }
    if (f.saturation) {
      var s = 1 + f.saturation / 100;
      var lr = 0.2126 * (1 - s), lg = 0.7152 * (1 - s), lb = 0.0722 * (1 - s);
      m = compose(linear([lr + s, lg, lb, lr, lg + s, lb, lr, lg, lb + s]), m);
    }
    if (f.hue) {
      var a = (f.hue * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
      m = compose(linear([
        0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928,
        0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.14, 0.072 - cos * 0.072 - sin * 0.283,
        0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072
      ]), m);
    }
    if (f.temperature) {
      var t = f.temperature * 0.4;
      m = compose([1, 0, 0, t, 0, 1, 0, t * 0.15, 0, 0, 1, -t], m);
    }
    if (f.grayscale) {
      var g = 1 - f.grayscale / 100;
      m = compose(linear([
        0.2126 + 0.7874 * g, 0.7152 - 0.7152 * g, 0.0722 - 0.0722 * g,
        0.2126 - 0.2126 * g, 0.7152 + 0.2848 * g, 0.0722 - 0.0722 * g,
        0.2126 - 0.2126 * g, 0.7152 - 0.7152 * g, 0.0722 + 0.9278 * g
      ]), m);
    }
    if (f.sepia) {
      var p = 1 - f.sepia / 100;
      m = compose(linear([
        0.393 + 0.607 * p, 0.769 - 0.769 * p, 0.189 - 0.189 * p,
        0.349 - 0.349 * p, 0.686 + 0.314 * p, 0.168 - 0.168 * p,
        0.272 - 0.272 * p, 0.534 - 0.534 * p, 0.131 + 0.869 * p
      ]), m);
    }
    if (f.invert) {
      var i = f.invert / 100, d = 1 - 2 * i, io = 255 * i;
      m = compose([d, 0, 0, io, 0, d, 0, io, 0, 0, d, io], m);
    }
    return m;
  }

  function applyMatrix(data, m) {
    for (var i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      var r = data[i], g = data[i + 1], b = data[i + 2];
      data[i] = m[0] * r + m[1] * g + m[2] * b + m[3];
      data[i + 1] = m[4] * r + m[5] * g + m[6] * b + m[7];
      data[i + 2] = m[8] * r + m[9] * g + m[10] * b + m[11];
    }
  }

  /* ---- blur ---- */

  var canvasFilterSupported = (function () {
    var ctx = document.createElement('canvas').getContext('2d');
    if (!('filter' in ctx)) return false;
    ctx.filter = 'blur(2px)';
    return ctx.filter === 'blur(2px)';
  })();

  // Fallback: three box-blur passes on premultiplied pixels approximate a Gaussian.
  function boxBlur(data, w, h, radius) {
    var n = w * h, i;
    var buf = new Float32Array(n * 4), tmp = new Float32Array(n * 4);
    for (i = 0; i < n; i++) {
      var a = data[i * 4 + 3] / 255;
      buf[i * 4] = data[i * 4] * a;
      buf[i * 4 + 1] = data[i * 4 + 1] * a;
      buf[i * 4 + 2] = data[i * 4 + 2] * a;
      buf[i * 4 + 3] = data[i * 4 + 3];
    }
    var r = Math.max(1, Math.round(radius / 1.7));
    for (var pass = 0; pass < 3; pass++) {
      blurLine(buf, tmp, w, h, r, true);
      blurLine(tmp, buf, w, h, r, false);
    }
    for (i = 0; i < n; i++) {
      var al = buf[i * 4 + 3];
      var inv = al > 0 ? 255 / al : 0;
      data[i * 4] = buf[i * 4] * inv;
      data[i * 4 + 1] = buf[i * 4 + 1] * inv;
      data[i * 4 + 2] = buf[i * 4 + 2] * inv;
      data[i * 4 + 3] = al;
    }
  }

  function blurLine(src, dst, w, h, r, horizontal) {
    var len = horizontal ? w : h, lines = horizontal ? h : w;
    var step = horizontal ? 4 : w * 4;
    var scale = 1 / (2 * r + 1);
    for (var l = 0; l < lines; l++) {
      var base = horizontal ? l * w * 4 : l * 4;
      for (var ch = 0; ch < 4; ch++) {
        var sum = 0, k;
        for (k = -r; k <= r; k++) sum += src[base + Math.min(len - 1, Math.max(0, k)) * step + ch];
        for (k = 0; k < len; k++) {
          dst[base + k * step + ch] = sum * scale;
          var add = Math.min(len - 1, k + r + 1), rem = Math.max(0, k - r);
          sum += src[base + add * step + ch] - src[base + rem * step + ch];
        }
      }
    }
  }

  /* ---- sharpen (3×3 unsharp kernel) ---- */

  function sharpen(data, w, h, amount) {
    var a = amount / 100;
    var src = new Uint8ClampedArray(data);
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var i = (y * w + x) * 4;
        for (var c = 0; c < 3; c++) {
          var v = src[i + c] * (1 + 4 * a) -
            a * (src[i - 4 + c] + src[i + 4 + c] + src[i - w * 4 + c] + src[i + w * 4 + c]);
          data[i + c] = v;
        }
      }
    }
  }

  /* ---- main entry ---- */

  function apply(source, f) {
    if (!f || isIdentity(f)) return source;
    var w = source.width, h = source.height;
    var out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    var ctx = out.getContext('2d', { willReadFrequently: true });

    if (f.blur && canvasFilterSupported) {
      ctx.filter = 'blur(' + f.blur + 'px)';
      ctx.drawImage(source, 0, 0);
      ctx.filter = 'none';
    } else {
      ctx.drawImage(source, 0, 0);
    }

    var m = colorMatrix(f);
    var needsPixels = m.join() !== IDENTITY.join() || f.sharpen || (f.blur && !canvasFilterSupported);
    if (needsPixels) {
      var img = ctx.getImageData(0, 0, w, h);
      if (f.blur && !canvasFilterSupported) boxBlur(img.data, w, h, f.blur);
      if (m.join() !== IDENTITY.join()) applyMatrix(img.data, m);
      if (f.sharpen) sharpen(img.data, w, h, f.sharpen);
      ctx.putImageData(img, 0, 0);
    }

    if (f.vignette) {
      var grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.hypot(w, h) / 2);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,' + (f.vignette / 100) * 0.85 + ')');
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    }
    return out;
  }

  global.Filters = { DEFAULTS: DEFAULTS, PRESETS: PRESETS, defaults: defaults, isIdentity: isIdentity, apply: apply };
})(window);
