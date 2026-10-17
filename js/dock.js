/*
 * Floating tool switcher: a glass pill at the top of every page with one button per tool.
 * It replaces the small text links under each page title (.appnav). An edition that adds an
 * About page (a link to about.html in .appnav) gets an About button too.
 */
(function () {
  'use strict';

  var ICON = {
    home: '<path d="M4 11l8-7 8 7v8a1 1 0 01-1 1h-4v-6h-6v6H5a1 1 0 01-1-1z"/>',
    pdf: '<rect x="4" y="3" width="11" height="14" rx="2"/><path d="M9 21h9a2 2 0 002-2V8"/>',
    sign: '<path d="M3 17c3-4 5-9 7-9s-1 9 1 9 3-4 5-4 1 4 3 4"/><path d="M3 21h18"/>',
    editor: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>',
    collage: '<rect x="3" y="3" width="8" height="10" rx="1.5"/><rect x="13" y="3" width="8" height="6" rx="1.5"/><rect x="13" y="11" width="8" height="10" rx="1.5"/><rect x="3" y="15" width="8" height="6" rx="1.5"/>',
    converter: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
    about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'
  };

  var tools = [
    { id: 'home', href: 'index.html', label: 'Home' },
    { id: 'pdf', href: 'pdf.html', label: 'Combine' },
    { id: 'sign', href: 'sign.html', label: 'Sign' },
    { id: 'editor', href: 'editor.html', label: 'Editor' },
    { id: 'collage', href: 'collage.html', label: 'Collage' },
    { id: 'converter', href: 'converter.html', label: 'Converter' }
  ];
  if (document.querySelector('.appnav a[href="about.html"], a.home-link[href="about.html"]') ||
      /about\.html$/i.test(location.pathname)) {
    tools.push({ id: 'about', href: 'about.html', label: 'About' });
  }

  var page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();

  var nav = document.createElement('nav');
  nav.className = 'dock';
  nav.setAttribute('aria-label', 'Switch tool');
  var glow = document.createElement('span');
  glow.className = 'dock-glow';
  glow.setAttribute('aria-hidden', 'true');
  nav.appendChild(glow);

  var active = null;
  tools.forEach(function (t) {
    var a = document.createElement('a');
    a.className = 'dock-btn';
    a.href = t.href;
    a.title = t.label;
    a.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[t.id] + '</svg><span>' + t.label + '</span>';
    if (t.href === page) {
      a.setAttribute('aria-current', 'page');
      active = a;
    }
    nav.appendChild(a);
  });

  // The glow sits behind the current tool and slides to whichever button is hovered.
  function moveGlow(target) {
    if (!target) { glow.style.opacity = '0'; return; }
    glow.style.opacity = '1';
    glow.style.width = target.offsetWidth + 'px';
    glow.style.transform = 'translateX(' + target.offsetLeft + 'px)';
  }
  nav.addEventListener('pointerover', function (e) {
    var b = e.target.closest && e.target.closest('.dock-btn');
    if (b) moveGlow(b);
  });
  nav.addEventListener('pointerleave', function () { moveGlow(active); });
  nav.addEventListener('focusin', function (e) { moveGlow(e.target.closest('.dock-btn')); });
  nav.addEventListener('focusout', function () { moveGlow(active); });

  document.body.insertBefore(nav, document.body.firstChild);
  document.body.classList.add('has-dock');

  function place() {
    glow.style.transition = 'none';
    moveGlow(active);
    void glow.offsetWidth;
    glow.style.transition = '';
  }
  place();
  window.addEventListener('resize', place);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
})();
