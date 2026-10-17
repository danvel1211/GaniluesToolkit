/*
 * Image Converter UI: loading files, preview, info, resize/rotate settings and conversion.
 */
(function () {
  'use strict';

  var MAX_SIDE = 16384; // largest canvas side browsers reliably support
  var PREVIEW_SIDE = 2048;

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    items: [],
    selected: null,
    results: [],
    zoom: 'fit',
    nextId: 1,
    settings: {
      format: 'png',
      quality: 90,
      background: '#ffffff',
      dpi: 72,
      resizeMode: 'original',
      percent: 50,
      width: null,
      height: null,
      rotate: 0,
      flipH: false,
      flipV: false
    }
  };

  /* ---------- utilities ---------- */

  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  function gcd(a, b) { return b ? gcd(b, a % b) : a; }

  function aspect(w, h) {
    var g = gcd(w, h);
    var r = w / g + ':' + h / g;
    return (w / g > 50 ? (w / h).toFixed(2) + ':1' : r);
  }

  function baseName(name) {
    return name.replace(/\.[^.]+$/, '') || 'image';
  }

  function extOf(name) {
    var m = /\.([^.]+)$/.exec(name);
    return m ? m[1].toLowerCase() : '';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function setStatus(msg, isError) {
    var el = $('status');
    el.textContent = msg || '';
    el.classList.toggle('error', !!isError);
  }

  var decode = ImageDecode.decode;

  function detectAlpha(item) {
    var scale = Math.min(1, 256 / Math.max(item.width, item.height));
    var w = Math.max(1, Math.round(item.width * scale));
    var h = Math.max(1, Math.round(item.height * scale));
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(item.source, 0, 0, w, h);
    var data = ctx.getImageData(0, 0, w, h).data;
    for (var i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
    return false;
  }

  function makeThumb(item) {
    var c = document.createElement('canvas');
    var s = Math.min(1, 96 / Math.max(item.width, item.height));
    c.width = Math.max(1, Math.round(item.width * s));
    c.height = Math.max(1, Math.round(item.height * s));
    c.getContext('2d').drawImage(item.source, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }

  function addFiles(fileList) {
    var files = Array.prototype.slice.call(fileList);
    if (!files.length) return;
    setStatus('Loading ' + files.length + ' file' + (files.length > 1 ? 's' : '') + '…');
    var jobs = files.map(function (file, index) {
      var item = { id: state.nextId++, file: file, name: file.name || 'pasted-image.png', size: file.size };
      state.items.push(item);
      return file.arrayBuffer().then(function (buf) {
        var bytes = new Uint8Array(buf);
        item.format = FormatDetect.detect(bytes);
        item.exif = FormatDetect.readExif(bytes);
        return decode(file, bytes, item.format);
      }).then(function (img) {
        item.source = img.source;
        item.width = img.width;
        item.height = img.height;
        item.pages = img.pages;
        item.note = img.note;
        item.objectUrl = img.url;
        item.hasAlpha = detectAlpha(item);
        item.thumb = makeThumb(item);
      }).catch(function (err) {
        item.error = err.message || String(err);
      }).then(function () {
        // Show the first file of the batch; later ones only if nothing usable is selected yet.
        if (index === 0 || !state.selected || state.selected.error) select(item);
        renderFileList();
      });
    });
    Promise.all(jobs).then(function () {
      var failed = state.items.filter(function (i) { return i.error; }).length;
      setStatus(failed ? failed + ' file(s) could not be opened as images. You can still see their details.' : '', failed > 0);
      updateButtons();
    });
  }

  function removeItem(item) {
    state.items = state.items.filter(function (i) { return i !== item; });
    if (item.source && item.source.close) item.source.close();
    if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
    if (state.selected === item) select(state.items[0] || null);
    renderFileList();
    updateButtons();
  }

  /* ---------- rendering pipeline ---------- */

  function rotatedBase(item, s) {
    var swap = s.rotate % 180 !== 0;
    return { w: swap ? item.height : item.width, h: swap ? item.width : item.height };
  }

  function targetSize(item, s) {
    var b = rotatedBase(item, s);
    var w = b.w, h = b.h;
    if (s.resizeMode === 'percent') {
      w = b.w * s.percent / 100;
      h = b.h * s.percent / 100;
    } else if (s.resizeMode === 'fit' && (s.width || s.height)) {
      var k = Math.min(s.width ? s.width / b.w : Infinity, s.height ? s.height / b.h : Infinity);
      w = b.w * k;
      h = b.h * k;
    } else if (s.resizeMode === 'exact') {
      w = s.width || b.w;
      h = s.height || b.h;
    }
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    var clamp = Math.min(1, MAX_SIDE / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * clamp)), h: Math.max(1, Math.round(h * clamp)), clamped: clamp < 1 };
  }

  function render(item, s, maxSide) {
    var size = targetSize(item, s);
    var w = size.w, h = size.h;
    if (maxSide && Math.max(w, h) > maxSide) {
      var k = maxSide / Math.max(w, h);
      w = Math.max(1, Math.round(w * k));
      h = Math.max(1, Math.round(h * k));
    }
    var out = Encoders.get(s.format);
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    if (out && !out.alpha) {
      ctx.fillStyle = s.background;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(w / 2, h / 2);
    ctx.scale(s.flipH ? -1 : 1, s.flipV ? -1 : 1);
    ctx.rotate((s.rotate * Math.PI) / 180);
    var swap = s.rotate % 180 !== 0;
    var dw = swap ? h : w, dh = swap ? w : h;
    ctx.drawImage(stepDown(item, dw, dh), -dw / 2, -dh / 2, dw, dh);
    return c;
  }

  // Large downscales look much better when halved in steps instead of one jump.
  function stepDown(item, dw, dh) {
    var src = item.source, sw = item.width, sh = item.height;
    while (sw / 2 >= dw && sh / 2 >= dh) {
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(sw / 2));
      c.height = Math.max(1, Math.round(sh / 2));
      var ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0, c.width, c.height);
      src = c; sw = c.width; sh = c.height;
    }
    return src;
  }

  /* ---------- UI rendering ---------- */

  function renderFileList() {
    var ul = $('file-list');
    ul.innerHTML = '';
    state.items.forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'file-item' + (item === state.selected ? ' active' : '') + (item.error ? ' has-error' : '');
      var thumb = item.thumb
        ? '<img src="' + item.thumb + '" alt="">'
        : '<span class="thumb-ph">' + escapeHtml(item.format ? item.format.exts[0] || '?' : '…') + '</span>';
      var meta = item.error ? 'Cannot open' : item.width
        ? item.width + '×' + item.height + ' · ' + formatBytes(item.size)
        : 'Loading…';
      li.innerHTML =
        '<button type="button" class="file-select">' +
          '<span class="thumb">' + thumb + '</span>' +
          '<span class="file-text"><span class="file-name">' + escapeHtml(item.name) + '</span>' +
          '<span class="file-meta">' + escapeHtml((item.format ? item.format.name.split(' ')[0] + ' · ' : '') + meta) + '</span></span>' +
        '</button>' +
        '<button type="button" class="icon-btn" aria-label="Remove ' + escapeHtml(item.name) + '">×</button>';
      li.querySelector('.file-select').onclick = function () { select(item); };
      li.querySelector('.icon-btn').onclick = function () { removeItem(item); };
      ul.appendChild(li);
    });
    $('file-actions').hidden = state.items.length === 0;
  }

  function select(item) {
    state.selected = item;
    state.zoom = 'fit';
    renderFileList();
    renderInfo();
    renderPreview();
    updateButtons();
  }

  function renderInfo() {
    var item = state.selected;
    var tbody = $('info-table').tBodies[0];
    if (!item) {
      tbody.innerHTML = '<tr><td class="muted">Select a file to see its details.</td></tr>';
      return;
    }
    var rows = [['Name', item.name], ['File size', formatBytes(item.size) + ' (' + item.size.toLocaleString() + ' bytes)']];
    if (item.format) {
      rows.push(['Format', item.format.name]);
      rows.push(['MIME type', item.format.mime]);
      var ext = extOf(item.name);
      if (ext && item.format.exts.length && item.format.exts.indexOf(ext) < 0) {
        rows.push(['Warning', '.' + ext + ' extension, but the content is ' + item.format.name]);
      }
    }
    if (item.width) {
      rows.push(['Dimensions', item.width + ' × ' + item.height + ' px']);
      rows.push(['Megapixels', (item.width * item.height / 1e6).toFixed(2) + ' MP']);
      rows.push(['Aspect ratio', aspect(item.width, item.height)]);
      rows.push(['Transparency', item.hasAlpha ? 'Yes' : 'No']);
      if (item.pages > 1) rows.push(['Pages', item.pages + ' (largest shown)']);
    }
    if (item.file.lastModified) rows.push(['Modified', new Date(item.file.lastModified).toLocaleString()]);
    if (item.exif) Object.keys(item.exif).forEach(function (k) { rows.push([k, item.exif[k]]); });
    if (item.note) rows.push(['Note', item.note]);
    if (item.error) rows.push(['Status', item.error]);
    tbody.innerHTML = rows.map(function (r) {
      var cls = r[0] === 'Warning' || r[0] === 'Status' || r[0] === 'Note' ? ' class="warn"' : '';
      return '<tr' + cls + '><th scope="row">' + escapeHtml(r[0]) + '</th><td>' + escapeHtml(r[1]) + '</td></tr>';
    }).join('');
  }

  function renderPreview() {
    var item = state.selected;
    var canvas = $('preview');
    var usable = item && item.source;
    $('empty-state').hidden = !!usable;
    canvas.hidden = !usable;
    if (!usable) {
      $('empty-state').innerHTML = item && item.error
        ? '<p><strong>Preview unavailable</strong></p><p>' + escapeHtml(item.error) + '</p>'
        : '<p><strong>No image selected</strong></p><p>Add a JPEG, PNG, WebP, GIF, BMP, TIFF, ICO, SVG, AVIF or HEIC file to start.</p>';
      $('stage-caption').textContent = '';
      $('output-size').textContent = '';
      return;
    }
    var s = state.settings;
    var size = targetSize(item, s);
    var r = render(item, s, PREVIEW_SIDE);
    canvas.width = r.width;
    canvas.height = r.height;
    canvas.getContext('2d').drawImage(r, 0, 0);
    applyZoom(size);
    $('output-size').innerHTML = 'Output: <strong>' + size.w + ' × ' + size.h + ' px</strong>' +
      (size.clamped ? ' <span class="warn-text">(limited to ' + MAX_SIDE + ' px)</span>' : '');
    $('stage-caption').textContent = 'Original ' + item.width + ' × ' + item.height + ' px  →  ' +
      Encoders.get(s.format).label + ' ' + size.w + ' × ' + size.h + ' px';
  }

  function applyZoom(size) {
    var canvas = $('preview');
    var stage = $('stage');
    size = size || targetSize(state.selected, state.settings);
    if (state.zoom === 'fit') {
      var k = Math.min(1, (stage.clientWidth - 32) / size.w, (stage.clientHeight - 32) / size.h);
      canvas.style.width = Math.max(1, size.w * k) + 'px';
      canvas.style.height = Math.max(1, size.h * k) + 'px';
      $('zoom-level').textContent = 'Fit (' + Math.round(k * 100) + '%)';
      stage.classList.remove('zoomed');
    } else {
      canvas.style.width = size.w * state.zoom + 'px';
      canvas.style.height = size.h * state.zoom + 'px';
      $('zoom-level').textContent = Math.round(state.zoom * 100) + '%';
      stage.classList.add('zoomed');
    }
  }

  function currentScale() {
    if (state.zoom !== 'fit') return state.zoom;
    var size = targetSize(state.selected, state.settings);
    return parseFloat($('preview').style.width) / size.w;
  }

  function renderFormats() {
    var grid = $('format-grid');
    grid.innerHTML = '';
    Encoders.list.forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'format-btn';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(o.id === state.settings.format));
      b.textContent = o.label;
      if (!o.supported) {
        b.disabled = true;
        b.title = 'Not supported by this browser';
      }
      b.onclick = function () {
        state.settings.format = o.id;
        renderFormats();
        renderPreview();
      };
      grid.appendChild(b);
    });
    var out = Encoders.get(state.settings.format);
    $('format-note').textContent = out.note;
    $('quality-field').hidden = !out.lossy;
    $('bg-field').hidden = out.alpha;
    $('bg-hint').hidden = out.alpha;
    $('dpi-field').hidden = ['eps', 'pdf', 'tiff', 'bmp'].indexOf(out.id) < 0;
  }

  function renderResizeFields() {
    var mode = state.settings.resizeMode;
    $('percent-field').hidden = mode !== 'percent';
    $('dims-field').hidden = mode !== 'fit' && mode !== 'exact';
    $('preset-chips').hidden = mode !== 'fit' && mode !== 'exact';
  }

  function renderResults() {
    var ul = $('result-list');
    ul.innerHTML = '';
    state.results.forEach(function (r) {
      var li = document.createElement('li');
      li.className = 'result-item';
      li.innerHTML =
        '<span class="badge">' + escapeHtml(r.label) + '</span>' +
        '<span class="file-text"><span class="file-name">' + escapeHtml(r.name) + '</span>' +
        '<span class="file-meta">' + r.width + '×' + r.height + ' · ' + formatBytes(r.blob.size) + '</span></span>' +
        '<a class="btn small" href="' + r.url + '" download="' + escapeHtml(r.name) + '">Download</a>' +
        '<button type="button" class="icon-btn" aria-label="Remove">×</button>';
      li.querySelector('.icon-btn').onclick = function () {
        URL.revokeObjectURL(r.url);
        state.results = state.results.filter(function (x) { return x !== r; });
        renderResults();
      };
      ul.appendChild(li);
    });
    $('results-empty').hidden = state.results.length > 0;
    $('result-actions').hidden = state.results.length === 0;
  }

  function updateButtons() {
    var ready = state.items.filter(function (i) { return i.source; });
    $('convert-one').disabled = !(state.selected && state.selected.source);
    $('convert-all').disabled = ready.length < 2;
  }

  /* ---------- conversion ---------- */

  function convert(item) {
    var s = state.settings;
    var out = Encoders.get(s.format);
    var canvas = render(item, s);
    var opts = { quality: s.quality / 100, dpi: s.dpi || 72, title: item.name };
    return Encoders.encode(s.format, canvas, opts).then(function (blob) {
      var result = {
        name: baseName(item.name) + '.' + out.ext,
        label: out.label,
        blob: blob,
        url: URL.createObjectURL(blob),
        width: canvas.width,
        height: canvas.height
      };
      state.results.unshift(result);
      renderResults();
      return result;
    });
  }

  function convertMany(items) {
    var buttons = [$('convert-one'), $('convert-all')];
    buttons.forEach(function (b) { b.disabled = true; });
    var done = 0, failed = 0;
    var chain = Promise.resolve();
    items.forEach(function (item) {
      chain = chain.then(function () {
        setStatus('Converting ' + (done + 1) + ' of ' + items.length + '…');
        // Let the status message paint before the heavy work starts.
        return new Promise(function (r) { setTimeout(r, 30); });
      }).then(function () {
        return convert(item);
      }).then(function () {
        done++;
      }, function (err) {
        done++;
        failed++;
        console.error(err);
        setStatus(item.name + ': ' + err.message, true);
      });
    });
    return chain.then(function () {
      if (!failed) setStatus('Done. ' + items.length + ' file' + (items.length > 1 ? 's' : '') + ' converted.');
      updateButtons();
    });
  }

  /* ---------- event wiring ---------- */

  function bind() {
    var input = $('file-input');
    input.onchange = function () { addFiles(input.files); input.value = ''; };

    var dz = $('dropzone');
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('over'); });
    });
    dz.addEventListener('drop', function (e) { addFiles(e.dataTransfer.files); });
    dz.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    // Allow dropping anywhere on the page.
    document.addEventListener('dragover', function (e) { e.preventDefault(); });
    document.addEventListener('drop', function (e) {
      e.preventDefault();
      if (!dz.contains(e.target) && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    });
    document.addEventListener('paste', function (e) {
      var files = Array.prototype.filter.call(e.clipboardData.files || [], function (f) { return /^image\//.test(f.type); });
      if (files.length) addFiles(files);
    });

    $('clear-files').onclick = function () {
      state.items.slice().forEach(removeItem);
    };

    var s = state.settings;
    $('quality').oninput = function () {
      s.quality = +this.value;
      $('quality-out').textContent = this.value;
    };
    $('background').oninput = function () { s.background = this.value; renderPreview(); };
    $('dpi').oninput = function () { s.dpi = Math.min(2400, Math.max(1, +this.value || 72)); };

    $('resize-mode').onchange = function () {
      s.resizeMode = this.value;
      renderResizeFields();
      renderPreview();
    };
    $('percent').oninput = function () {
      s.percent = +this.value;
      $('percent-out').textContent = this.value + '%';
      renderPreview();
    };
    Array.prototype.forEach.call(document.querySelectorAll('[data-percent]'), function (b) {
      b.onclick = function () {
        $('percent').value = b.dataset.percent;
        $('percent').oninput();
      };
    });
    $('width').oninput = function () { s.width = +this.value || null; renderPreview(); };
    $('height').oninput = function () { s.height = +this.value || null; renderPreview(); };
    Array.prototype.forEach.call(document.querySelectorAll('[data-size]'), function (b) {
      b.onclick = function () {
        var p = b.dataset.size.split('x');
        $('width').value = p[0];
        $('height').value = p[1];
        s.width = +p[0];
        s.height = +p[1];
        renderPreview();
      };
    });

    $('rotate-left').onclick = function () { s.rotate = (s.rotate + 270) % 360; renderPreview(); };
    $('rotate-right').onclick = function () { s.rotate = (s.rotate + 90) % 360; renderPreview(); };
    $('flip-h').onclick = function () {
      s.flipH = !s.flipH;
      this.setAttribute('aria-pressed', String(s.flipH));
      renderPreview();
    };
    $('flip-v').onclick = function () {
      s.flipV = !s.flipV;
      this.setAttribute('aria-pressed', String(s.flipV));
      renderPreview();
    };
    $('reset-transform').onclick = function () {
      s.rotate = 0; s.flipH = false; s.flipV = false;
      $('flip-h').setAttribute('aria-pressed', 'false');
      $('flip-v').setAttribute('aria-pressed', 'false');
      renderPreview();
    };

    Array.prototype.forEach.call(document.querySelectorAll('[data-zoom]'), function (b) {
      b.onclick = function () {
        if (!state.selected || !state.selected.source) return;
        var z = b.dataset.zoom;
        if (z === 'fit') state.zoom = 'fit';
        else if (z === '100') state.zoom = 1;
        else {
          var cur = currentScale();
          state.zoom = Math.min(8, Math.max(0.05, z === 'in' ? cur * 1.25 : cur / 1.25));
        }
        applyZoom();
      };
    });
    window.addEventListener('resize', function () {
      if (state.selected && state.selected.source && state.zoom === 'fit') applyZoom();
    });

    $('convert-one').onclick = function () {
      if (state.selected && state.selected.source) convertMany([state.selected]);
    };
    $('convert-all').onclick = function () {
      convertMany(state.items.filter(function (i) { return i.source; }));
    };

    $('download-all').onclick = function () {
      state.results.forEach(function (r, i) {
        setTimeout(function () {
          var a = document.createElement('a');
          a.href = r.url;
          a.download = r.name;
          document.body.appendChild(a);
          a.click();
          a.remove();
        }, i * 300);
      });
    };
    $('clear-results').onclick = function () {
      state.results.forEach(function (r) { URL.revokeObjectURL(r.url); });
      state.results = [];
      renderResults();
    };
  }

  renderFormats();
  renderResizeFields();
  renderResults();
  bind();
})();
