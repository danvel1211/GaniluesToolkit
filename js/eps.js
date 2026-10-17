/*
 * EPS reading. A browser can't run PostScript, but most EPS files carry an image we can use:
 *   1. EPS files written by this toolkit (ASCII85 RGB): decoded exactly.
 *   2. Photoshop EPS (%ImageData): the full-resolution pixels, raw, hex or JPEG.
 *   3. A TIFF preview in the DOS EPS header: what Illustrator and Photoshop embed by default.
 *   4. An EPSI preview (%%BeginPreview): a low-resolution greyscale bitmap.
 * Vector-only EPS files without a preview can't be shown.
 */
(function (global) {
  'use strict';

  function latin1(bytes) {
    // Decoding in chunks keeps memory reasonable on large files.
    var out = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return out;
  }

  function canvasFromRGBA(rgba, w, h) {
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0);
    return c;
  }

  function hexToBytes(text, start, count) {
    var out = new Uint8Array(count), n = 0, hi = -1;
    for (var i = start; i < text.length && n < count; i++) {
      var c = text.charCodeAt(i), v;
      if (c >= 48 && c <= 57) v = c - 48;
      else if (c >= 65 && c <= 70) v = c - 55;
      else if (c >= 97 && c <= 102) v = c - 87;
      else continue; // whitespace, '%' comment prefixes, line breaks
      if (hi < 0) hi = v;
      else { out[n++] = (hi << 4) | v; hi = -1; }
    }
    return n === count ? out : null;
  }

  function ascii85Decode(text, start) {
    var end = text.indexOf('~>', start);
    if (end < 0) return null;
    var out = [], group = [];
    for (var i = start; i < end; i++) {
      var c = text.charCodeAt(i);
      if (c === 122 && group.length === 0) { out.push(0, 0, 0, 0); continue; } // 'z'
      if (c < 33 || c > 117) continue;
      group.push(c - 33);
      if (group.length === 5) {
        var v = (((group[0] * 85 + group[1]) * 85 + group[2]) * 85 + group[3]) * 85 + group[4];
        out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
        group = [];
      }
    }
    if (group.length) {
      var n = group.length - 1;
      while (group.length < 5) group.push(84);
      var w = (((group[0] * 85 + group[1]) * 85 + group[2]) * 85 + group[3]) * 85 + group[4];
      var tail = [(w >>> 24) & 255, (w >>> 16) & 255, (w >>> 8) & 255, w & 255];
      for (var k = 0; k < n; k++) out.push(tail[k]);
    }
    return new Uint8Array(out);
  }

  function blobToImage(bytes, mime) {
    var blob = new Blob([bytes], { type: mime });
    return createImageBitmap(blob).then(function (bmp) {
      var c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      bmp.close();
      return c;
    });
  }

  /* ---- 1. this toolkit's own EPS ---- */

  function fromToolkitEps(text) {
    if (text.indexOf('/DataSource currentfile /ASCII85Decode filter >> image') < 0) return null;
    var m = /\/Width (\d+) \/Height (\d+)[\s\S]*?\/ASCII85Decode filter >> image\n/.exec(text);
    if (!m) return null;
    var w = +m[1], h = +m[2];
    var rgb = ascii85Decode(text, m.index + m[0].length);
    if (!rgb || rgb.length < w * h * 3) return null;
    var rgba = new Uint8ClampedArray(w * h * 4);
    for (var i = 0, j = 0; i < w * h; i++, j += 3) {
      rgba[i * 4] = rgb[j];
      rgba[i * 4 + 1] = rgb[j + 1];
      rgba[i * 4 + 2] = rgb[j + 2];
      rgba[i * 4 + 3] = 255;
    }
    return Promise.resolve({ canvas: canvasFromRGBA(rgba, w, h), note: null });
  }

  /* ---- 2. Photoshop %ImageData ---- */

  // %ImageData: columns rows depth mode padChannels blockSize encoding "beginimage"
  // mode: 1 bitmap/grey, 2 Lab, 3 RGB, 4 CMYK · encoding: 1 binary, 2 hex, 3+ JPEG
  function fromPhotoshop(text, bytes) {
    var m = /%ImageData:\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+"([^"]+)"/.exec(text);
    if (!m) return null;
    var w = +m[1], h = +m[2], depth = +m[3], mode = +m[4], pad = +m[5], block = +m[6], enc = +m[7];
    var token = text.indexOf(m[8], m.index + m[0].length);
    if (token < 0) return null;
    var start = token + m[8].length;
    if (text.charAt(start) === '\r') start++;
    if (text.charAt(start) === '\n' || text.charAt(start) === ' ') start++;

    if (enc >= 3) { // JPEG-encoded
      var soi = -1;
      for (var s = start; s < bytes.length - 1 && s < start + 4096; s++) {
        if (bytes[s] === 0xff && bytes[s + 1] === 0xd8) { soi = s; break; }
      }
      if (soi < 0) return null;
      return blobToImage(bytes.subarray(soi), 'image/jpeg').then(function (c) { return { canvas: c, note: null }; });
    }

    var colour = mode === 3 ? 3 : mode === 4 ? 4 : mode === 2 ? 3 : 1;
    var channels = colour + pad;
    if (depth !== 8 && !(depth === 1 && colour === 1)) return null;
    var rowBytes = depth === 1 ? Math.ceil(w / 8) : w;
    var total = rowBytes * h * channels;
    var data = enc === 2 ? hexToBytes(text, start, total) : bytes.subarray(start, start + total);
    if (!data || data.length < total) return null;

    var planar = block > 1; // each row stored channel by channel
    var rgba = new Uint8ClampedArray(w * h * 4);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var px = function (ch) {
          if (depth === 1) {
            var byte = data[(y * channels + ch) * rowBytes + (x >> 3)];
            return (byte >> (7 - (x & 7))) & 1 ? 0 : 255; // Photoshop bitmap: 1 = black
          }
          return planar ? data[(y * channels + ch) * w + x] : data[(y * w + x) * channels + ch];
        };
        var o = (y * w + x) * 4, r, g, b;
        if (colour === 1) { r = g = b = px(0); }
        else if (colour === 4) {
          var c = px(0) / 255, mg = px(1) / 255, yl = px(2) / 255, k = px(3) / 255;
          r = 255 * (1 - c) * (1 - k);
          g = 255 * (1 - mg) * (1 - k);
          b = 255 * (1 - yl) * (1 - k);
        } else if (mode === 2) { r = g = b = px(0); } // Lab: show lightness only
        else { r = px(0); g = px(1); b = px(2); }
        rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
      }
    }
    var note = mode === 2 ? 'Lab colour EPS: shown in greyscale.' : mode === 4 ? 'CMYK EPS: colours converted to RGB approximately.' : null;
    return Promise.resolve({ canvas: canvasFromRGBA(rgba, w, h), note: note });
  }

  /* ---- 3. TIFF preview in the DOS EPS header ---- */

  function fromTiffPreview(bytes) {
    if (!(bytes[0] === 0xc5 && bytes[1] === 0xd0 && bytes[2] === 0xd3 && bytes[3] === 0xc6)) return null;
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var off = dv.getUint32(20, true), len = dv.getUint32(24, true);
    if (!off || !len || off + len > bytes.length || !global.UTIF) return null;
    try {
      var buf = bytes.slice(off, off + len).buffer;
      var ifds = UTIF.decode(buf);
      UTIF.decodeImage(buf, ifds[0], ifds);
      var w = ifds[0].width, h = ifds[0].height;
      var rgba = new Uint8ClampedArray(UTIF.toRGBA8(ifds[0]).buffer, 0, w * h * 4);
      return Promise.resolve({ canvas: canvasFromRGBA(rgba, w, h), note: 'Showing the preview image embedded in the EPS.', preview: true });
    } catch (e) {
      return null;
    }
  }

  /* ---- 4. EPSI preview ---- */

  function fromEpsi(text) {
    var m = /%%BeginPreview:\s*(\d+)\s+(\d+)\s+(\d+)/.exec(text);
    if (!m) return null;
    var w = +m[1], h = +m[2], depth = +m[3];
    if ([1, 2, 4, 8].indexOf(depth) < 0 || !w || !h) return null;
    var rowBytes = Math.ceil((w * depth) / 8);
    var lineEnd = text.indexOf('\n', m.index);
    var data = hexToBytes(text, lineEnd + 1, rowBytes * h);
    if (!data) return null;
    var max = (1 << depth) - 1;
    var rgba = new Uint8ClampedArray(w * h * 4);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var bit = x * depth;
        var v = (data[y * rowBytes + (bit >> 3)] >> (8 - depth - (bit & 7))) & max;
        var g = 255 - Math.round((v / max) * 255); // EPSI previews use 1 (max) = black
        var o = (y * w + x) * 4;
        rgba[o] = rgba[o + 1] = rgba[o + 2] = g;
        rgba[o + 3] = 255;
      }
    }
    return Promise.resolve({ canvas: canvasFromRGBA(rgba, w, h), note: 'Showing the low-resolution black & white preview embedded in the EPS.', preview: true });
  }

  function decode(bytes) {
    var ps = bytes;
    if (bytes[0] === 0xc5 && bytes[1] === 0xd0 && bytes[2] === 0xd3 && bytes[3] === 0xc6) {
      var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      var start = dv.getUint32(4, true), len = dv.getUint32(8, true);
      ps = bytes.subarray(start, Math.min(bytes.length, start + len));
    }
    var text = latin1(ps);
    var attempts = [
      function () { return fromToolkitEps(text); },
      function () { return fromPhotoshop(text, ps); },
      function () { return fromTiffPreview(bytes); },
      function () { return fromEpsi(text); }
    ];
    var i = 0;
    function next() {
      while (i < attempts.length) {
        var p;
        try { p = attempts[i++](); } catch (e) { p = null; }
        if (p) return p.catch(next);
      }
      return Promise.reject(new Error(
        'This EPS has no embedded image or preview, so the browser can\'t display it. ' +
        'Re-save it from Illustrator/Photoshop with a TIFF preview, or export it as PNG/SVG/PDF.'));
    }
    return next();
  }

  global.EpsDecode = { decode: decode };
})(window);
