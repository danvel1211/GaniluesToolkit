/*
 * Output encoders. Every encoder takes a rendered <canvas> and returns a Blob.
 * PNG/JPEG/WebP/AVIF use the browser's own encoder; the rest are written by hand here
 * so the app needs no server and no external libraries.
 */
(function (global) {
  'use strict';

  /* ---------- helpers ---------- */

  function canvasToBlob(canvas, mime, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob && blob.type === mime) resolve(blob);
        else reject(new Error('This browser cannot encode ' + mime + '.'));
      }, mime, quality);
    });
  }

  function nativeSupport(mime) {
    var c = document.createElement('canvas');
    c.width = c.height = 1;
    return c.toDataURL(mime).indexOf('data:' + mime) === 0;
  }

  function pixels(canvas) {
    return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  }

  function rgbBytes(rgba) {
    var n = rgba.length / 4;
    var out = new Uint8Array(n * 3);
    for (var i = 0, j = 0; i < rgba.length; i += 4) {
      out[j++] = rgba[i];
      out[j++] = rgba[i + 1];
      out[j++] = rgba[i + 2];
    }
    return out;
  }

  function blobToBytes(blob) {
    return blob.arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.readAsDataURL(blob);
    });
  }

  function fmt(n) {
    return (Math.round(n * 1000) / 1000).toString();
  }

  /* ---------- BMP (24-bit, uncompressed) ---------- */

  function encodeBmp(canvas, opts) {
    var w = canvas.width, h = canvas.height, px = pixels(canvas);
    var rowSize = Math.ceil((w * 3) / 4) * 4;
    var dataSize = rowSize * h;
    var buf = new ArrayBuffer(54 + dataSize);
    var dv = new DataView(buf), u8 = new Uint8Array(buf);
    var ppm = Math.round(opts.dpi / 0.0254);
    u8[0] = 0x42; u8[1] = 0x4d;
    dv.setUint32(2, buf.byteLength, true);
    dv.setUint32(10, 54, true);
    dv.setUint32(14, 40, true);
    dv.setInt32(18, w, true);
    dv.setInt32(22, h, true);
    dv.setUint16(26, 1, true);
    dv.setUint16(28, 24, true);
    dv.setUint32(34, dataSize, true);
    dv.setInt32(38, ppm, true);
    dv.setInt32(42, ppm, true);
    for (var y = 0; y < h; y++) {
      var d = 54 + y * rowSize;
      var s = (h - 1 - y) * w * 4; // BMP rows are stored bottom-up
      for (var x = 0; x < w; x++, s += 4) {
        u8[d++] = px[s + 2];
        u8[d++] = px[s + 1];
        u8[d++] = px[s];
      }
    }
    return new Blob([buf], { type: 'image/bmp' });
  }

  /* ---------- TIFF (RGBA, uncompressed) ---------- */

  function encodeTiff(canvas, opts) {
    var w = canvas.width, h = canvas.height, px = pixels(canvas);
    var dataLen = w * h * 4;
    var tags = [
      [256, 4, 1, w], // ImageWidth
      [257, 4, 1, h], // ImageLength
      [258, 3, 4, 'bps'], // BitsPerSample
      [259, 3, 1, 1], // Compression: none
      [262, 3, 1, 2], // Photometric: RGB
      [273, 4, 1, 8], // StripOffsets
      [277, 3, 1, 4], // SamplesPerPixel
      [278, 4, 1, h], // RowsPerStrip
      [279, 4, 1, dataLen], // StripByteCounts
      [282, 5, 1, 'xres'], // XResolution
      [283, 5, 1, 'yres'], // YResolution
      [284, 3, 1, 1], // PlanarConfiguration: chunky
      [296, 3, 1, 2], // ResolutionUnit: inch
      [338, 3, 1, 2] // ExtraSamples: unassociated alpha
    ];
    var ifdOff = 8 + dataLen + (dataLen % 2);
    var extra = ifdOff + 2 + tags.length * 12 + 4;
    var offsets = { bps: extra, xres: extra + 8, yres: extra + 16 };
    var buf = new ArrayBuffer(extra + 24);
    var dv = new DataView(buf), u8 = new Uint8Array(buf);

    u8[0] = 0x49; u8[1] = 0x49; // little-endian
    dv.setUint16(2, 42, true);
    dv.setUint32(4, ifdOff, true);
    u8.set(px, 8);

    dv.setUint16(ifdOff, tags.length, true);
    tags.forEach(function (t, i) {
      var e = ifdOff + 2 + i * 12;
      dv.setUint16(e, t[0], true);
      dv.setUint16(e + 2, t[1], true);
      dv.setUint32(e + 4, t[2], true);
      if (typeof t[3] === 'string') dv.setUint32(e + 8, offsets[t[3]], true);
      else if (t[1] === 3) dv.setUint16(e + 8, t[3], true);
      else dv.setUint32(e + 8, t[3], true);
    });
    dv.setUint32(ifdOff + 2 + tags.length * 12, 0, true); // no next IFD

    for (var i = 0; i < 4; i++) dv.setUint16(offsets.bps + i * 2, 8, true);
    var dpi = Math.round(opts.dpi);
    dv.setUint32(offsets.xres, dpi, true); dv.setUint32(offsets.xres + 4, 1, true);
    dv.setUint32(offsets.yres, dpi, true); dv.setUint32(offsets.yres + 4, 1, true);
    return new Blob([buf], { type: 'image/tiff' });
  }

  /* ---------- ICO (multi-size, PNG-compressed entries) ---------- */

  function encodeIco(canvas) {
    var sizes = [16, 32, 48, 64, 128, 256];
    return Promise.all(sizes.map(function (size) {
      var c = document.createElement('canvas');
      c.width = c.height = size;
      var ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      var scale = Math.min(size / canvas.width, size / canvas.height);
      var dw = Math.max(1, Math.round(canvas.width * scale));
      var dh = Math.max(1, Math.round(canvas.height * scale));
      ctx.drawImage(canvas, Math.floor((size - dw) / 2), Math.floor((size - dh) / 2), dw, dh);
      return canvasToBlob(c, 'image/png').then(blobToBytes);
    })).then(function (pngs) {
      var header = new ArrayBuffer(6 + 16 * pngs.length);
      var dv = new DataView(header);
      dv.setUint16(2, 1, true); // type: icon
      dv.setUint16(4, pngs.length, true);
      var offset = header.byteLength;
      pngs.forEach(function (png, i) {
        var e = 6 + i * 16;
        dv.setUint8(e, sizes[i] >= 256 ? 0 : sizes[i]);
        dv.setUint8(e + 1, sizes[i] >= 256 ? 0 : sizes[i]);
        dv.setUint16(e + 4, 1, true); // colour planes
        dv.setUint16(e + 6, 32, true); // bits per pixel
        dv.setUint32(e + 8, png.length, true);
        dv.setUint32(e + 12, offset, true);
        offset += png.length;
      });
      return new Blob([header].concat(pngs), { type: 'image/x-icon' });
    });
  }

  /* ---------- GIF (median-cut palette, LZW) ---------- */

  function medianCutPalette(px, maxColors) {
    // Histogram over 5 bits per channel.
    var hist = new Uint32Array(32768);
    for (var i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 128) continue;
      hist[((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3)]++;
    }
    var keys = [];
    for (var k = 0; k < 32768; k++) if (hist[k]) keys.push(k);

    function channel(key, c) { return c === 0 ? key >> 10 : c === 1 ? (key >> 5) & 31 : key & 31; }
    function boxInfo(list) {
      var min = [31, 31, 31], max = [0, 0, 0], count = 0;
      list.forEach(function (key) {
        for (var c = 0; c < 3; c++) {
          var v = channel(key, c);
          if (v < min[c]) min[c] = v;
          if (v > max[c]) max[c] = v;
        }
        count += hist[key];
      });
      var ranges = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
      var widest = ranges.indexOf(Math.max.apply(null, ranges));
      return { keys: list, widest: widest, range: ranges[widest], count: count };
    }

    var boxes = keys.length ? [boxInfo(keys)] : [];
    while (boxes.length < maxColors) {
      var pick = -1, best = 0;
      boxes.forEach(function (b, idx) {
        var score = b.range * Math.sqrt(b.count);
        if (b.keys.length > 1 && score > best) { best = score; pick = idx; }
      });
      if (pick < 0) break;
      var box = boxes[pick];
      var c = box.widest;
      box.keys.sort(function (a, b) { return channel(a, c) - channel(b, c); });
      var half = box.count / 2, acc = 0, cut = 0;
      while (cut < box.keys.length - 1) {
        acc += hist[box.keys[cut]];
        cut++;
        if (acc >= half) break;
      }
      boxes.splice(pick, 1, boxInfo(box.keys.slice(0, cut)), boxInfo(box.keys.slice(cut)));
    }

    var lookup = new Uint8Array(32768);
    var palette = boxes.map(function (b, idx) {
      var r = 0, g = 0, bl = 0, n = 0;
      b.keys.forEach(function (key) {
        var cnt = hist[key];
        r += ((key >> 10) * 8 + 4) * cnt;
        g += (((key >> 5) & 31) * 8 + 4) * cnt;
        bl += ((key & 31) * 8 + 4) * cnt;
        n += cnt;
        lookup[key] = idx;
      });
      return [Math.round(r / n), Math.round(g / n), Math.round(bl / n)];
    });
    return { palette: palette, lookup: lookup };
  }

  function lzwEncode(indices, minCodeSize) {
    var out = [];
    var clear = 1 << minCodeSize, eoi = clear + 1;
    var codeSize = minCodeSize + 1, next = eoi + 1;
    var dict = new Map();
    var cur = 0, curBits = 0;
    function emit(code) {
      cur |= code << curBits;
      curBits += codeSize;
      while (curBits >= 8) {
        out.push(cur & 0xff);
        cur >>>= 8;
        curBits -= 8;
      }
    }
    emit(clear);
    var prefix = indices[0];
    for (var i = 1; i < indices.length; i++) {
      var k = indices[i];
      var key = (prefix << 8) | k;
      var found = dict.get(key);
      if (found !== undefined) {
        prefix = found;
        continue;
      }
      emit(prefix);
      if (next === 4096) {
        emit(clear);
        dict.clear();
        codeSize = minCodeSize + 1;
        next = eoi + 1;
      } else {
        if (next >= (1 << codeSize)) codeSize++;
        dict.set(key, next++);
      }
      prefix = k;
    }
    emit(prefix);
    emit(eoi);
    if (curBits > 0) out.push(cur & 0xff);
    return out;
  }

  function encodeGif(canvas) {
    var w = canvas.width, h = canvas.height, px = pixels(canvas);
    var hasTransparency = false;
    for (var i = 3; i < px.length; i += 4) {
      if (px[i] < 128) { hasTransparency = true; break; }
    }
    var q = medianCutPalette(px, hasTransparency ? 255 : 256);
    var transparentIndex = 255;
    var indices = new Uint8Array(w * h);
    for (var p = 0, j = 0; p < px.length; p += 4, j++) {
      indices[j] = px[p + 3] < 128
        ? transparentIndex
        : q.lookup[((px[p] >> 3) << 10) | ((px[p + 1] >> 3) << 5) | (px[p + 2] >> 3)];
    }

    var bytes = [];
    function u16(v) { bytes.push(v & 0xff, (v >> 8) & 0xff); }
    'GIF89a'.split('').forEach(function (ch) { bytes.push(ch.charCodeAt(0)); });
    u16(w); u16(h);
    bytes.push(0xf7, 0, 0); // global colour table, 256 entries
    for (var c = 0; c < 256; c++) {
      var col = q.palette[c] || [0, 0, 0];
      bytes.push(col[0], col[1], col[2]);
    }
    if (hasTransparency) bytes.push(0x21, 0xf9, 4, 1, 0, 0, transparentIndex, 0);
    bytes.push(0x2c); u16(0); u16(0); u16(w); u16(h); bytes.push(0);
    bytes.push(8); // LZW minimum code size
    var data = lzwEncode(indices, 8);
    for (var o = 0; o < data.length; o += 255) {
      var chunk = data.slice(o, o + 255);
      bytes.push(chunk.length);
      for (var b = 0; b < chunk.length; b++) bytes.push(chunk[b]);
    }
    bytes.push(0, 0x3b);
    return new Blob([new Uint8Array(bytes)], { type: 'image/gif' });
  }

  /* ---------- EPS (PostScript level 2, ASCII85 RGB image) ---------- */

  function ascii85(data) {
    var lineLen = 76;
    var maxOut = Math.ceil(data.length / 4) * 5;
    var out = new Uint8Array(maxOut + Math.ceil(maxOut / lineLen) + 3);
    var o = 0, col = 0;
    function put(ch) {
      out[o++] = ch;
      if (++col === lineLen) { out[o++] = 10; col = 0; }
    }
    for (var i = 0; i < data.length; i += 4) {
      var n = Math.min(4, data.length - i);
      var v = ((data[i] << 24) >>> 0) + ((data[i + 1] || 0) << 16) + ((data[i + 2] || 0) << 8) + (data[i + 3] || 0);
      if (n === 4 && v === 0) { put(122); continue; } // 'z'
      var digits = [0, 0, 0, 0, 0];
      for (var d = 4; d >= 0; d--) { digits[d] = v % 85; v = Math.floor(v / 85); }
      for (var k = 0; k <= n; k++) put(digits[k] + 33);
    }
    out[o++] = 126; out[o++] = 62; out[o++] = 10; // '~>'
    return out.subarray(0, o);
  }

  function encodeEps(canvas, opts) {
    var w = canvas.width, h = canvas.height;
    var ptW = (w * 72) / opts.dpi, ptH = (h * 72) / opts.dpi;
    var header = [
      '%!PS-Adobe-3.0 EPSF-3.0',
      '%%Creator: Off the Clock Creative Suite',
      '%%Title: ' + (opts.title || 'image').replace(/[\r\n]/g, ' '),
      '%%BoundingBox: 0 0 ' + Math.ceil(ptW) + ' ' + Math.ceil(ptH),
      '%%HiResBoundingBox: 0 0 ' + fmt(ptW) + ' ' + fmt(ptH),
      '%%LanguageLevel: 2',
      '%%Pages: 1',
      '%%EndComments',
      '%%Page: 1 1',
      'gsave',
      fmt(ptW) + ' ' + fmt(ptH) + ' scale',
      '/DeviceRGB setcolorspace',
      '<< /ImageType 1 /Width ' + w + ' /Height ' + h + ' /BitsPerComponent 8',
      '   /Decode [0 1 0 1 0 1] /ImageMatrix [' + w + ' 0 0 -' + h + ' 0 ' + h + ']',
      '   /DataSource currentfile /ASCII85Decode filter >> image',
      ''
    ].join('\n');
    var footer = 'grestore\nshowpage\n%%EOF\n';
    return new Blob([header, ascii85(rgbBytes(pixels(canvas))), footer], { type: 'application/postscript' });
  }

  /* ---------- PDF (single page, embedded JPEG) ---------- */

  function encodePdf(canvas, opts) {
    return canvasToBlob(canvas, 'image/jpeg', opts.quality).then(blobToBytes).then(function (jpg) {
      var w = canvas.width, h = canvas.height;
      var ptW = fmt((w * 72) / opts.dpi), ptH = fmt((h * 72) / opts.dpi);
      var enc = new TextEncoder();
      var parts = [], offsets = [], pos = 0;
      function add(chunk) {
        var b = typeof chunk === 'string' ? enc.encode(chunk) : chunk;
        parts.push(b);
        pos += b.length;
      }
      function obj(n, body) {
        offsets[n] = pos;
        add(n + ' 0 obj\n' + body + '\nendobj\n');
      }
      add('%PDF-1.4\n');
      add(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
      obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
      obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
      obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + ptW + ' ' + ptH + '] ' +
        '/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');
      offsets[4] = pos;
      add('4 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + w + ' /Height ' + h +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpg.length + ' >>\nstream\n');
      add(jpg);
      add('\nendstream\nendobj\n');
      var content = 'q ' + ptW + ' 0 0 ' + ptH + ' 0 0 cm /Im0 Do Q';
      obj(5, '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream');
      var xref = pos;
      var table = 'xref\n0 6\n0000000000 65535 f \n';
      for (var i = 1; i <= 5; i++) table += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
      add(table + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
      return new Blob(parts, { type: 'application/pdf' });
    });
  }

  /* ---------- SVG (raster wrapped in an SVG container) ---------- */

  function encodeSvg(canvas) {
    return canvasToBlob(canvas, 'image/png').then(blobToDataUrl).then(function (dataUrl) {
      var w = canvas.width, h = canvas.height;
      var svg = '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
        'width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">\n' +
        '  <image width="' + w + '" height="' + h + '" href="' + dataUrl + '" xlink:href="' + dataUrl + '"/>\n' +
        '</svg>\n';
      return new Blob([svg], { type: 'image/svg+xml' });
    });
  }

  /* ---------- registry ---------- */

  // alpha: keeps transparency (otherwise the app flattens onto the background colour first).
  // lossy: the quality slider applies.
  var OUTPUTS = [
    { id: 'png', label: 'PNG', ext: 'png', alpha: true, lossy: false, note: 'Lossless, keeps transparency.',
      encode: function (c) { return canvasToBlob(c, 'image/png'); } },
    { id: 'jpeg', label: 'JPEG', ext: 'jpg', alpha: false, lossy: true, note: 'Small photos, no transparency.',
      encode: function (c, o) { return canvasToBlob(c, 'image/jpeg', o.quality); } },
    { id: 'webp', label: 'WebP', ext: 'webp', alpha: true, lossy: true, native: 'image/webp', note: 'Modern web format, small files.',
      encode: function (c, o) { return canvasToBlob(c, 'image/webp', o.quality); } },
    { id: 'avif', label: 'AVIF', ext: 'avif', alpha: true, lossy: true, native: 'image/avif', note: 'Newest web format (browser support varies).',
      encode: function (c, o) { return canvasToBlob(c, 'image/avif', o.quality); } },
    { id: 'gif', label: 'GIF', ext: 'gif', alpha: true, lossy: false, note: '256 colours, 1-bit transparency.',
      encode: encodeGif },
    { id: 'bmp', label: 'BMP', ext: 'bmp', alpha: false, lossy: false, note: 'Uncompressed 24-bit bitmap.',
      encode: encodeBmp },
    { id: 'tiff', label: 'TIFF', ext: 'tif', alpha: true, lossy: false, note: 'Uncompressed, print / archive friendly.',
      encode: encodeTiff },
    { id: 'ico', label: 'ICO', ext: 'ico', alpha: true, lossy: false, note: 'Favicon / Windows icon (16–256 px, squared).',
      encode: encodeIco },
    { id: 'eps', label: 'EPS', ext: 'eps', alpha: false, lossy: false, note: 'PostScript for print & design apps (raster inside).',
      encode: encodeEps },
    { id: 'pdf', label: 'PDF', ext: 'pdf', alpha: false, lossy: true, note: 'One-page PDF, page sized by DPI.',
      encode: encodePdf },
    { id: 'svg', label: 'SVG', ext: 'svg', alpha: true, lossy: false, note: 'SVG wrapper around the image (not traced to vectors).',
      encode: encodeSvg }
  ];

  OUTPUTS.forEach(function (o) {
    o.supported = o.native ? nativeSupport(o.native) : true;
  });

  function get(id) {
    for (var i = 0; i < OUTPUTS.length; i++) if (OUTPUTS[i].id === id) return OUTPUTS[i];
    return null;
  }

  function encode(id, canvas, opts) {
    var out = get(id);
    if (!out) return Promise.reject(new Error('Unknown output format: ' + id));
    return Promise.resolve().then(function () { return out.encode(canvas, opts); });
  }

  global.Encoders = { list: OUTPUTS, get: get, encode: encode };
})(window);
