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

  Array.prototype.forEach.call(document.querySelectorAll('.glass'), function (card) {
    card.addEventListener('pointermove', function (e) {
      var r = card.getBoundingClientRect();
      card.style.setProperty('--mx', e.clientX - r.left + 'px');
      card.style.setProperty('--my', e.clientY - r.top + 'px');
    });
  });
})();
