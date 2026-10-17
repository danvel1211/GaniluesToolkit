/*
 * Format detection and metadata reading.
 * Identifies a file by its magic bytes (not its extension) and pulls basic EXIF tags from JPEGs.
 */
(function (global) {
  'use strict';

  var FORMATS = {
    jpeg: { name: 'JPEG', mime: 'image/jpeg', exts: ['jpg', 'jpeg', 'jpe', 'jfif'] },
    png: { name: 'PNG', mime: 'image/png', exts: ['png'] },
    gif: { name: 'GIF', mime: 'image/gif', exts: ['gif'] },
    webp: { name: 'WebP', mime: 'image/webp', exts: ['webp'] },
    bmp: { name: 'BMP (Bitmap)', mime: 'image/bmp', exts: ['bmp', 'dib'] },
    ico: { name: 'ICO (Windows icon)', mime: 'image/x-icon', exts: ['ico'] },
    cur: { name: 'CUR (Windows cursor)', mime: 'image/x-icon', exts: ['cur'] },
    tiff: { name: 'TIFF', mime: 'image/tiff', exts: ['tif', 'tiff'] },
    svg: { name: 'SVG (vector)', mime: 'image/svg+xml', exts: ['svg'] },
    avif: { name: 'AVIF', mime: 'image/avif', exts: ['avif'] },
    heic: { name: 'HEIC / HEIF', mime: 'image/heic', exts: ['heic', 'heif'] },
    pdf: { name: 'PDF document', mime: 'application/pdf', exts: ['pdf'] },
    eps: { name: 'EPS (Encapsulated PostScript)', mime: 'application/postscript', exts: ['eps', 'epsf', 'epsi'] },
    ps: { name: 'PostScript', mime: 'application/postscript', exts: ['ps'] },
    psd: { name: 'PSD (Photoshop)', mime: 'image/vnd.adobe.photoshop', exts: ['psd'] },
    unknown: { name: 'Unknown', mime: 'application/octet-stream', exts: [] }
  };

  function ascii(bytes, start, len) {
    var s = '';
    for (var i = start; i < start + len && i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  function startsWith(bytes, sig, offset) {
    offset = offset || 0;
    for (var i = 0; i < sig.length; i++) {
      if (bytes[offset + i] !== sig[i]) return false;
    }
    return true;
  }

  function detect(bytes) {
    var id = 'unknown';
    if (startsWith(bytes, [0xff, 0xd8, 0xff])) id = 'jpeg';
    else if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) id = 'png';
    else if (ascii(bytes, 0, 4) === 'GIF8') id = 'gif';
    else if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') id = 'webp';
    else if (ascii(bytes, 0, 2) === 'BM') id = 'bmp';
    else if (startsWith(bytes, [0, 0, 1, 0])) id = 'ico';
    else if (startsWith(bytes, [0, 0, 2, 0])) id = 'cur';
    else if (startsWith(bytes, [0x49, 0x49, 0x2a, 0]) || startsWith(bytes, [0x4d, 0x4d, 0, 0x2a])) id = 'tiff';
    else if (ascii(bytes, 0, 4) === '%PDF') id = 'pdf';
    else if (startsWith(bytes, [0xc5, 0xd0, 0xd3, 0xc6])) id = 'eps'; // DOS EPS binary header
    else if (ascii(bytes, 0, 4) === '%!PS') id = /EPSF/.test(ascii(bytes, 0, 40)) ? 'eps' : 'ps';
    else if (ascii(bytes, 0, 4) === '8BPS') id = 'psd';
    else if (ascii(bytes, 4, 4) === 'ftyp') {
      var brands = ascii(bytes, 8, 24);
      if (/avi[fs]/.test(brands)) id = 'avif';
      else if (/hei[cxms]|hev[cx]|mif1|msf1/.test(brands)) id = 'heic';
    } else {
      var head = ascii(bytes, 0, 1024).replace(/^﻿/, '').trim();
      if (/^(<\?xml[\s\S]*?)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(head) || /<svg[\s>]/i.test(head)) id = 'svg';
    }
    var f = FORMATS[id];
    return { id: id, name: f.name, mime: f.mime, exts: f.exts };
  }

  /* ---- EXIF (JPEG APP1) ---- */

  var EXIF_TAGS = {
    0x010f: 'Camera make',
    0x0110: 'Camera model',
    0x0112: 'Orientation',
    0x0131: 'Software',
    0x0132: 'Date / time',
    0x013b: 'Artist',
    0x8298: 'Copyright'
  };

  var ORIENTATIONS = {
    1: 'Normal', 2: 'Mirrored', 3: 'Rotated 180°', 4: 'Mirrored vertically',
    5: 'Mirrored + rotated 90° CCW', 6: 'Rotated 90° CW', 7: 'Mirrored + rotated 90° CW', 8: 'Rotated 90° CCW'
  };

  function readExif(bytes) {
    if (!startsWith(bytes, [0xff, 0xd8])) return null;
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var pos = 2;
    while (pos + 4 < bytes.length) {
      if (bytes[pos] !== 0xff) return null;
      var marker = bytes[pos + 1];
      var len = dv.getUint16(pos + 2);
      if (marker === 0xe1 && ascii(bytes, pos + 4, 6) === 'Exif\0\0') {
        try {
          return parseTiffIfd0(dv, pos + 10);
        } catch (e) {
          return null;
        }
      }
      if (marker === 0xda) return null; // start of scan: no more metadata
      pos += 2 + len;
    }
    return null;
  }

  function parseTiffIfd0(dv, tiff) {
    var little = dv.getUint16(tiff) === 0x4949;
    var ifd = tiff + dv.getUint32(tiff + 4, little);
    var count = dv.getUint16(ifd, little);
    var out = {};
    for (var i = 0; i < count; i++) {
      var e = ifd + 2 + i * 12;
      var tag = dv.getUint16(e, little);
      if (!EXIF_TAGS[tag]) continue;
      var type = dv.getUint16(e + 2, little);
      var n = dv.getUint32(e + 4, little);
      var value;
      if (type === 2) {
        var off = n > 4 ? tiff + dv.getUint32(e + 8, little) : e + 8;
        value = '';
        for (var j = 0; j < n - 1; j++) value += String.fromCharCode(dv.getUint8(off + j));
        value = value.replace(/\0+$/, '').trim();
      } else if (type === 3) {
        value = dv.getUint16(e + 8, little);
        if (tag === 0x0112) value = ORIENTATIONS[value] || value;
      }
      if (value !== undefined && value !== '') out[EXIF_TAGS[tag]] = value;
    }
    return Object.keys(out).length ? out : null;
  }

  global.FormatDetect = { detect: detect, readExif: readExif, FORMATS: FORMATS };
})(window);
