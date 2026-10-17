/*
 * Image decoding shared by the converter and the editor.
 * Uses the browser's own decoders, plus UTIF.js for TIFF.
 */
(function (global) {
  'use strict';

  function loadImageElement(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight, url: url });
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('decode failed'));
      };
      img.src = url;
    });
  }

  function decodeTiff(bytes) {
    if (!window.UTIF) throw new Error('TIFF decoder not loaded.');
    var buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    var ifds = UTIF.decode(buf);
    // Pick the largest page (TIFFs often carry a small thumbnail first).
    var page = null;
    ifds.forEach(function (ifd) {
      UTIF.decodeImage(buf, ifd, ifds);
      if (!page || ifd.width * ifd.height > page.width * page.height) page = ifd;
    });
    if (!page || !page.width) throw new Error('No image found in TIFF.');
    var rgba = UTIF.toRGBA8(page);
    var c = document.createElement('canvas');
    c.width = page.width;
    c.height = page.height;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, 0, page.width * page.height * 4), page.width, page.height), 0, 0);
    return { source: c, width: c.width, height: c.height, pages: ifds.length };
  }

  function decode(file, bytes, format) {
    if (format.id === 'tiff') {
      return Promise.resolve().then(function () { return decodeTiff(bytes); });
    }
    if (format.id === 'pdf' || format.id === 'eps' || format.id === 'ps' || format.id === 'psd') {
      return Promise.reject(new Error(format.name + ' files can be inspected but not opened as images in the browser.'));
    }
    var blob = file;
    if (format.id === 'svg' && file.type !== 'image/svg+xml') blob = new Blob([bytes], { type: 'image/svg+xml' });
    var viaBitmap = format.id === 'svg' || typeof createImageBitmap !== 'function'
      ? Promise.reject()
      : createImageBitmap(blob).then(function (bmp) { return { source: bmp, width: bmp.width, height: bmp.height }; });
    return viaBitmap.catch(function () {
      return loadImageElement(blob).then(function (r) {
        if (!r.width || !r.height) { // SVG without intrinsic size
          r.width = 1024;
          r.height = 1024;
        }
        return r;
      });
    }).catch(function () {
      var hint = format.id === 'heic' ? ' HEIC opens in Safari; in other browsers convert it on the device first.' : '';
      throw new Error('This browser cannot open ' + format.name + ' files.' + hint);
    });
  }

  // Reads a File and returns its detected format plus a drawable source.
  function load(file) {
    return file.arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf);
      var format = FormatDetect.detect(bytes);
      return decode(file, bytes, format).then(function (img) {
        img.format = format;
        return img;
      });
    });
  }

  global.ImageDecode = { decode: decode, load: load };
})(window);
