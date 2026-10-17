/*
 * About page effects: sections fade in as they scroll into view, and glass cards glow
 * where the pointer is.
 */
(function () {
  'use strict';

  document.documentElement.classList.add('js');

  var items = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        io.unobserve(e.target);
      });
    }, { threshold: 0.12 });
    Array.prototype.forEach.call(items, function (el, i) {
      el.style.transitionDelay = (i % 4) * 70 + 'ms';
      io.observe(el);
    });
  } else {
    Array.prototype.forEach.call(items, function (el) { el.classList.add('in'); });
  }

  // Licence status, with a way to remove the licence from this browser.
  var L = window.StudioloLicense;
  var title = document.getElementById('licence-title');
  if (L && title) {
    var detail = document.getElementById('licence-detail'), actions = document.getElementById('licence-actions');
    var lic = L.current();
    var btn = document.createElement('a');
    btn.className = 'btn';
    if (lic) {
      title.textContent = lic.name ? 'Licensed to ' + lic.name : 'Studiolo is activated on this browser';
      detail.textContent = 'Licence ' + lic.masked + '. Thank you for supporting Studiolo.';
      var rename = document.createElement('a');
      rename.className = 'btn';
      rename.href = '#';
      rename.textContent = 'Change name';
      rename.addEventListener('click', function (e) {
        e.preventDefault();
        var name = window.prompt('Your name, as shown in Studiolo:', lic.name || '');
        if (name === null || !name.trim()) return;
        L.setName(name);
        window.location.reload();
      });
      actions.appendChild(rename);
      btn.href = '#';
      btn.textContent = 'Remove licence from this browser';
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        if (!window.confirm('Remove the licence from this browser? You will need your code to use Studiolo again.')) return;
        L.remove();
        window.location.reload();
      });
    } else {
      title.textContent = 'Not activated yet';
      detail.textContent = 'Studiolo needs a licence code. Contact ' + L.contact + ' to get one.';
      btn.href = 'index.html';
      btn.textContent = 'Enter a licence code';
      btn.className = 'btn primary';
    }
    actions.appendChild(btn);
  }

  Array.prototype.forEach.call(document.querySelectorAll('.glass'), function (card) {
    card.addEventListener('pointermove', function (e) {
      var r = card.getBoundingClientRect();
      card.style.setProperty('--mx', e.clientX - r.left + 'px');
      card.style.setProperty('--my', e.clientY - r.top + 'px');
    });
  });
})();
