/*
 * Fill & Sign: fill PDF form fields, detect blanks in flat PDFs, add text, dates, marks,
 * white-out and signatures (drawn, typed or uploaded), then write them into the PDF.
 *
 * Positions are stored as fractions of the displayed page, so they survive zooming. On save
 * they are mapped back to PDF coordinates with pdf.js's viewport (which handles rotated pages).
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/vendor/pdf.worker.min.js';

  // The first four are bundled with the app (fonts/), so typed signatures look the same everywhere.
  var SIG_FONTS = [
    '"Studiolo Dancing", cursive',
    '"Studiolo Vibes", cursive',
    '"Studiolo Allura", cursive',
    '"Studiolo Caveat", cursive',
    '"Segoe Script", "Snell Roundhand", "Studiolo Dancing", cursive',
    'Georgia, "Times New Roman", serif'
  ];

  var state = {
    name: '',
    bytes: null,
    pdf: null,
    pages: [], // { index, pg, vp1, el, canvas, overlay, renderedScale }
    zoom: 1,
    scale: 1, // displayed px per PDF point
    elements: [], // placed items, see addElement()
    fields: [], // real form fields found in the PDF
    fieldValues: {}, // field name → value the user entered
    dirtyFields: {},
    detected: [], // blanks found by Detect fields
    tool: 'select',
    selected: null,
    signatures: [], // { id, url, w, h }
    activeSig: null,
    pendingPlace: null,
    history: [],
    nextId: 1,
    busy: false
  };

  /* ---------- small helpers ---------- */

  var toastTimer;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  function setStatus(msg, isError) {
    $('status').textContent = msg || '';
    $('status').classList.toggle('error', !!isError);
  }

  function hexToRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return window.PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }

  function today() {
    return new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function elById(id) {
    for (var i = 0; i < state.elements.length; i++) if (state.elements[i].id === id) return state.elements[i];
    return null;
  }

  function sigById(id) {
    for (var i = 0; i < state.signatures.length; i++) if (state.signatures[i].id === id) return state.signatures[i];
    return null;
  }

  /* ---------- opening ---------- */

  function openFile(file) {
    if (!file) return;
    if (!(file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) { toast('Please choose a PDF file.'); return; }
    file.arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf);
      return pdfjsLib.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise.then(function (pdf) {
        if (state.pdf) state.pdf.destroy();
        state.name = file.name;
        state.bytes = bytes;
        state.pdf = pdf;
        state.elements = [];
        state.fields = [];
        state.fieldValues = {};
        state.dirtyFields = {};
        state.detected = [];
        state.history = [];
        state.selected = null;
        state.zoom = 1;
        return loadPages();
      });
    }).then(function () {
      $('empty-state').hidden = true;
      $('detect-btn').disabled = false;
      $('download-btn').disabled = false;
      $('doc-name').textContent = state.name;
      $('doc-name').title = state.name;
      $('doc-pages').textContent = state.pages.length;
      return findFormFields();
    }).then(function () {
      renderAll();
      if (state.fields.length) {
        toast('Found ' + state.fields.length + ' fillable field' + (state.fields.length === 1 ? '' : 's') + '. Click one to fill it in.');
      } else {
        return detectFields(true);
      }
    }).catch(function (err) {
      console.error(err);
      if (err && err.name === 'PasswordException') toast('This PDF is password-protected. Remove the password first.');
      else toast('This doesn\'t look like a valid PDF.');
    });
  }

  function loadPages() {
    var container = $('pages');
    container.innerHTML = '';
    state.pages = [];
    var chain = Promise.resolve();
    for (var i = 0; i < state.pdf.numPages; i++) {
      (function (index) {
        chain = chain.then(function () { return state.pdf.getPage(index + 1); }).then(function (pg) {
          var el = document.createElement('div');
          el.className = 'pe-page';
          el.dataset.page = index;
          var canvas = document.createElement('canvas');
          var overlay = document.createElement('div');
          overlay.className = 'pe-overlay';
          var num = document.createElement('span');
          num.className = 'pe-page-num';
          num.textContent = 'Page ' + (index + 1) + ' of ' + state.pdf.numPages;
          el.appendChild(canvas);
          el.appendChild(overlay);
          el.appendChild(num);
          container.appendChild(el);
          var page = { index: index, pg: pg, vp1: pg.getViewport({ scale: 1 }), el: el, canvas: canvas, overlay: overlay, renderedScale: 0 };
          state.pages.push(page);
          bindOverlay(page);
        });
      })(i);
    }
    return chain.then(layout);
  }

  /* ---------- layout & rendering ---------- */

  var observer = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) renderPage(state.pages[+en.target.dataset.page]);
    });
  }, { root: null, rootMargin: '600px' }) : null;

  function layout() {
    if (!state.pages.length) return;
    var avail = Math.max(200, $('stage').clientWidth - 48);
    var widest = Math.max.apply(null, state.pages.map(function (p) { return p.vp1.width; }));
    var fitScale = Math.min(avail / widest, 1.6);
    state.scale = fitScale * state.zoom;
    $('zoom-fit').textContent = Math.round(state.scale * 100 / (96 / 72)) + '%';
    state.pages.forEach(function (p) {
      p.el.style.width = Math.round(p.vp1.width * state.scale) + 'px';
      p.el.style.height = Math.round(p.vp1.height * state.scale) + 'px';
      p.el.style.setProperty('--s', state.scale);
      if (observer) { observer.unobserve(p.el); observer.observe(p.el); } else renderPage(p);
    });
  }

  function renderPage(p) {
    var dpr = window.devicePixelRatio || 1;
    var target = state.scale * dpr;
    if (Math.abs(p.renderedScale - target) < 0.01 || p.rendering) return;
    p.rendering = true;
    var vp = p.pg.getViewport({ scale: target });
    var c = document.createElement('canvas');
    c.width = Math.round(vp.width);
    c.height = Math.round(vp.height);
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    // Form fields are drawn by us as inputs, so pdf.js leaves them out of the picture.
    p.pg.render({ canvasContext: ctx, viewport: vp, annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS }).promise.then(function () {
      p.canvas.width = c.width;
      p.canvas.height = c.height;
      p.canvas.getContext('2d').drawImage(c, 0, 0);
      p.renderedScale = target;
      p.rendering = false;
      if (Math.abs(target - state.scale * dpr) > 0.01) renderPage(p);
    }, function () { p.rendering = false; });
  }

  function setZoom(z) {
    state.zoom = Math.min(4, Math.max(0.3, z));
    layout();
  }

  /* ---------- real form fields ---------- */

  function findFormFields() {
    var chain = Promise.resolve();
    state.pages.forEach(function (p) {
      chain = chain.then(function () { return p.pg.getAnnotations({ intent: 'display' }); }).then(function (annots) {
        annots.forEach(function (a) {
          if (a.subtype !== 'Widget' || !a.fieldName || a.hidden) return;
          var kind = a.fieldType === 'Tx' ? 'text'
            : a.fieldType === 'Ch' ? 'choice'
            : a.fieldType === 'Sig' ? 'signature'
            : a.checkBox ? 'checkbox' : a.radioButton ? 'radio' : null;
          if (!kind) return; // push buttons
          var r = p.vp1.convertToViewportRectangle(a.rect);
          var x = Math.min(r[0], r[2]), y = Math.min(r[1], r[3]);
          var w = Math.abs(r[2] - r[0]), h = Math.abs(r[3] - r[1]);
          var f = {
            id: state.nextId++,
            page: p.index,
            name: a.fieldName,
            kind: kind,
            x: x / p.vp1.width, y: y / p.vp1.height, w: w / p.vp1.width, h: h / p.vp1.height,
            hPt: h,
            multiline: !!a.multiLine,
            readOnly: !!a.readOnly,
            maxLen: a.maxLen || 0,
            options: (a.options || []).map(function (o) { return { value: o.exportValue, label: o.displayValue }; }),
            exportValue: a.exportValue || a.buttonValue || 'Yes'
          };
          if (!(f.name in state.fieldValues)) {
            var v = a.fieldValue;
            if (kind === 'checkbox') v = !!v && v !== 'Off';
            if (Array.isArray(v)) v = v[0];
            state.fieldValues[f.name] = v == null ? '' : v;
          }
          state.fields.push(f);
        });
      });
    });
    return chain.then(function () {
      $('fields-block').hidden = false;
      $('field-count').textContent = state.fields.filter(function (f) { return f.kind !== 'signature'; }).length;
    });
  }

  function renderFields(p) {
    state.fields.filter(function (f) { return f.page === p.index; }).forEach(function (f) {
      if (f.kind === 'signature') {
        // Signature fields behave like detected signature blanks.
        if (!f.signed) p.overlay.appendChild(detectedBox({ id: f.id, page: f.page, kind: 'signature', x: f.x, y: f.y, w: f.w, h: f.h, field: true }));
        return;
      }
      var input;
      var value = state.fieldValues[f.name];
      if (f.kind === 'text') {
        input = document.createElement(f.multiline ? 'textarea' : 'input');
        if (!f.multiline) input.type = 'text';
        input.value = value || '';
        if (f.maxLen) input.maxLength = f.maxLen;
        var pt = Math.max(6, Math.min(12, f.hPt * (f.multiline ? 0.5 : 0.62)));
        input.style.fontSize = 'calc(var(--s) * ' + pt + 'px)';
      } else if (f.kind === 'checkbox') {
        input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!value;
      } else if (f.kind === 'radio') {
        input = document.createElement('input');
        input.type = 'radio';
        input.name = 'pe-radio-' + f.name;
        input.value = f.exportValue;
        input.checked = value === f.exportValue;
      } else if (f.kind === 'choice') {
        input = document.createElement('select');
        input.add(new Option('', ''));
        f.options.forEach(function (o) { input.add(new Option(o.label || o.value, o.value)); });
        input.value = value || '';
        input.style.fontSize = 'calc(var(--s) * ' + Math.max(6, Math.min(12, f.hPt * 0.6)) + 'px)';
      }
      input.className = 'pe-field';
      input.title = f.name;
      input.disabled = f.readOnly;
      input.style.left = f.x * 100 + '%';
      input.style.top = f.y * 100 + '%';
      input.style.width = f.w * 100 + '%';
      input.style.height = f.h * 100 + '%';
      var update = function () {
        state.fieldValues[f.name] = f.kind === 'checkbox' ? input.checked : input.value;
        state.dirtyFields[f.name] = true;
        if (f.kind !== 'text') syncField(f.name);
      };
      input.addEventListener('input', update);
      input.addEventListener('change', update);
      input.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      input.dataset.field = f.name;
      p.overlay.appendChild(input);
    });
  }

  // Keeps every widget of the same field (e.g. a name repeated on several pages) in step.
  function syncField(name) {
    Array.prototype.forEach.call(document.querySelectorAll('.pe-field'), function (el) {
      if (el.dataset.field !== name) return;
      var v = state.fieldValues[name];
      if (el.type === 'checkbox') el.checked = !!v;
      else if (el.type === 'radio') el.checked = el.value === v;
      else if (document.activeElement !== el) el.value = v;
    });
  }

  /* ---------- detecting blanks in flat PDFs ---------- */

  var SIG_LABEL = /sign(ature|ed| here)?\b/i;
  var DATE_LABEL = /\bdate\b/i;

  function detectFields(auto) {
    if (!state.pdf) return Promise.resolve();
    state.detected = [];
    var chain = Promise.resolve();
    state.pages.forEach(function (p) {
      chain = chain.then(function () { return p.pg.getTextContent(); }).then(function (tc) {
        findBlanks(p, tc.items.filter(function (it) { return it.str && it.transform; }));
      });
    });
    return chain.then(function () {
      $('detect-count').textContent = state.detected.length;
      $('fields-block').hidden = false;
      renderAll();
      if (state.detected.length) {
        toast('Found ' + state.detected.length + ' blank' + (state.detected.length === 1 ? '' : 's') + ' to fill. Click a highlighted box to fill or sign it.');
      } else if (!auto) {
        toast('No blanks like "Name: ____" were found. Use the Text and Signature tools instead.');
      }
    });
  }

  function findBlanks(p, items) {
    var vp = p.vp1, W = vp.width, H = vp.height;
    var boxes = items.map(function (it) {
      var t = pdfjsLib.Util.transform(vp.transform, it.transform);
      var size = Math.hypot(t[2], t[3]);
      var width = it.width * (vp.scale || 1);
      return { str: it.str, x: t[4], base: t[5], size: size, width: width, upright: Math.abs(t[1]) < 0.01 && t[0] > 0 };
    }).filter(function (b) { return b.upright && b.size > 2; });

    function add(kind, x, base, w, size, label) {
      var h = kind === 'signature' ? Math.max(size * 2.6, 24) : Math.max(size * 1.35, 12);
      var top = base - h + size * 0.3;
      var box = { id: state.nextId++, page: p.index, kind: kind, x: x / W, y: top / H, w: w / W, h: h / H, fontPt: Math.min(12, Math.max(8, size)), label: label };
      // Skip blanks that sit on a real form field.
      var clash = state.fields.some(function (f) {
        return f.page === p.index && box.x < f.x + f.w && box.x + box.w > f.x && box.y < f.y + f.h && box.y + box.h > f.y;
      });
      if (!clash && w > 8) state.detected.push(box);
    }

    function kindFor(label) {
      return SIG_LABEL.test(label) ? 'signature' : DATE_LABEL.test(label) ? 'date' : 'text';
    }

    function labelLeftOf(b) {
      var same = boxes.filter(function (o) { return o !== b && Math.abs(o.base - b.base) < b.size * 0.4 && o.x + o.width <= b.x + 2; });
      same.sort(function (a, c) { return c.x - a.x; });
      return same.length ? same[0].str : '';
    }

    boxes.forEach(function (b) {
      // 1. Runs of underscores: "Name: ________"
      var re = /_{3,}/g, m, found = false;
      while ((m = re.exec(b.str))) {
        found = true;
        var per = b.width / b.str.length;
        var before = b.str.slice(0, m.index).replace(/[_\s]+$/, '');
        var label = before || labelLeftOf(b);
        add(kindFor(label), b.x + per * m.index, b.base, per * m[0].length, b.size, label);
      }
      if (found) return;
      // 2. A label with nothing after it on the line: "Signature:" or "Date:"
      var text = b.str.trim();
      var isLabel = /:\s*$/.test(text) && text.length < 40;
      var isSig = /^(signature|sign here|signed)\b/i.test(text) && text.length < 30;
      if (!isLabel && !isSig) return;
      var end = b.x + b.width;
      var rightNeighbour = boxes.some(function (o) {
        return o !== b && Math.abs(o.base - b.base) < b.size * 0.4 && o.x > end && o.x < end + 160 && o.str.trim() && !/^_+$/.test(o.str.trim());
      });
      if (rightNeighbour) return;
      var x = end + b.size * 0.5;
      var w = Math.min(isSig || SIG_LABEL.test(text) ? 200 : 220, W - 40 - x);
      add(kindFor(text), x, b.base, w, b.size, text);
    });
  }

  function detectedBox(d) {
    var el = document.createElement('button');
    el.type = 'button';
    el.className = 'pe-detected' + (d.kind === 'signature' ? ' sig' : '');
    el.style.left = d.x * 100 + '%';
    el.style.top = d.y * 100 + '%';
    el.style.width = d.w * 100 + '%';
    el.style.height = d.h * 100 + '%';
    el.textContent = d.kind === 'signature' ? '✍ Click to sign' : d.kind === 'date' ? '📅 Click to add date' : '✎ Click to type';
    el.title = d.label ? 'Detected: ' + d.label : 'Detected blank';
    el.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    el.addEventListener('click', function (e) {
      e.stopPropagation();
      fillDetected(d);
    });
    return el;
  }

  function fillDetected(d) {
    var p = state.pages[d.page];
    if (d.kind === 'signature') {
      var place = function (sig) {
        pushHistory();
        // Fit the signature inside the box, sitting on its bottom edge.
        var boxW = d.w * p.vp1.width, boxH = d.h * p.vp1.height;
        var k = Math.min(boxW / sig.w, boxH / sig.h);
        var w = sig.w * k, h = sig.h * k;
        addElement({ page: d.page, type: 'signature', sigId: sig.id, x: d.x, y: d.y + (boxH - h) / p.vp1.height, w: w / p.vp1.width, h: h / p.vp1.height });
        removeDetected(d);
      };
      if (state.activeSig) place(sigById(state.activeSig));
      else openSigDialog(place);
      return;
    }
    pushHistory();
    var fs = d.fontPt;
    var boxH = d.h * p.vp1.height;
    // Put the text's baseline near the bottom of the blank, like writing on the line.
    var top = d.y * p.vp1.height + boxH - fs * 0.3 - fs * 0.975 - 1;
    var el = addElement({
      page: d.page, type: 'text', text: d.kind === 'date' ? today() : '', size: fs, color: '#111111',
      x: d.x + 2 / p.vp1.width, y: top / p.vp1.height
    });
    removeDetected(d);
    if (d.kind !== 'date') focusText(el);
  }

  function removeDetected(d) {
    if (d.field) {
      var f = state.fields.filter(function (x) { return x.id === d.id; })[0];
      if (f) f.signed = true;
    } else {
      state.detected = state.detected.filter(function (x) { return x !== d; });
    }
    $('detect-count').textContent = state.detected.length;
    renderAll();
  }

  /* ---------- placed elements ---------- */

  function addElement(props) {
    var el = Object.assign({ id: state.nextId++, color: '#111111' }, props);
    state.elements.push(el);
    state.selected = el.id;
    renderAll();
    return el;
  }

  function renderAll() {
    state.pages.forEach(function (p) {
      p.overlay.innerHTML = '';
      renderFields(p);
      state.detected.filter(function (d) { return d.page === p.index; }).forEach(function (d) { p.overlay.appendChild(detectedBox(d)); });
      state.elements.filter(function (e) { return e.page === p.index; }).forEach(function (e) { p.overlay.appendChild(elementNode(e)); });
    });
    updateSelectionUi();
  }

  function elementNode(e) {
    var node = document.createElement('div');
    node.className = 'pe-el ' + e.type + (e.type === 'text' ? ' text-el' : '') + (state.selected === e.id ? ' selected' : '');
    node.dataset.id = e.id;
    node.style.left = e.x * 100 + '%';
    node.style.top = e.y * 100 + '%';
    if (e.type === 'text') {
      var t = document.createElement('div');
      t.className = 'pe-text';
      t.contentEditable = 'plaintext-only';
      if (t.contentEditable !== 'plaintext-only') t.contentEditable = 'true';
      t.spellcheck = false;
      t.dataset.placeholder = 'Type here';
      t.textContent = e.text;
      t.style.fontSize = 'calc(var(--s) * ' + e.size + 'px)';
      t.style.color = e.color;
      t.addEventListener('focus', function () {
        if (state.selected !== e.id) { state.selected = e.id; refreshSelection(); }
        t.dataset.before = e.text;
      });
      t.addEventListener('input', function () { e.text = t.innerText.replace(/\n$/, ''); });
      t.addEventListener('blur', function () {
        if (t.dataset.before !== e.text) {
          state.history.push(snapshotWith(e.id, 'text', t.dataset.before));
        }
        if (!e.text.trim()) removeElement(e, true);
      });
      t.addEventListener('keydown', function (k) {
        k.stopPropagation();
        if (k.key === 'Escape') t.blur();
      });
      node.appendChild(t);
      var grip = document.createElement('span');
      grip.className = 'pe-grip';
      grip.textContent = '⠿';
      grip.title = 'Drag to move';
      node.appendChild(grip);
    } else {
      node.style.width = e.w * 100 + '%';
      node.style.height = e.h * 100 + '%';
      if (e.type === 'signature') {
        var img = document.createElement('img');
        img.src = sigById(e.sigId).url;
        img.alt = 'Signature';
        node.appendChild(img);
      } else if (e.type === 'check' || e.type === 'cross') {
        node.appendChild(markCanvas(e.type, e.color, 96));
      }
    }
    var handle = document.createElement('span');
    handle.className = 'pe-handle';
    handle.title = 'Drag to resize';
    node.appendChild(handle);
    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'pe-del';
    del.textContent = '×';
    del.setAttribute('aria-label', 'Remove');
    node.appendChild(del);
    node.addEventListener('pointerdown', function (ev) { onElementPointerDown(ev, e, node); });
    return node;
  }

  function markCanvas(type, color, size) {
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var ctx = c.getContext('2d');
    ctx.strokeStyle = color;
    ctx.lineWidth = size * 0.11;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (type === 'check') {
      ctx.moveTo(size * 0.16, size * 0.54);
      ctx.lineTo(size * 0.4, size * 0.78);
      ctx.lineTo(size * 0.86, size * 0.24);
    } else {
      ctx.moveTo(size * 0.2, size * 0.2); ctx.lineTo(size * 0.8, size * 0.8);
      ctx.moveTo(size * 0.8, size * 0.2); ctx.lineTo(size * 0.2, size * 0.8);
    }
    ctx.stroke();
    return c;
  }

  function focusText(e) {
    setTimeout(function () {
      var node = document.querySelector('.pe-el[data-id="' + e.id + '"] .pe-text');
      if (!node) return;
      node.focus();
      var r = document.createRange();
      r.selectNodeContents(node);
      r.collapse(false);
      var s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    }, 0);
  }

  function removeElement(e, quiet) {
    if (!quiet) pushHistory();
    state.elements = state.elements.filter(function (x) { return x !== e; });
    if (state.selected === e.id) state.selected = null;
    renderAll();
  }

  function onElementPointerDown(ev, e, node) {
    // With a placing tool, clicks on a white-out go through to the page, so you can type or sign on it.
    if (e.type === 'whiteout' && state.tool !== 'select' && state.tool !== 'whiteout' && !ev.target.classList.contains('pe-del') && !ev.target.classList.contains('pe-handle')) return;
    ev.stopPropagation();
    if (ev.target.classList.contains('pe-del')) { removeElement(e); return; }
    var isHandle = ev.target.classList.contains('pe-handle');
    var isTextBody = ev.target.classList.contains('pe-text');
    if (state.selected !== e.id) { state.selected = e.id; refreshSelection(); }
    if (isTextBody) return; // let the caret go where the user clicked
    ev.preventDefault();
    var p = state.pages[e.page];
    var rect = p.el.getBoundingClientRect();
    var start = { x: ev.clientX, y: ev.clientY, ex: e.x, ey: e.y, ew: e.w, eh: e.h, size: e.size, nodeW: node.offsetWidth };
    var moved = false;
    var snap = JSON.stringify(serialize());
    node.setPointerCapture(ev.pointerId);
    function move(m) {
      var dx = (m.clientX - start.x) / rect.width, dy = (m.clientY - start.y) / rect.height;
      if (!moved && Math.abs(m.clientX - start.x) + Math.abs(m.clientY - start.y) < 3) return;
      moved = true;
      if (isHandle) {
        if (e.type === 'text') {
          var k = Math.max(0.2, (start.nodeW + (m.clientX - start.x)) / start.nodeW);
          e.size = Math.max(4, Math.min(96, Math.round(start.size * k * 2) / 2));
          node.querySelector('.pe-text').style.fontSize = 'calc(var(--s) * ' + e.size + 'px)';
          $('opt-size').value = e.size;
        } else {
          var nw = Math.max(0.01, start.ew + dx);
          var nh = e.type === 'whiteout' ? Math.max(0.005, start.eh + dy) : start.eh * (nw / start.ew);
          e.w = Math.min(nw, 1 - e.x);
          e.h = Math.min(nh, 1 - e.y);
          node.style.width = e.w * 100 + '%';
          node.style.height = e.h * 100 + '%';
        }
      } else {
        var w = e.type === 'text' ? node.offsetWidth / rect.width : e.w;
        var h = e.type === 'text' ? node.offsetHeight / rect.height : e.h;
        e.x = Math.min(1 - w, Math.max(0, start.ex + dx));
        e.y = Math.min(1 - h, Math.max(0, start.ey + dy));
        node.style.left = e.x * 100 + '%';
        node.style.top = e.y * 100 + '%';
      }
    }
    function up() {
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', up);
      if (moved) state.history.push(snap);
      else if (e.type === 'text') focusText(e);
    }
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
  }

  function refreshSelection() {
    Array.prototype.forEach.call(document.querySelectorAll('.pe-el'), function (n) {
      n.classList.toggle('selected', +n.dataset.id === state.selected);
    });
    updateSelectionUi();
  }

  function updateSelectionUi() {
    var e = elById(state.selected);
    $('sel-block').hidden = !e;
    if (!e) return;
    var names = { text: 'Text', signature: 'Signature', check: 'Tick', cross: 'Cross', whiteout: 'White-out' };
    $('sel-title').textContent = names[e.type] || 'Selected';
    $('text-opts').hidden = !(e.type === 'text' || e.type === 'check' || e.type === 'cross');
    $('opt-size').parentNode.hidden = e.type !== 'text';
    if (e.type === 'text') $('opt-size').value = e.size;
    $('opt-color').value = e.color || '#111111';
  }

  /* ---------- placing with tools ---------- */

  function bindOverlay(p) {
    p.overlay.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return;
      var rect = p.el.getBoundingClientRect();
      var fx = (ev.clientX - rect.left) / rect.width, fy = (ev.clientY - rect.top) / rect.height;
      var ptW = p.vp1.width, ptH = p.vp1.height;
      var tool = state.tool;
      if (document.activeElement && document.activeElement.classList.contains('pe-text')) document.activeElement.blur();
      if (tool === 'select') {
        if (state.selected) { state.selected = null; refreshSelection(); }
        return;
      }
      ev.preventDefault();
      if (tool === 'text' || tool === 'date') {
        pushHistory();
        var size = 12;
        var el = addElement({ page: p.index, type: 'text', text: tool === 'date' ? today() : '', size: size, x: fx, y: Math.max(0, fy - (size * 0.625) / ptH) });
        if (tool === 'text') focusText(el);
      } else if (tool === 'check' || tool === 'cross') {
        pushHistory();
        var s = 16;
        addElement({ page: p.index, type: tool, x: fx - s / 2 / ptW, y: fy - s / 2 / ptH, w: s / ptW, h: s / ptH });
      } else if (tool === 'signature') {
        var place = function (sig) {
          pushHistory();
          var w = Math.min(170, ptW * 0.4), h = w * sig.h / sig.w;
          addElement({ page: p.index, type: 'signature', sigId: sig.id, x: Math.max(0, fx - w / 2 / ptW), y: Math.max(0, fy - h / 2 / ptH), w: w / ptW, h: h / ptH });
        };
        if (state.activeSig) place(sigById(state.activeSig)); else openSigDialog(place);
      } else if (tool === 'whiteout') {
        startWhiteout(ev, p, fx, fy);
      }
    });
  }

  function startWhiteout(ev, p, fx, fy) {
    pushHistory();
    var e = addElement({ page: p.index, type: 'whiteout', x: fx, y: fy, w: 0.001, h: 0.001, color: '#ffffff' });
    var node = p.overlay.querySelector('[data-id="' + e.id + '"]');
    var rect = p.el.getBoundingClientRect();
    var moved = false;
    p.overlay.setPointerCapture(ev.pointerId);
    function move(m) {
      moved = true;
      var x2 = Math.min(1, Math.max(0, (m.clientX - rect.left) / rect.width));
      var y2 = Math.min(1, Math.max(0, (m.clientY - rect.top) / rect.height));
      e.x = Math.min(fx, x2); e.y = Math.min(fy, y2);
      e.w = Math.abs(x2 - fx); e.h = Math.abs(y2 - fy);
      node.style.left = e.x * 100 + '%'; node.style.top = e.y * 100 + '%';
      node.style.width = e.w * 100 + '%'; node.style.height = e.h * 100 + '%';
    }
    function up() {
      p.overlay.removeEventListener('pointermove', move);
      p.overlay.removeEventListener('pointerup', up);
      if (!moved || e.w * p.vp1.width < 4 || e.h * p.vp1.height < 4) { // a click: default size
        e.w = 90 / p.vp1.width; e.h = 16 / p.vp1.height;
        e.y = Math.max(0, fy - e.h / 2);
        renderAll();
      }
    }
    p.overlay.addEventListener('pointermove', move);
    p.overlay.addEventListener('pointerup', up);
  }

  function setTool(tool) {
    state.tool = tool;
    document.body.dataset.tool = tool;
    Array.prototype.forEach.call(document.querySelectorAll('.stool'), function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
    });
    if (tool === 'signature' && !state.activeSig) openSigDialog(null);
  }

  /* ---------- undo ---------- */

  function serialize() {
    return state.elements.map(function (e) { return Object.assign({}, e); });
  }

  function pushHistory() {
    state.history.push(JSON.stringify(serialize()));
    if (state.history.length > 80) state.history.shift();
  }

  function snapshotWith(id, key, value) {
    return JSON.stringify(serialize().map(function (e) {
      if (e.id === id) { var c = Object.assign({}, e); c[key] = value; return c; }
      return e;
    }));
  }

  function undo() {
    var s = state.history.pop();
    if (!s) return;
    state.elements = JSON.parse(s);
    if (!elById(state.selected)) state.selected = null;
    renderAll();
  }

  /* ---------- signatures ---------- */

  var sigCallback = null;
  var currentTab = 'draw';
  var pad = { canvas: null, ctx: null, ink: '#111827', width: 5, hasInk: false, points: null };
  var typeStyle = 0;
  var uploadSource = null;

  function openSigDialog(callback) {
    sigCallback = callback;
    var d = $('sig-dialog');
    d.returnValue = '';
    d.showModal();
    selectTab(currentTab);
    setTimeout(resizePad, 0);
  }

  function selectTab(tab) {
    currentTab = tab;
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) { t.setAttribute('aria-selected', String(t.dataset.tab === tab)); });
    Array.prototype.forEach.call(document.querySelectorAll('.tab-panel'), function (p) { p.hidden = p.dataset.panel !== tab; });
    if (tab === 'type') { preloadSigFonts(); renderTypeStyles(); setTimeout(function () { $('type-name').focus(); }, 0); }
  }

  function resizePad() {
    pad.canvas = $('sig-pad');
    pad.ctx = pad.canvas.getContext('2d');
  }

  function clearPad() {
    pad.ctx.clearRect(0, 0, pad.canvas.width, pad.canvas.height);
    pad.hasInk = false;
    $('pad-hint').hidden = false;
  }

  function bindPad() {
    var c = $('sig-pad');
    resizePad();
    var last = null, lastMid = null;
    function pos(e) {
      var r = c.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height), p: e.pressure || 0.5 };
    }
    c.addEventListener('pointerdown', function (e) {
      c.setPointerCapture(e.pointerId);
      last = pos(e);
      lastMid = last;
      pad.hasInk = true;
      $('pad-hint').hidden = true;
      pad.ctx.fillStyle = pad.ink;
      pad.ctx.beginPath();
      pad.ctx.arc(last.x, last.y, pad.width * 0.6, 0, Math.PI * 2);
      pad.ctx.fill();
    });
    c.addEventListener('pointermove', function (e) {
      if (!last) return;
      var pt = pos(e);
      var mid = { x: (last.x + pt.x) / 2, y: (last.y + pt.y) / 2 };
      // Smooth curve through midpoints; pen pressure varies the width a little.
      var ctx = pad.ctx;
      ctx.strokeStyle = pad.ink;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = pad.width * (e.pointerType === 'pen' ? 0.6 + pt.p : 1.2);
      ctx.beginPath();
      ctx.moveTo(lastMid.x, lastMid.y);
      ctx.quadraticCurveTo(last.x, last.y, mid.x, mid.y);
      ctx.stroke();
      last = pt;
      lastMid = mid;
    });
    var end = function () { last = null; };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  // Fonts load on first use; ask for them early so the canvas can draw with them.
  function preloadSigFonts() {
    if (!document.fonts || !document.fonts.load) return;
    SIG_FONTS.slice(0, 4).forEach(function (f) { document.fonts.load('40px ' + f, 'Signature'); });
  }

  function renderTypeStyles() {
    var box = $('type-styles');
    var name = $('type-name').value.trim() || 'Your name';
    box.innerHTML = '';
    SIG_FONTS.forEach(function (font, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'type-style';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(i === typeStyle));
      b.style.fontFamily = font;
      if (i === SIG_FONTS.length - 1) b.style.fontStyle = 'italic';
      b.textContent = name;
      b.onclick = function () { typeStyle = i; renderTypeStyles(); };
      box.appendChild(b);
    });
  }

  function typedSignature() {
    var name = $('type-name').value.trim();
    if (!name) return null;
    var c = document.createElement('canvas');
    var ctx = c.getContext('2d');
    var font = (typeStyle === SIG_FONTS.length - 1 ? 'italic ' : '') + '120px ' + SIG_FONTS[typeStyle];
    ctx.font = font;
    var w = Math.ceil(ctx.measureText(name).width) + 80;
    c.width = w;
    c.height = 220;
    ctx.font = font;
    ctx.fillStyle = pad.ink;
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 40, 115);
    return trim(c);
  }

  function processUpload() {
    if (!uploadSource) return null;
    var src = uploadSource;
    var k = Math.min(1, 1400 / Math.max(src.width, src.height));
    var c = document.createElement('canvas');
    c.width = Math.round(src.width * k);
    c.height = Math.round(src.height * k);
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0, c.width, c.height);
    var img = ctx.getImageData(0, 0, c.width, c.height), d = img.data;
    var cut = (+$('threshold').value / 100) * 255, soft = cut * 0.35;
    // Light paper becomes transparent; ink keeps its colour with smooth edges.
    for (var i = 0; i < d.length; i += 4) {
      var lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      var a = Math.max(0, Math.min(1, (cut - lum) / soft));
      d[i + 3] = Math.round(a * (d[i + 3]));
    }
    ctx.putImageData(img, 0, 0);
    return trim(c);
  }

  function showUploadPreview() {
    var out = processUpload();
    var prev = $('upload-canvas');
    $('upload-preview').hidden = !out;
    $('threshold-field').hidden = !out;
    if (!out) return;
    prev.width = out.width;
    prev.height = out.height;
    prev.getContext('2d').drawImage(out, 0, 0);
  }

  // Crops to the ink, with a little padding.
  function trim(c) {
    var ctx = c.getContext('2d', { willReadFrequently: true });
    var d = ctx.getImageData(0, 0, c.width, c.height).data;
    var minX = c.width, minY = c.height, maxX = -1, maxY = -1;
    for (var y = 0; y < c.height; y++) {
      for (var x = 0; x < c.width; x++) {
        if (d[(y * c.width + x) * 4 + 3] > 16) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    var padPx = 6;
    minX = Math.max(0, minX - padPx); minY = Math.max(0, minY - padPx);
    maxX = Math.min(c.width - 1, maxX + padPx); maxY = Math.min(c.height - 1, maxY + padPx);
    var out = document.createElement('canvas');
    out.width = maxX - minX + 1;
    out.height = maxY - minY + 1;
    out.getContext('2d').drawImage(c, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }

  function finishSignature() {
    var canvas = currentTab === 'draw' ? (pad.hasInk ? trim(pad.canvas) : null)
      : currentTab === 'type' ? typedSignature() : processUpload();
    if (!canvas) {
      toast(currentTab === 'draw' ? 'Draw your signature first.' : currentTab === 'type' ? 'Type your name first.' : 'Choose an image first.');
      return false;
    }
    var sig = { id: state.nextId++, url: canvas.toDataURL('image/png'), w: canvas.width, h: canvas.height };
    state.signatures.push(sig);
    state.activeSig = sig.id;
    renderSigList();
    if (sigCallback) sigCallback(sig);
    else toast('Signature ready. Click on the page to place it.');
    sigCallback = null;
    if (state.tool !== 'signature') setTool('signature');
    return true;
  }

  function renderSigList() {
    var box = $('sig-list');
    box.innerHTML = '';
    state.signatures.forEach(function (s) {
      var b = document.createElement('div');
      b.className = 'sig-item';
      b.setAttribute('role', 'button');
      b.tabIndex = 0;
      b.setAttribute('aria-pressed', String(s.id === state.activeSig));
      b.innerHTML = '<img alt="Signature"><button type="button" class="sig-x" aria-label="Remove signature">×</button>';
      b.querySelector('img').src = s.url;
      b.onclick = function (e) {
        if (e.target.classList.contains('sig-x')) {
          // Hidden rather than deleted, so copies already placed on the page keep their image.
          s.hidden = true;
          if (state.activeSig === s.id) {
            var next = state.signatures.filter(function (x) { return !x.hidden; })[0];
            state.activeSig = next ? next.id : null;
          }
          renderSigList();
          return;
        }
        state.activeSig = s.id;
        setTool('signature');
        renderSigList();
      };
      if (!s.hidden) box.appendChild(b);
    });
  }

  /* ---------- saving ---------- */

  function download() {
    if (!state.bytes || state.busy) return;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    state.busy = true;
    $('download-btn').disabled = true;
    setStatus('Saving…');
    var PDFLib = window.PDFLib;
    var doc, font;
    PDFLib.PDFDocument.load(state.bytes, { ignoreEncryption: true }).then(function (d) {
      doc = d;
      return doc.embedFont(PDFLib.StandardFonts.Helvetica);
    }).then(function (f) {
      font = f;
      fillForm(doc, font);
      var chain = Promise.resolve(), images = {};
      state.elements.forEach(function (e) {
        chain = chain.then(function () { return drawElement(doc, font, e, images); });
      });
      return chain;
    }).then(function () {
      if ($('flatten').checked && state.fields.length) {
        try { doc.getForm().flatten(); } catch (err) { console.warn('flatten failed', err); }
      }
      doc.setModificationDate(new Date());
      return doc.save();
    }).then(function (bytes) {
      var name = state.name.replace(/\.pdf$/i, '') + '-signed.pdf';
      var blob = new Blob([bytes], { type: 'application/pdf' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 15000);
      setStatus('Saved ' + name);
    }).catch(function (err) {
      console.error(err);
      setStatus('Couldn\'t save the PDF: ' + (err.message || err), true);
    }).then(function () {
      state.busy = false;
      $('download-btn').disabled = false;
    });
  }

  function fillForm(doc, font) {
    var names = Object.keys(state.dirtyFields);
    if (!names.length) return;
    var form = doc.getForm();
    names.forEach(function (name) {
      var v = state.fieldValues[name];
      var f = state.fields.filter(function (x) { return x.name === name; })[0];
      try {
        if (f.kind === 'text') form.getTextField(name).setText(v || '');
        else if (f.kind === 'checkbox') { var cb = form.getCheckBox(name); if (v) cb.check(); else cb.uncheck(); }
        else if (f.kind === 'radio') {
          if (v) {
            var rg = form.getRadioGroup(name), ropts = rg.getOptions();
            // Some forms name their options by index ("0", "1"…) and keep labels in /Opt.
            rg.select(ropts.indexOf(v) >= 0 ? v : ropts[+v] !== undefined ? ropts[+v] : v);
          }
        }
        else if (f.kind === 'choice') {
          var field = form.getField(name);
          var label = (f.options.filter(function (o) { return o.value === v; })[0] || {}).label;
          var opts = field.getOptions();
          var pick = opts.indexOf(v) >= 0 ? v : opts.indexOf(label) >= 0 ? label : null;
          if (pick) field.select(pick); else if (!v && field.clear) field.clear();
        }
      } catch (err) {
        console.warn('Could not set field', name, err);
      }
    });
    try { form.updateFieldAppearances(font); } catch (err) { console.warn(err); }
  }

  function drawElement(doc, font, e, images) {
    var PDFLib = window.PDFLib;
    var p = state.pages[e.page];
    var vp = p.vp1, page = doc.getPage(e.page);
    var rot = PDFLib.degrees(vp.rotation);
    var X = e.x * vp.width, Y = e.y * vp.height;
    function pdfPt(x, y) { var q = vp.convertToPdfPoint(x, y); return { x: q[0], y: q[1] }; }

    if (e.type === 'whiteout') {
      var a = pdfPt(X, Y + e.h * vp.height);
      page.drawRectangle({ x: a.x, y: a.y, width: e.w * vp.width, height: e.h * vp.height, color: PDFLib.rgb(1, 1, 1), rotate: rot });
      return;
    }
    if (e.type === 'text') {
      if (!e.text.trim()) return;
      var lines = e.text.split('\n');
      var encodable = true;
      try { lines.forEach(function (l) { font.encodeText(l); }); } catch (err) { encodable = false; }
      if (encodable) {
        lines.forEach(function (line, i) {
          var base = Y + i * e.size * 1.25 + e.size * 0.975;
          var q = pdfPt(X + 1, base);
          page.drawText(line, { x: q.x, y: q.y, size: e.size, font: font, color: hexToRgb(e.color), rotate: rot });
        });
        return;
      }
      // Characters outside the standard PDF font (e.g. emoji, CJK) are drawn as an image instead.
      var img = textImage(e);
      return doc.embedPng(img.bytes).then(function (png) {
        var q = pdfPt(X, Y + img.hPt);
        page.drawImage(png, { x: q.x, y: q.y, width: img.wPt, height: img.hPt, rotate: rot });
      });
    }
    var key = e.type === 'signature' ? 'sig' + e.sigId : e.type + e.color;
    var getPng = images[key] || (images[key] = pngBytes(e).then(function (b) { return doc.embedPng(b); }));
    return getPng.then(function (png) {
      var q = pdfPt(X, Y + e.h * vp.height);
      page.drawImage(png, { x: q.x, y: q.y, width: e.w * vp.width, height: e.h * vp.height, rotate: rot });
    });
  }

  function pngBytes(e) {
    if (e.type === 'signature') {
      var url = sigById(e.sigId).url;
      return Promise.resolve(dataUrlBytes(url));
    }
    return Promise.resolve(dataUrlBytes(markCanvas(e.type, e.color, 256).toDataURL('image/png')));
  }

  function dataUrlBytes(url) {
    var bin = atob(url.split(',')[1]);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function textImage(e) {
    var scale = 4;
    var lines = e.text.split('\n');
    var c = document.createElement('canvas');
    var ctx = c.getContext('2d');
    var font = e.size * scale + 'px Helvetica, Arial, sans-serif';
    ctx.font = font;
    var w = Math.max.apply(null, lines.map(function (l) { return ctx.measureText(l).width; })) + 4;
    var lh = e.size * 1.25 * scale;
    c.width = Math.ceil(w);
    c.height = Math.ceil(lh * lines.length);
    ctx.font = font;
    ctx.fillStyle = e.color;
    ctx.textBaseline = 'alphabetic';
    lines.forEach(function (l, i) { ctx.fillText(l, 2, i * lh + e.size * 0.975 * scale); });
    return { bytes: dataUrlBytes(c.toDataURL('image/png')), wPt: c.width / scale, hPt: c.height / scale };
  }

  /* ---------- wiring ---------- */

  function bind() {
    $('open-btn').onclick = $('empty-open').onclick = function () { $('open-input').click(); };
    $('open-input').onchange = function () { openFile(this.files[0]); this.value = ''; };
    Array.prototype.forEach.call(document.querySelectorAll('.stool'), function (b) {
      b.onclick = function () { setTool(b.dataset.tool); };
    });
    $('detect-btn').onclick = function () { detectFields(false); };
    $('zoom-in').onclick = function () { setZoom(state.zoom * 1.2); };
    $('zoom-out').onclick = function () { setZoom(state.zoom / 1.2); };
    $('zoom-fit').onclick = function () { setZoom(1); };
    $('download-btn').onclick = download;
    window.addEventListener('resize', function () { clearTimeout(bind.t); bind.t = setTimeout(layout, 120); });

    $('opt-size').oninput = function () {
      var e = elById(state.selected);
      if (!e || e.type !== 'text' || !(+this.value >= 4)) return;
      e.size = +this.value;
      renderAll();
    };
    $('opt-color').oninput = function () {
      var e = elById(state.selected);
      if (!e) return;
      e.color = this.value;
      renderAll();
    };
    $('opt-color').onchange = $('opt-size').onchange = function () { /* value already applied */ };
    $('opt-delete').onclick = function () { var e = elById(state.selected); if (e) removeElement(e); };
    $('opt-dup').onclick = function () {
      var e = elById(state.selected);
      if (!e) return;
      pushHistory();
      var c = Object.assign({}, e, { id: state.nextId++, x: Math.min(0.95, e.x + 0.02), y: Math.min(0.95, e.y + 0.02) });
      state.elements.push(c);
      state.selected = c.id;
      renderAll();
    };

    // Signature dialog
    $('new-sig').onclick = function () { openSigDialog(null); };
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      t.onclick = function () { selectTab(t.dataset.tab); };
    });
    bindPad();
    $('pad-clear').onclick = clearPad;
    Array.prototype.forEach.call(document.querySelectorAll('.ink'), function (b) {
      b.onclick = function () {
        pad.ink = b.dataset.ink;
        Array.prototype.forEach.call(document.querySelectorAll('.ink'), function (x) { x.setAttribute('aria-checked', String(x === b)); });
        Array.prototype.forEach.call(document.querySelectorAll('.type-style'), function (x) { x.style.color = pad.ink; });
      };
    });
    $('pen-width').oninput = function () { pad.width = +this.value; };
    $('type-name').oninput = renderTypeStyles;
    $('sig-file').onchange = function () {
      var f = this.files[0];
      if (!f) return;
      createImageBitmap(f).then(function (bmp) {
        uploadSource = bmp;
        showUploadPreview();
      }, function () { toast('That image can\'t be opened.'); });
    };
    $('threshold').oninput = function () {
      $('threshold-out').textContent = this.value + '%';
      showUploadPreview();
    };
    $('sig-dialog').querySelector('form').addEventListener('submit', function (e) {
      var submitter = e.submitter;
      if (submitter && submitter.value === 'ok' && !finishSignature()) e.preventDefault();
    });
    $('sig-dialog').addEventListener('close', function () {
      if ($('sig-dialog').returnValue !== 'ok') sigCallback = null;
      if (!state.activeSig && state.tool === 'signature') setTool('select');
    });

    // Drop a PDF anywhere
    document.addEventListener('dragover', function (e) {
      if (e.dataTransfer.types.indexOf('Files') < 0) return;
      e.preventDefault();
      document.body.classList.add('file-hover');
    });
    document.addEventListener('dragleave', function (e) { if (!e.relatedTarget) document.body.classList.remove('file-hover'); });
    document.addEventListener('drop', function (e) {
      document.body.classList.remove('file-hover');
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      if ($('sig-dialog').open) return;
      openFile(e.dataTransfer.files[0]);
    });

    var KEYS = { v: 'select', t: 'text', s: 'signature', d: 'date', w: 'whiteout' };
    document.addEventListener('keydown', function (e) {
      var t = e.target;
      if (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || $('sig-dialog').open) return;
      var mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); $('open-input').click(); return; }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); download(); return; }
      if (mod) return;
      var sel = elById(state.selected);
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); removeElement(sel); return; }
      if (e.key === 'Escape') { state.selected = null; refreshSelection(); setTool('select'); return; }
      if (sel && e.key.indexOf('Arrow') === 0) {
        e.preventDefault();
        var p = state.pages[sel.page], step = (e.shiftKey ? 10 : 1);
        if (e.key === 'ArrowLeft') sel.x -= step / p.vp1.width;
        if (e.key === 'ArrowRight') sel.x += step / p.vp1.width;
        if (e.key === 'ArrowUp') sel.y -= step / p.vp1.height;
        if (e.key === 'ArrowDown') sel.y += step / p.vp1.height;
        renderAll();
        return;
      }
      if (KEYS[e.key.toLowerCase()]) setTool(KEYS[e.key.toLowerCase()]);
    });
  }

  bind();
  preloadSigFonts();
  setTool('select');
})();
