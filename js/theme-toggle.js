/*
 * Adds the light/dark switch to the page header and the gradient used by an edition's logo.
 */
(function () {
  'use strict';

  var SUN = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/></svg>';

  var defs = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  defs.setAttribute('width', '0');
  defs.setAttribute('height', '0');
  defs.setAttribute('aria-hidden', 'true');
  defs.style.position = 'absolute';
  defs.innerHTML = '<defs><linearGradient id="logo-grad" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" style="stop-color: var(--logo-a, #7c6cff)"/><stop offset="1" style="stop-color: var(--logo-b, #3b82f6)"/></linearGradient></defs>';
  document.body.appendChild(defs);

  function current() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'theme-toggle';

  function label() {
    var dark = current() === 'dark';
    btn.innerHTML = (dark ? SUN : MOON) + '<span>' + (dark ? 'Light' : 'Dark') + '</span>';
    btn.title = dark ? 'Switch to the light theme' : 'Switch to the dark theme';
    btn.setAttribute('aria-label', btn.title);
  }

  btn.onclick = function () {
    var next = current() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('offtheclock-theme', next); } catch (e) { /* storage blocked */ }
    label();
    window.dispatchEvent(new CustomEvent('themechange', { detail: next }));
  };
  label();

  var header = document.querySelector('.topbar');
  if (header) {
    var menu = header.querySelector('.menu');
    if (menu) menu.appendChild(btn); else header.appendChild(btn);
  } else {
    document.body.appendChild(btn);
  }
})();
