/*
 * File combination: merge PDFs and images into one PDF and arrange the pages.
 * pdf.js renders the thumbnails; pdf-lib copies the original pages into the new file,
 * so text, links and vector graphics are kept as they are (nothing is re-rendered).
 */
(function () {
  'use strict';

  var COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#0ea5e9', '#a855f7', '#ec4899', '#14b8a6'];
  var PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792] };
  var IMAGE_MARGIN = 24; // points around images placed on A4/Letter pages

  var $ = function (id) { return document.getElementById(id); };

  // pdf.js runs in this page (its worker script is loaded as a normal script), which also works
  // when the app is opened straight from disk.
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/vendor/pdf.worker.min.js';

  var state = {
    files: [], // { id, name, color, kind: 'pdf' | 'image', bytes, pdf, pageCount, image }
    pages: [], // { id, fileId, index, rotation, pdfPage }: one entry per page in the output order
    selected: new Set(),
    anchor: null, // last clicked page id, for Shift+click ranges
    nextId: 1,
    busy: false
  };

  /* ---------- helpers ---------- */

  var toastTimer;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3000);
  }

  function setStatus(msg, isError) {
    $('status').textContent = msg || '';
    $('status').classList.toggle('error', !!isError);
  }

  function fileOf(page) {
    for (var i = 0; i < state.files.length; i++) if (state.files[i].id === page.fileId) return state.files[i];
    return null;
  }

  function pageIndexById(id) {
    for (var i = 0; i < state.pages.length; i++) if (state.pages[i].id === id) return i;
    return -1;
  }

  function isPdf(file) {
    return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  }

  function baseName(name) {
    return name.replace(/\.[^.]+$/, '');
  }

  /* ---------- loading ---------- */

  function addFiles(list) {
    var files = Array.prototype.slice.call(list).filter(function (f) {
      return isPdf(f) || /^image\//.test(f.type);
    });
    if (!files.length) { toast('Add PDF files or images (JPG, PNG, WebP, GIF, BMP).'); return; }
    var chain = Promise.resolve();
    files.forEach(function (f) {
      chain = chain.then(function () { return loadFile(f); }).catch(function (err) {
        toast(f.name + ': ' + err.message);
      });
    });
    chain.then(function () {
      if (state.files.length && $('out-name').value === 'combined' && state.files.length === 1) {
        $('out-name').value = baseName(state.files[0].name) + '-combined';
      }
    });
  }

  function loadFile(f) {
    var entry = {
      id: state.nextId++,
      name: f.name,
      color: COLORS[state.files.length % COLORS.length],
      kind: isPdf(f) ? 'pdf' : 'image'
    };
    return f.arrayBuffer().then(function (buf) {
      entry.bytes = new Uint8Array(buf);
      return entry.kind === 'pdf' ? loadPdf(entry) : loadImage(entry, f);
    }).then(function () {
      state.files.push(entry);
      renderFiles();
      renderPages();
    });
  }

  function loadPdf(entry) {
    // pdf.js takes ownership of the buffer it's given, so hand it a copy.
    return pdfjsLib.getDocument({ data: entry.bytes.slice(0), isEvalSupported: false }).promise.then(function (pdf) {
      entry.pdf = pdf;
      entry.pageCount = pdf.numPages;
      var pages = [];
      var chain = Promise.resolve();
      for (var i = 0; i < pdf.numPages; i++) {
        (function (index) {
          chain = chain.then(function () { return pdf.getPage(index + 1); }).then(function (pg) {
            pages.push({ id: state.nextId++, fileId: entry.id, index: index, rotation: 0, pdfPage: pg });
          });
        })(i);
      }
      return chain.then(function () {
        entry.thumbs = [];
        entry.protos = pages.map(function (p) { return Object.assign({}, p); });
        state.pages = state.pages.concat(pages);
        renderThumbs(entry);
      });
    }, function (err) {
      if (err && err.name === 'PasswordException') throw new Error('This PDF is password-protected. Remove the password first.');
      throw new Error('This doesn\'t look like a valid PDF.');
    });
  }

  function loadImage(entry, f) {
    return createImageBitmap(f).then(function (bmp) {
      var c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      bmp.close();
      entry.image = c;
      entry.pageCount = 1;
      entry.thumbs = [scaledCopy(c, 260)];
      var page = { id: state.nextId++, fileId: entry.id, index: 0, rotation: 0 };
      entry.protos = [Object.assign({}, page)];
      state.pages.push(page);
    }, function () {
      throw new Error('This image format can\'t be opened here.');
    });
  }

  function scaledCopy(src, max) {
    var k = Math.min(1, max / Math.max(src.width, src.height));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(src.width * k));
    c.height = Math.max(1, Math.round(src.height * k));
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  // Thumbnails render one at a time so large PDFs stay responsive.
  var thumbQueue = Promise.resolve();
  function renderThumbs(entry) {
    entry.protos.forEach(function (proto) {
      thumbQueue = thumbQueue.then(function () {
        if (state.files.indexOf(entry) < 0 && state.pages.every(function (p) { return p.fileId !== entry.id; })) return;
        return renderPdfPage(proto.pdfPage, 260, 0).then(function (c) {
          entry.thumbs[proto.index] = c;
          updateThumbs(entry.id, proto.index);
        });
      }).catch(function () { /* keep the placeholder */ });
    });
  }

  function renderPdfPage(pg, maxSide, extraRotation) {
    var vp1 = pg.getViewport({ scale: 1, rotation: (pg.rotate + extraRotation) % 360 });
    var scale = maxSide / Math.max(vp1.width, vp1.height);
    var vp = pg.getViewport({ scale: scale, rotation: (pg.rotate + extraRotation) % 360 });
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(vp.width));
    c.height = Math.max(1, Math.round(vp.height));
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    return pg.render({ canvasContext: ctx, viewport: vp }).promise.then(function () { return c; });
  }

  /* ---------- rendering ---------- */

  function renderFiles() {
    var ul = $('file-list');
    ul.innerHTML = '';
    state.files.forEach(function (f) {
      var count = state.pages.filter(function (p) { return p.fileId === f.id; }).length;
      var li = document.createElement('li');
      li.className = 'pdf-file';
      li.innerHTML =
        '<span class="file-dot" style="background:' + f.color + '"></span>' +
        '<span class="file-text"><span class="file-name"></span>' +
        '<span class="file-meta">' + (f.kind === 'pdf' ? 'PDF' : 'Image') + ' · ' + count + ' of ' + f.pageCount + ' page' + (f.pageCount === 1 ? '' : 's') + '</span></span>' +
        '<button type="button" class="icon-btn" aria-label="Remove file">×</button>';
      li.querySelector('.file-name').textContent = f.name;
      li.querySelector('.file-name').title = f.name;
      li.querySelector('.icon-btn').onclick = function () { removeFile(f); };
      ul.appendChild(li);
    });
    $('files-hint').hidden = state.files.length > 0;
  }

  function removeFile(f) {
    state.files = state.files.filter(function (x) { return x !== f; });
    state.pages = state.pages.filter(function (p) {
      if (p.fileId !== f.id) return true;
      state.selected.delete(p.id);
      return false;
    });
    if (f.pdf) f.pdf.destroy();
    renderFiles();
    renderPages();
  }

  function renderPages() {
    var grid = $('page-grid');
    grid.innerHTML = '';
    state.pages.forEach(function (p, i) {
      grid.appendChild(pageCard(p, i));
    });
    $('empty-state').hidden = state.pages.length > 0;
    $('page-count').textContent = state.pages.length ? '(' + state.pages.length + ')' : '';
    $('sum-pages').textContent = state.pages.length;
    $('sum-files').textContent = state.files.length;
    $('download-all').disabled = !state.pages.length;
    updateSelectionUi();
    renderFiles();
  }

  function pageCard(p, i) {
    var f = fileOf(p);
    var li = document.createElement('li');
    li.className = 'page-card' + (state.selected.has(p.id) ? ' selected' : '');
    li.dataset.id = p.id;
    li.draggable = true;
    li.tabIndex = 0;
    li.style.setProperty('--file-color', f.color);
    li.setAttribute('aria-label', 'Page ' + (i + 1) + ': ' + f.name + ' page ' + (p.index + 1));
    li.innerHTML =
      '<div class="page-thumb"><div class="page-paper"></div>' +
      '<div class="page-hover">' +
        '<button type="button" class="mini" data-act="rot" title="Rotate" aria-label="Rotate page">⟳</button>' +
        '<button type="button" class="mini" data-act="del" title="Delete" aria-label="Delete page">×</button>' +
      '</div>' +
      '<span class="page-num">' + (i + 1) + '</span></div>' +
      '<div class="page-caption"><span class="file-dot"></span><span class="page-src"></span></div>';
    li.querySelector('.page-src').textContent = baseName(f.name) + (f.kind === 'pdf' ? ' · p.' + (p.index + 1) : '');
    li.querySelector('.page-src').title = f.name;
    fillThumb(li, p);

    li.addEventListener('click', function (e) {
      var act = e.target.dataset && e.target.dataset.act;
      if (act === 'rot') { rotatePages([p.id], 90); return; }
      if (act === 'del') { deletePages([p.id]); return; }
      selectPage(p.id, e);
    });
    li.addEventListener('dblclick', function (e) {
      if (e.target.dataset && e.target.dataset.act) return;
      openPreview(p.id);
    });
    li.addEventListener('dragstart', onDragStart);
    li.addEventListener('dragend', onDragEnd);
    return li;
  }

  function fillThumb(li, p) {
    var paper = li.querySelector('.page-paper');
    paper.innerHTML = '';
    var rot = p.rotation % 360;
    paper.style.transform = rot ? 'rotate(' + rot + 'deg)' : '';
    paper.classList.toggle('sideways', rot === 90 || rot === 270);
    var thumb = fileOf(p).thumbs[p.index];
    if (thumb) {
      var c = document.createElement('canvas');
      c.width = thumb.width;
      c.height = thumb.height;
      c.getContext('2d').drawImage(thumb, 0, 0);
      paper.appendChild(c);
    } else {
      paper.innerHTML = '<span class="thumb-loading"></span>';
    }
  }

  function updateThumbs(fileId, index) {
    state.pages.forEach(function (p) {
      if (p.fileId !== fileId || p.index !== index) return;
      var li = $('page-grid').querySelector('[data-id="' + p.id + '"]');
      if (li) fillThumb(li, p);
    });
  }

  /* ---------- selection ---------- */

  function selectPage(id, e) {
    if (e && e.shiftKey && state.anchor !== null) {
      var a = pageIndexById(state.anchor), b = pageIndexById(id);
      if (!(e.ctrlKey || e.metaKey)) state.selected.clear();
      for (var i = Math.min(a, b); i <= Math.max(a, b); i++) state.selected.add(state.pages[i].id);
    } else if (e && (e.ctrlKey || e.metaKey)) {
      if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
      state.anchor = id;
    } else {
      state.selected.clear();
      state.selected.add(id);
      state.anchor = id;
    }
    refreshSelection();
  }

  function refreshSelection() {
    Array.prototype.forEach.call($('page-grid').children, function (li) {
      li.classList.toggle('selected', state.selected.has(+li.dataset.id));
    });
    updateSelectionUi();
  }

  function updateSelectionUi() {
    var n = state.selected.size;
    ['act-rot-left', 'act-rot-right', 'act-earlier', 'act-later', 'act-dup', 'act-delete'].forEach(function (id) {
      $(id).disabled = !n;
    });
    $('download-selected').disabled = !n;
    $('selection-bar').textContent = n ? n + ' page' + (n === 1 ? '' : 's') + ' selected' : '';
  }

  function selectedIds() {
    return state.pages.filter(function (p) { return state.selected.has(p.id); }).map(function (p) { return p.id; });
  }

  /* ---------- page operations ---------- */

  function rotatePages(ids, deg) {
    ids.forEach(function (id) {
      var p = state.pages[pageIndexById(id)];
      p.rotation = (p.rotation + deg + 360) % 360;
      var li = $('page-grid').querySelector('[data-id="' + id + '"]');
      if (li) fillThumb(li, p);
    });
  }

  function deletePages(ids) {
    state.pages = state.pages.filter(function (p) { return ids.indexOf(p.id) < 0; });
    ids.forEach(function (id) { state.selected.delete(id); });
    renderPages();
  }

  function duplicatePages(ids) {
    var copies = [];
    ids.slice().reverse().forEach(function (id) {
      var i = pageIndexById(id), p = state.pages[i];
      var copy = Object.assign({}, p, { id: state.nextId++ });
      state.pages.splice(i + 1, 0, copy);
      copies.push(copy.id);
    });
    state.selected = new Set(copies);
    renderPages();
  }

  // Moves the given pages so they sit together, in their current order, at index `to`.
  function movePagesTo(ids, to) {
    var moving = state.pages.filter(function (p) { return ids.indexOf(p.id) >= 0; });
    var before = state.pages.slice(0, to).filter(function (p) { return ids.indexOf(p.id) < 0; }).length;
    var rest = state.pages.filter(function (p) { return ids.indexOf(p.id) < 0; });
    state.pages = rest.slice(0, before).concat(moving, rest.slice(before));
    renderPages();
  }

  function shiftSelection(delta) {
    var ids = selectedIds();
    if (!ids.length) return;
    var first = pageIndexById(ids[0]), last = pageIndexById(ids[ids.length - 1]);
    if (delta < 0 && first > 0) movePagesTo(ids, first - 1);
    if (delta > 0 && last < state.pages.length - 1) movePagesTo(ids, last + 2);
  }

  function reverseOrder() {
    state.pages.reverse();
    renderPages();
  }

  // Every page of every file, in file order, unrotated: also brings back deleted pages.
  function resetOrder() {
    state.pages = [];
    state.files.forEach(function (f) {
      f.protos.forEach(function (proto) { state.pages.push(Object.assign({}, proto, { rotation: 0 })); });
    });
    state.selected.clear();
    renderPages();
    toast('Back to the original pages and order.');
  }

  /* ---------- drag and drop ---------- */

  var dragIds = null;
  var dropIndex = -1;
  var marker = document.createElement('li');
  marker.className = 'drop-marker';
  marker.setAttribute('aria-hidden', 'true');

  function onDragStart(e) {
    var id = +this.dataset.id;
    if (!state.selected.has(id)) {
      state.selected.clear();
      state.selected.add(id);
      state.anchor = id;
      refreshSelection();
    }
    dragIds = selectedIds();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/x-pages', dragIds.join(','));
    if (dragIds.length > 1) {
      var ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      ghost.textContent = dragIds.length + ' pages';
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 40, 20);
      setTimeout(function () { ghost.remove(); }, 0);
    }
    var self = this;
    setTimeout(function () {
      Array.prototype.forEach.call($('page-grid').children, function (li) {
        if (dragIds && dragIds.indexOf(+li.dataset.id) >= 0) li.classList.add('dragging');
      });
      if (!self.isConnected) return;
    }, 0);
  }

  function onDragEnd() {
    dragIds = null;
    marker.remove();
    Array.prototype.forEach.call($('page-grid').querySelectorAll('.dragging'), function (li) { li.classList.remove('dragging'); });
  }

  function bindGridDrop() {
    var grid = $('page-grid');
    grid.addEventListener('dragover', function (e) {
      if (!dragIds) return;
      e.preventDefault();
      var cards = Array.prototype.filter.call(grid.children, function (li) { return li.classList.contains('page-card'); });
      var idx = cards.length;
      for (var i = 0; i < cards.length; i++) {
        var r = cards[i].getBoundingClientRect();
        var sameRow = e.clientY >= r.top && e.clientY <= r.bottom;
        if ((sameRow && e.clientX < r.left + r.width / 2) || e.clientY < r.top) { idx = i; break; }
      }
      dropIndex = idx;
      if (idx < cards.length) grid.insertBefore(marker, cards[idx]); else grid.appendChild(marker);
    });
    grid.addEventListener('drop', function (e) {
      if (!dragIds) return;
      e.preventDefault();
      var ids = dragIds;
      onDragEnd();
      movePagesTo(ids, dropIndex);
    });
    grid.addEventListener('dragleave', function (e) {
      if (!grid.contains(e.relatedTarget)) marker.remove();
    });
  }

  /* ---------- preview ---------- */

  var previewId = null;
  function openPreview(id) {
    previewId = id;
    var d = $('preview');
    if (!d.open) d.showModal();
    drawPreview();
  }

  function drawPreview() {
    var i = pageIndexById(previewId);
    if (i < 0) return;
    var p = state.pages[i], f = fileOf(p);
    $('preview-title').textContent = 'Page ' + (i + 1) + ' of ' + state.pages.length + ' · ' + f.name + (f.kind === 'pdf' ? ', page ' + (p.index + 1) : '');
    var target = $('preview-canvas');
    var max = Math.min(1600, Math.max(window.innerWidth, window.innerHeight) * (window.devicePixelRatio || 1));
    var done = function (c) {
      if (previewId !== p.id) return;
      target.width = c.width;
      target.height = c.height;
      target.getContext('2d').drawImage(c, 0, 0);
    };
    if (p.pdfPage) {
      renderPdfPage(p.pdfPage, max, p.rotation).then(done);
    } else {
      var src = f.image, rot = p.rotation % 360, swap = rot === 90 || rot === 270;
      var k = Math.min(1, max / Math.max(src.width, src.height));
      var c = document.createElement('canvas');
      c.width = Math.round((swap ? src.height : src.width) * k);
      c.height = Math.round((swap ? src.width : src.height) * k);
      var ctx = c.getContext('2d');
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate((rot * Math.PI) / 180);
      ctx.drawImage(src, (-src.width * k) / 2, (-src.height * k) / 2, src.width * k, src.height * k);
      done(c);
    }
    $('preview-prev').disabled = i === 0;
    $('preview-next').disabled = i === state.pages.length - 1;
  }

  function stepPreview(delta) {
    var i = pageIndexById(previewId) + delta;
    if (i >= 0 && i < state.pages.length) { previewId = state.pages[i].id; drawPreview(); }
  }

  /* ---------- export ---------- */

  function exportPdf(pages) {
    if (!pages.length || state.busy) return;
    state.busy = true;
    $('download-all').disabled = $('download-selected').disabled = true;
    setStatus('Building PDF…');
    var PDFLib = window.PDFLib;
    var out, srcDocs = {}, embedded = {};
    PDFLib.PDFDocument.create().then(function (doc) {
      out = doc;
      // Load each source PDF once.
      var needed = {};
      pages.forEach(function (p) { if (fileOf(p).kind === 'pdf') needed[p.fileId] = true; });
      return Promise.all(Object.keys(needed).map(function (id) {
        var f = fileOf({ fileId: +id });
        return PDFLib.PDFDocument.load(f.bytes, { ignoreEncryption: true }).then(function (d) { srcDocs[id] = d; });
      }));
    }).then(function () {
      // Copy pages per source in one call so shared fonts and images are copied only once.
      var copies = {};
      return Promise.all(Object.keys(srcDocs).map(function (id) {
        var wanted = pages.filter(function (p) { return p.fileId === +id; });
        return out.copyPages(srcDocs[id], wanted.map(function (p) { return p.index; })).then(function (copied) {
          wanted.forEach(function (p, i) { copies[p.id] = copied[i]; });
        });
      })).then(function () { return copies; });
    }).then(function (copies) {
      var chain = Promise.resolve();
      pages.forEach(function (p) {
        chain = chain.then(function () {
          var f = fileOf(p);
          if (f.kind === 'pdf') {
            var page = copies[p.id];
            page.setRotation(PDFLib.degrees((page.getRotation().angle + p.rotation) % 360));
            out.addPage(page);
            return;
          }
          return embedImage(out, f, embedded).then(function (img) { addImagePage(out, img, p); });
        });
      });
      return chain;
    }).then(function () {
      out.setTitle(($('out-name').value || 'combined').trim());
      out.setProducer('Off the Clock Creative Suite');
      out.setCreator('Off the Clock Creative Suite');
      return out.save();
    }).then(function (bytes) {
      var name = (($('out-name').value || 'combined').trim().replace(/[\\/:*?"<>|]+/g, '-') || 'combined') + '.pdf';
      var blob = new Blob([bytes], { type: 'application/pdf' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 15000);
      setStatus('Saved ' + name + ' · ' + pages.length + ' pages · ' + formatBytes(blob.size));
    }).catch(function (err) {
      console.error(err);
      setStatus('Couldn\'t build the PDF: ' + (err.message || err), true);
    }).then(function () {
      state.busy = false;
      $('download-all').disabled = !state.pages.length;
      updateSelectionUi();
    });
  }

  function embedImage(out, f, cache) {
    if (cache[f.id]) return Promise.resolve(cache[f.id]);
    var b = f.bytes;
    var isJpg = b[0] === 0xff && b[1] === 0xd8;
    var isPng = b[0] === 0x89 && b[1] === 0x50;
    var p = isJpg ? out.embedJpg(b) : isPng ? out.embedPng(b) : new Promise(function (resolve) {
      f.image.toBlob(function (blob) { blob.arrayBuffer().then(function (buf) { resolve(out.embedPng(new Uint8Array(buf))); }); }, 'image/png');
    });
    return p.then(function (img) { cache[f.id] = img; return img; });
  }

  function addImagePage(out, img, p) {
    var mode = $('img-size').value;
    var iw = img.width * 0.75, ih = img.height * 0.75; // pixels → points at 96 dpi
    var pw, ph, w, h;
    if (mode === 'image') {
      pw = iw; ph = ih; w = iw; h = ih;
    } else {
      var size = PAGE_SIZES[mode];
      var landscape = img.width > img.height;
      pw = landscape ? size[1] : size[0];
      ph = landscape ? size[0] : size[1];
      var k = Math.min((pw - IMAGE_MARGIN * 2) / iw, (ph - IMAGE_MARGIN * 2) / ih, 1);
      w = iw * k; h = ih * k;
    }
    var page = out.addPage([pw, ph]);
    page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    if (p.rotation) page.setRotation(window.PDFLib.degrees(p.rotation));
  }

  function formatBytes(n) {
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  /* ---------- wiring ---------- */

  function bind() {
    var input = $('file-input');
    input.onchange = function () { addFiles(input.files); input.value = ''; };
    var dz = $('dropzone');
    dz.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
      document.addEventListener(ev, function (e) {
        if (dragIds || e.dataTransfer.types.indexOf('Files') < 0) return;
        e.preventDefault();
        document.body.classList.add('file-hover');
      });
    });
    document.addEventListener('dragleave', function (e) {
      if (!e.relatedTarget) document.body.classList.remove('file-hover');
    });
    document.addEventListener('drop', function (e) {
      document.body.classList.remove('file-hover');
      if (dragIds || !e.dataTransfer.files.length) return;
      e.preventDefault();
      addFiles(e.dataTransfer.files);
    });

    bindGridDrop();

    $('act-select-all').onclick = function () {
      state.pages.forEach(function (p) { state.selected.add(p.id); });
      refreshSelection();
    };
    $('act-rot-left').onclick = function () { rotatePages(selectedIds(), -90); };
    $('act-rot-right').onclick = function () { rotatePages(selectedIds(), 90); };
    $('act-earlier').onclick = function () { shiftSelection(-1); };
    $('act-later').onclick = function () { shiftSelection(1); };
    $('act-dup').onclick = function () { duplicatePages(selectedIds()); };
    $('act-delete').onclick = function () { deletePages(selectedIds()); };
    $('act-reverse').onclick = reverseOrder;
    $('act-reset').onclick = resetOrder;
    $('thumb-size').oninput = function () {
      document.documentElement.style.setProperty('--thumb', this.value + 'px');
    };

    $('download-all').onclick = function () { exportPdf(state.pages.slice()); };
    $('download-selected').onclick = function () {
      exportPdf(state.pages.filter(function (p) { return state.selected.has(p.id); }));
    };

    // Clicking empty grid space clears the selection.
    $('grid-wrap').addEventListener('click', function (e) {
      if (e.target === this || e.target === $('page-grid')) { state.selected.clear(); refreshSelection(); }
    });

    $('preview-close').onclick = function () { $('preview').close(); };
    $('preview-prev').onclick = function () { stepPreview(-1); };
    $('preview-next').onclick = function () { stepPreview(1); };
    $('preview').addEventListener('click', function (e) { if (e.target === this) this.close(); });
    $('preview').addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') stepPreview(-1);
      if (e.key === 'ArrowRight') stepPreview(1);
    });

    document.addEventListener('keydown', function (e) {
      var t = e.target;
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || $('preview').open) return;
      var mod = e.ctrlKey || e.metaKey, ids = selectedIds();
      if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); $('act-select-all').onclick(); }
      else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); if (ids.length) duplicatePages(ids); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && ids.length) { e.preventDefault(); deletePages(ids); }
      else if (e.key.toLowerCase() === 'r' && !mod && ids.length) rotatePages(ids, e.shiftKey ? -90 : 90);
      else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); shiftSelection(-1); }
      else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); shiftSelection(1); }
      else if (e.key === 'Escape') { state.selected.clear(); refreshSelection(); }
      else if (e.key === 'Enter' && t.classList && t.classList.contains('page-card')) openPreview(+t.dataset.id);
      else if (e.key === ' ' && t.classList && t.classList.contains('page-card')) { e.preventDefault(); selectPage(+t.dataset.id, e); }
    });
  }

  bind();
  renderPages();
})();
