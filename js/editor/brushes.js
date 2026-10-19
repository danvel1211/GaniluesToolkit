/*
 * Brush styles for the Brush and Eraser tools, and the right-click "Brush style" menu.
 *
 * Every style draws into a stroke canvas by stamping along the pointer path; the editor then
 * composes that stroke onto the layer (painting it, or erasing with it). Because the eraser uses
 * the same stamps, a "Chalk" eraser or a "Soft" eraser works exactly like the matching brush.
 */
(function (global) {
  'use strict';

  // style 'round' is the classic stroke (its edge softness comes from the Softness slider);
  // the other styles are stamped.
  var PRESETS = [
    { id: 'hard', name: 'Hard round', style: 'round', soft: 0 },
    { id: 'soft', name: 'Soft round', style: 'round', soft: 70 },
    { id: 'airbrush', name: 'Airbrush', style: 'airbrush' },
    { id: 'marker', name: 'Square marker', style: 'marker' },
    { id: 'calligraphy', name: 'Calligraphy', style: 'calligraphy' },
    { id: 'chalk', name: 'Chalk', style: 'chalk' },
    { id: 'bristle', name: 'Dry bristle', style: 'bristle' }
  ];

  function preset(id) {
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i];
    return PRESETS[0];
  }

  function rgba(hex, a) {
    var n = parseInt(String(hex).replace('#', ''), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  // Per-stroke data: bristles keep the same pattern all along one stroke, which is what makes streaks.
  function newParams(style, width) {
    var p = { style: style, width: width };
    if (style === 'bristle') {
      var count = Math.max(8, Math.min(46, Math.round(width * 0.9)));
      p.bristles = [];
      for (var i = 0; i < count; i++) {
        var d = (width / 2) * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
        p.bristles.push({
          dx: Math.cos(a) * d, dy: Math.sin(a) * d,
          r: Math.max(0.5, width / 28 + Math.random() * width / 36),
          alpha: 0.45 + Math.random() * 0.55, gap: 0.55 + Math.random() * 0.4
        });
      }
    }
    return p;
  }

  function spacingFor(style, w) {
    switch (style) {
      case 'airbrush': return Math.max(1, w * 0.07);
      case 'chalk': return Math.max(1, w * 0.22);
      case 'bristle': return Math.max(1, w * 0.08);
      case 'calligraphy': return Math.max(0.75, w * 0.05);
      default: return Math.max(1, w * 0.1);
    }
  }

  function stampOne(ctx, p, color, x, y) {
    var w = p.width, r = w / 2, i;
    switch (p.style) {
      case 'airbrush': {
        var g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, rgba(color, 0.12));
        g.addColorStop(0.5, rgba(color, 0.06));
        g.addColorStop(1, rgba(color, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, w, w);
        break;
      }
      case 'marker':
        ctx.fillStyle = color;
        ctx.fillRect(x - r, y - r, w, w);
        break;
      case 'calligraphy':
        ctx.fillStyle = color;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-Math.PI / 4);
        ctx.scale(1, 0.2);
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
      case 'chalk': {
        var grains = Math.max(6, Math.round(w * 0.9)), top = Math.max(1, w / 14);
        ctx.fillStyle = color;
        for (i = 0; i < grains; i++) {
          var d = r * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2, s = 1 + Math.random() * top;
          ctx.globalAlpha = 0.3 + Math.random() * 0.7;
          ctx.fillRect(x + Math.cos(a) * d, y + Math.sin(a) * d, s, s);
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'bristle':
        ctx.fillStyle = color;
        for (i = 0; i < p.bristles.length; i++) {
          var b = p.bristles[i];
          if (Math.random() > b.gap) continue;
          ctx.globalAlpha = b.alpha;
          ctx.beginPath();
          ctx.arc(x + b.dx, y + b.dy, b.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        break;
    }
  }

  // Stamps the style along from → q. `first` stamps once at the start of a stroke.
  function stamp(ctx, p, color, from, q) {
    var dist = Math.hypot(q.x - from.x, q.y - from.y);
    if (dist === 0) return stampOne(ctx, p, color, q.x, q.y);
    var step = spacingFor(p.style, p.width), n = Math.max(1, Math.ceil(dist / step));
    for (var i = 1; i <= n; i++) {
      stampOne(ctx, p, color, from.x + ((q.x - from.x) * i) / n, from.y + ((q.y - from.y) * i) / n);
    }
  }

  // The classic round stroke, here only for the previews (the editor draws its own).
  function roundLine(ctx, width, soft, color, from, q) {
    var shift = 0;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    if (soft > 0) {
      shift = 100000;
      ctx.shadowColor = color;
      ctx.shadowBlur = (width * soft) / 100;
      ctx.shadowOffsetX = shift;
    }
    ctx.beginPath();
    ctx.moveTo(from.x - shift, from.y);
    ctx.lineTo(q.x - shift + (from === q ? 0.01 : 0), q.y);
    ctx.stroke();
  }

  // A small wavy sample stroke for the menu.
  function drawPreview(canvas, pr, color, width) {
    var dpr = window.devicePixelRatio || 1, w = canvas.clientWidth || 130, h = canvas.clientHeight || 30;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    var params = newParams(pr.style, width), prev = null, x;
    for (x = 12; x <= w - 12; x += 2) {
      var pt = { x: x, y: h / 2 + Math.sin(((x - 12) / (w - 24)) * Math.PI * 2) * (h * 0.2) };
      if (pr.style === 'round') roundLine(ctx, width, pr.soft || 0, color, prev || pt, pt);
      else stamp(ctx, params, color, prev || pt, pt);
      prev = pt;
    }
  }

  /* ---------- the right-click menu ---------- */

  var menu = null;

  function close() {
    if (!menu) return;
    menu.remove();
    menu = null;
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', onKey, true);
  }
  function outside(e) { if (menu && !menu.contains(e.target)) close(); }
  function onKey(e) { if (e.key === 'Escape') close(); }

  /*
   * opts: { x, y, erase, color, current (preset id), size, opacity,
   *         onPick(preset), onSize(n), onOpacity(n) }
   */
  function openMenu(opts) {
    close();
    menu = document.createElement('div');
    menu.className = 'brush-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Brush style');

    var title = document.createElement('div');
    title.className = 'brush-menu-title';
    title.textContent = opts.erase ? 'Eraser style' : 'Brush style';
    menu.appendChild(title);

    var color = opts.erase ? '#9aa0b4' : opts.color;
    PRESETS.forEach(function (pr) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'brush-item';
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(pr.id === opts.current));
      var name = document.createElement('span');
      name.className = 'brush-name';
      name.textContent = pr.name;
      var cv = document.createElement('canvas');
      cv.className = 'brush-preview';
      item.appendChild(name);
      item.appendChild(cv);
      item.onclick = function () { opts.onPick(pr); close(); };
      menu.appendChild(item);
    });

    function slider(label, min, max, value, unit, onInput) {
      var row = document.createElement('label');
      row.className = 'brush-slider';
      var span = document.createElement('span');
      var out = document.createElement('output');
      out.textContent = value + unit;
      span.textContent = label + ' ';
      span.appendChild(out);
      var input = document.createElement('input');
      input.type = 'range';
      input.min = min;
      input.max = max;
      input.value = value;
      input.oninput = function () { out.textContent = input.value + unit; onInput(+input.value); };
      row.appendChild(span);
      row.appendChild(input);
      menu.appendChild(row);
    }
    slider('Size', 1, 300, opts.size, '', opts.onSize);
    slider('Opacity', 1, 100, Math.round(opts.opacity * 100), '%', opts.onOpacity);

    document.body.appendChild(menu);
    var mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = Math.max(8, Math.min(opts.x, window.innerWidth - mw - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(opts.y, window.innerHeight - mh - 8)) + 'px';

    // Previews need real sizes, so draw them once the menu is on the page.
    var previews = menu.querySelectorAll('.brush-preview');
    PRESETS.forEach(function (pr, i) { drawPreview(previews[i], pr, color, 14); });

    var checked = menu.querySelector('[aria-checked="true"]');
    (checked || menu.querySelector('.brush-item')).focus();
    var el = menu;
    el.addEventListener('keydown', function (e) {
      var items = Array.prototype.slice.call(el.querySelectorAll('.brush-item'));
      var i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    });
    setTimeout(function () {
      document.addEventListener('pointerdown', outside, true);
      document.addEventListener('keydown', onKey, true);
    }, 0);
  }

  global.Brushes = {
    PRESETS: PRESETS, preset: preset, newParams: newParams, stamp: stamp,
    openMenu: openMenu, close: close
  };
})(window);
