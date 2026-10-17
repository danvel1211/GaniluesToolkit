/*
 * Tool palette with Photoshop-style groups: each toolbar button holds a group of related tools.
 * Right-click, long-press or the corner triangle opens the group's flyout to pick a sub-tool.
 */
(function (global) {
  'use strict';

  var ICONS = {
    move: '<path d="M5 3l12 8-5 1.5L9 18z"/>',
    'marquee-rect': '<rect x="4" y="5" width="16" height="14" stroke-dasharray="3 2.6"/>',
    'marquee-ellipse': '<ellipse cx="12" cy="12" rx="8.5" ry="7" stroke-dasharray="3 2.6"/>',
    lasso: '<path d="M7.5 16.5C4.8 15.4 3 13.4 3 11c0-3.9 4-7 9-7s9 3.1 9 7-4 7-9 7c-1.1 0-2.2-.1-3.2-.4M7.5 16.5c-1.2 1-1.4 3.2.3 3.9"/>',
    wand: '<path d="M4 20L15 9M15 3v2.5M20.5 8.5H18M18.7 4.8l-1.6 1.6M11 4.8l1.3 1.3M18.7 12.6l-1.3-1.3"/>',
    brush: '<path d="M14 4l6 6-8.5 8.5a3 3 0 01-2 .9L5 20l.6-4.5a3 3 0 01.9-2z"/>',
    pencil: '<path d="M4 20l1.2-4.4L16 4.8l3.2 3.2L8.4 18.8zM14 7l3 3"/>',
    spray: '<path d="M6 10h7v10H6zM7.5 10V7h4v3M16 6h.01M19 4h.01M19 8h.01M22 6h.01M16.5 10h.01"/>',
    eraser: '<path d="M15 4l5 5-9 9H6l-3-3zM9 20h11"/>',
    'magic-eraser': '<path d="M13 6l5 5-8 8H6l-3-3zM8 20h9M19 2v4M17 4h4"/>',
    bucket: '<path d="M4.5 11.5l7-7 7 7-7 7zM4.5 11.5h14M20 15.5s1.8 2.2 1.8 3.6a1.8 1.8 0 01-3.6 0c0-1.4 1.8-3.6 1.8-3.6z"/>',
    gradient: '<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M8 5v14M12.5 5v14M16.5 5v14" stroke-dasharray="1.5 2"/>',
    text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
    'text-vertical': '<path d="M4 5h9M8.5 5v12M18 4v16M15 17l3 3 3-3"/>',
    rect: '<rect x="4" y="5" width="16" height="14" rx="1"/>',
    ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="7"/>',
    line: '<path d="M5 19L19 5"/>',
    triangle: '<path d="M12 4l9 16H3z"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.5 2.9 1-6.1-4.3-4.3 6.1-.9z"/>',
    crop: '<path d="M6 2v16h16M2 6h16v16"/>',
    eyedropper: '<path d="M17 3a3 3 0 014 4l-3 3-4-4zM14 6l-9 9v4h4l9-9"/>',
    hand: '<path d="M8 13V5a1.5 1.5 0 013 0v6-8a1.5 1.5 0 013 0v8-6a1.5 1.5 0 013 0v9a7 7 0 01-7 7h-1a6 6 0 01-5-3l-3-5a1.5 1.5 0 012.5-1.6L8 15"/>',
    zoom: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M8 10.5h5M10.5 8v5"/>'
  };

  // Groups in toolbar order. Each tool: [id, name, short label, shortcut key].
  var GROUPS = [
    { id: 'move', tools: [['move', 'Move & transform', 'Move', 'V']] },
    { id: 'select', tools: [['marquee-rect', 'Rectangle select', 'Select', 'M'], ['marquee-ellipse', 'Ellipse select', 'Ellipse', 'M'], ['lasso', 'Lasso (freehand select)', 'Lasso', 'L'], ['wand', 'Magic wand (select similar colour)', 'Wand', 'W']] },
    { id: 'brush', tools: [['brush', 'Brush', 'Brush', 'B'], ['pencil', 'Pencil (hard edge)', 'Pencil', 'B'], ['spray', 'Spray paint', 'Spray', 'B']] },
    { id: 'eraser', tools: [['eraser', 'Eraser', 'Eraser', 'E'], ['magic-eraser', 'Magic eraser', 'Magic', 'E']] },
    { id: 'fill', tools: [['bucket', 'Paint bucket', 'Fill', 'G'], ['gradient', 'Gradient', 'Gradient', 'G']] },
    { id: 'text', tools: [['text', 'Horizontal text', 'Text', 'T'], ['text-vertical', 'Vertical text', 'V-Text', 'T']] },
    { id: 'shape', tools: [['rect', 'Rectangle', 'Rect', 'U'], ['ellipse', 'Ellipse', 'Ellipse', 'U'], ['line', 'Line', 'Line', 'U'], ['triangle', 'Triangle', 'Triangle', 'U'], ['star', 'Star', 'Star', 'U']] },
    { id: 'crop', tools: [['crop', 'Crop', 'Crop', 'C']] },
    { id: 'eyedropper', tools: [['eyedropper', 'Colour picker', 'Picker', 'I']] },
    { id: 'hand', tools: [['hand', 'Hand (pan)', 'Hand', 'H'], ['zoom', 'Zoom (Alt-click to zoom out)', 'Zoom', 'Z']] }
  ];

  var LONG_PRESS_MS = 450;

  var container, onSelect, flyout = null;
  var current = {}; // group id → tool id last used in that group
  var active = 'move';

  function icon(id) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[id] + '</svg>';
  }

  function find(toolId) {
    for (var g = 0; g < GROUPS.length; g++) {
      for (var t = 0; t < GROUPS[g].tools.length; t++) {
        if (GROUPS[g].tools[t][0] === toolId) return { group: GROUPS[g], tool: GROUPS[g].tools[t] };
      }
    }
    return null;
  }

  function render() {
    closeFlyout();
    container.innerHTML = '';
    GROUPS.forEach(function (g) {
      var t = find(current[g.id]).tool;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'tool';
      b.dataset.group = g.id;
      b.title = t[1] + ' (' + t[3] + ')' + (g.tools.length > 1 ? ' · right-click for more' : '');
      b.setAttribute('aria-pressed', String(find(active).group === g));
      if (g.tools.length > 1) b.setAttribute('aria-haspopup', 'menu');
      b.innerHTML = icon(t[0]) + '<span>' + t[2] + '</span>' +
        (g.tools.length > 1 ? '<i class="flyout-mark" aria-hidden="true"></i>' : '');

      var pressTimer = null, opened = false;
      b.addEventListener('pointerdown', function (e) {
        opened = false;
        if (g.tools.length < 2 || e.button !== 0) return;
        pressTimer = setTimeout(function () { opened = true; openFlyout(g, b); }, LONG_PRESS_MS);
      });
      var cancel = function () { clearTimeout(pressTimer); };
      b.addEventListener('pointerup', cancel);
      b.addEventListener('pointerleave', cancel);
      b.addEventListener('click', function (e) {
        if (opened) return;
        if (g.tools.length > 1 && e.target.classList.contains('flyout-mark')) { openFlyout(g, b); return; }
        select(current[g.id]);
      });
      b.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        cancel();
        if (g.tools.length > 1) openFlyout(g, b);
      });
      b.addEventListener('keydown', function (e) {
        if (g.tools.length > 1 && (e.key === 'ArrowRight' || e.key === 'ArrowDown' || (e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu')) {
          e.preventDefault();
          openFlyout(g, b, true);
        }
      });
      container.appendChild(b);
    });
  }

  function openFlyout(g, anchor, focusFirst) {
    closeFlyout();
    var menu = document.createElement('div');
    menu.className = 'flyout';
    menu.setAttribute('role', 'menu');
    g.tools.forEach(function (t) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'flyout-item';
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(t[0] === current[g.id]));
      item.innerHTML = '<span class="check" aria-hidden="true">' + (t[0] === current[g.id] ? '●' : '') + '</span>' +
        icon(t[0]) + '<span class="flyout-name">' + t[1] + '</span><kbd>' + t[3] + '</kbd>';
      item.onclick = function () { select(t[0]); };
      menu.appendChild(item);
    });
    document.body.appendChild(menu);
    var r = anchor.getBoundingClientRect();
    var mw = menu.offsetWidth, mh = menu.offsetHeight;
    var left = r.right + 6, top = r.top;
    if (left + mw > window.innerWidth - 8) left = Math.max(8, r.left); // narrow screens: drop below
    if (left !== r.right + 6) top = r.bottom + 6;
    top = Math.max(8, Math.min(top, window.innerHeight - mh - 8));
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menu.addEventListener('keydown', function (e) {
      var items = Array.prototype.slice.call(menu.querySelectorAll('.flyout-item'));
      var i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      else if (e.key === 'Escape' || e.key === 'ArrowLeft') { e.preventDefault(); closeFlyout(); anchor.focus(); }
    });
    flyout = menu;
    var focusIdx = 0;
    g.tools.forEach(function (t, i) { if (t[0] === current[g.id]) focusIdx = i; });
    if (focusFirst) menu.querySelectorAll('.flyout-item')[focusIdx].focus();
    setTimeout(function () { document.addEventListener('pointerdown', outside, true); }, 0);
  }

  function outside(e) {
    if (flyout && !flyout.contains(e.target)) closeFlyout();
  }

  function closeFlyout() {
    if (!flyout) return;
    flyout.remove();
    flyout = null;
    document.removeEventListener('pointerdown', outside, true);
  }

  function select(toolId) {
    var f = find(toolId);
    if (!f) return;
    current[f.group.id] = toolId;
    active = toolId;
    render();
    onSelect(toolId);
  }

  // Keyboard shortcut: picks the group's current tool for that key; Shift cycles through the tools sharing it.
  function shortcut(key, cycle) {
    key = key.toUpperCase();
    var matches = [];
    GROUPS.forEach(function (g) { g.tools.forEach(function (t) { if (t[3] === key) matches.push(t[0]); }); });
    if (!matches.length) return false;
    var pick;
    if (cycle && matches.indexOf(active) >= 0) {
      pick = matches[(matches.indexOf(active) + 1) % matches.length];
    } else {
      pick = matches.filter(function (id) { return current[find(id).group.id] === id; })[0] || matches[0];
    }
    select(pick);
    return true;
  }

  function init(el, callback) {
    container = el;
    onSelect = callback;
    GROUPS.forEach(function (g) { current[g.id] = g.tools[0][0]; });
    render();
    window.addEventListener('resize', closeFlyout);
    window.addEventListener('blur', closeFlyout);
  }

  global.Toolbar = { init: init, select: select, shortcut: shortcut, close: closeFlyout };
})(window);
