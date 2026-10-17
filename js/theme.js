/*
 * Applies the saved light/dark theme before the page paints (loaded in <head>).
 * Dark is the default. The choice is kept in this browser's localStorage only.
 */
(function () {
  'use strict';
  var theme = 'dark';
  try { theme = localStorage.getItem('studiolo-theme') || 'dark'; } catch (e) { /* storage blocked */ }
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
})();
