/*
 * Studiolo licensing. Loaded in <head> of every Studiolo page, after nacl-fast.min.js and
 * license-codes.js.
 *
 * Licence codes look like 7KQ2-M9XA-P4TD-WZ3R. The app doesn't contain the codes themselves,
 * only one-way fingerprints of them (first 16 bytes of SHA-512(batch salt + code)), made by
 * tools/make_license_batch.py. A typed code is fingerprinted the same way and looked up, so a
 * code works if it's on the list, but the list can't be turned back into codes. Everything
 * happens offline.
 *
 * The person also enters their name when activating. It personalises the app ("Welcome,
 * Maria") but isn't checked against the code: codes are made in advance, before names are known.
 *
 * Pages are locked until a valid code is entered, except pages marked
 * <html data-license="optional"> (the About page), which only show the licence status.
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'studiolo-license';
  var CONTACT = 'danvel1211@gmail.com';
  // Readable form (license-codes.js): { batches: [{ id, salt, hashes: [hex…] }] }.
  // Packaged form (made by tools/build_editions.py): { b: [{ i, s, h: base64 of 16-byte fingerprints }] }.
  var data = global.STUDIOLO_LICENSE_DATA || { batches: [] };
  function blobToHex(b64) {
    var bin = atob(b64), out = [];
    for (var i = 0; i < bin.length; i += 16) {
      var h = '';
      for (var j = i; j < i + 16; j++) h += ('0' + bin.charCodeAt(j).toString(16)).slice(-2);
      out.push(h);
    }
    return out;
  }
  var lookups = (data.batches || data.b || []).map(function (b) {
    var set = {};
    (b.hashes || blobToHex(b.h)).forEach(function (h) { set[h] = true; });
    return { id: b.id || b.i, salt: b.salt || b.s, set: set };
  });

  /* ---------- checking a code ---------- */

  // Accepts lowercase, spaces and missing dashes; O/I/L/U are read as 0/1/1/V like Crockford base32.
  function normalise(code) {
    return String(code || '').toUpperCase().replace(/[\s-]/g, '')
      .replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
  }

  function format(raw) {
    return raw.replace(/(.{4})(?=.)/g, '$1-');
  }

  function hex(bytes, n) {
    var s = '';
    for (var i = 0; i < n; i++) s += ('0' + bytes[i].toString(16)).slice(-2);
    return s;
  }

  // Returns { ok: true, code, batch, masked } or { ok: false, reason }.
  function verify(code) {
    var raw = normalise(code);
    if (!raw) return { ok: false, reason: 'Enter your licence code.' };
    if (!/^[0-9A-HJKMNP-TV-Z]{16}$/.test(raw)) {
      return { ok: false, reason: 'A licence code has 16 letters and numbers, like 7KQ2-M9XA-P4TD-WZ3R.' };
    }
    if (!global.nacl) return { ok: false, reason: 'The licence checker did not load.' };
    for (var i = 0; i < lookups.length; i++) {
      var fp = hex(global.nacl.hash(new TextEncoder().encode(lookups[i].salt + raw)), 16);
      if (lookups[i].set[fp]) {
        return {
          ok: true, code: format(raw), batch: lookups[i].id, masked: '••••-••••-••••-' + raw.slice(12),
          developer: lookups[i].id === 'DEV' // the creator's own code
        };
      }
    }
    return { ok: false, reason: 'That licence code isn\'t recognised. Check for typos, or contact ' + CONTACT + '.' };
  }

  /* ---------- storage ---------- */

  var memory = null; // used when the browser blocks storage
  function load() {
    var raw;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { raw = memory; }
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return { code: raw, name: '' }; }
  }
  function save(code, name) {
    var raw = JSON.stringify({ code: code, name: name });
    memory = raw;
    try { localStorage.setItem(STORAGE_KEY, raw); } catch (e) { /* kept for this page only */ }
  }
  function clear() {
    memory = null;
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* nothing stored */ }
  }

  function current() {
    var stored = load();
    var r = stored ? verify(stored.code) : { ok: false };
    if (!r.ok) return null;
    r.name = stored.name || '';
    return r;
  }

  function cleanName(name) {
    return String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  }

  function setName(name) {
    var lic = current();
    if (lic) save(lic.code, cleanName(name));
  }

  /* ---------- activation screen ---------- */

  var root = document.documentElement;
  var optional = root.getAttribute('data-license') === 'optional';
  var licence = current();
  if (!licence && !optional) root.classList.add('license-locked');

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }

  function buildGate() {
    var icon = document.querySelector('link[rel="icon"]');
    var nameInput = el('input', {
      id: 'license-name', type: 'text', autocomplete: 'name', maxlength: '40',
      placeholder: 'e.g. Maria Santos', 'aria-label': 'Your name'
    });
    var input = el('input', {
      id: 'license-input', type: 'text', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'characters',
      maxlength: '24', placeholder: 'XXXX-XXXX-XXXX-XXXX', 'aria-label': 'Licence code'
    });
    var msg = el('p', { id: 'license-msg', class: 'license-msg', role: 'status', 'aria-live': 'polite' });
    var btn = el('button', { type: 'submit', class: 'btn primary license-btn', text: 'Activate Studiolo' });
    var form = el('form', { class: 'license-form' }, [
      el('label', { for: 'license-name', text: 'Your name' }), nameInput,
      el('label', { for: 'license-input', text: 'Licence code' }), input, msg, btn
    ]);
    var card = el('div', { class: 'license-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'license-title' }, [
      icon ? el('img', { class: 'license-logo', src: icon.getAttribute('href'), alt: '' }) : el('span'),
      el('h2', { id: 'license-title', text: 'Activate Studiolo' }),
      el('p', { class: 'license-lead', text: 'Enter your name and the licence code you received to start using Studiolo on this browser.' }),
      form,
      el('p', { class: 'license-help' }, [
        document.createTextNode('Need a licence? Contact '),
        el('a', { href: 'mailto:' + CONTACT + '?subject=Studiolo%20licence', text: CONTACT }),
        document.createTextNode(' · '),
        el('a', { href: 'about.html', text: 'About Studiolo' })
      ]),
      el('p', { class: 'license-fine', text: 'Your code is checked on this device. Nothing is sent anywhere.' })
    ]);
    var gate = el('div', { id: 'license-gate' }, [card]);

    // Tidy the code into groups of four as it's typed or pasted.
    input.addEventListener('input', function () {
      var raw = normalise(input.value).slice(0, 16);
      var formatted = format(raw);
      if (formatted !== input.value) input.value = formatted;
      msg.textContent = '';
      msg.classList.remove('error');
    });

    nameInput.addEventListener('input', function () { msg.textContent = ''; msg.classList.remove('error'); });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = cleanName(nameInput.value);
      if (!name) {
        msg.textContent = 'Please enter your name.';
        msg.classList.add('error');
        nameInput.focus();
        return;
      }
      var r = verify(input.value);
      if (!r.ok) {
        msg.textContent = r.reason;
        msg.classList.add('error');
        input.focus();
        return;
      }
      save(r.code, name);
      r.name = name;
      msg.textContent = 'Welcome, ' + name.split(' ')[0] + '! Studiolo is activated.';
      btn.disabled = true;
      setTimeout(function () {
        root.classList.remove('license-locked');
        gate.remove();
        document.dispatchEvent(new CustomEvent('studiolo-licensed', { detail: r }));
      }, 700);
    });
    document.body.appendChild(gate);
    setTimeout(function () { nameInput.focus(); }, 50);
  }

  function buildBadge(r) {
    if (document.querySelector('.license-badge')) return;
    var badge = el('div', { class: 'license-badge', title: 'Licence ' + r.masked }, [
      el('span', { class: 'license-dot', 'aria-hidden': 'true' }),
      document.createTextNode((r.developer ? 'Developer · ' : 'Licensed to ') + (r.name || r.masked.slice(-4)))
    ]);
    document.body.appendChild(badge);
  }

  // "Good morning, Maria" above the title on the home screen.
  function buildGreeting(r) {
    var head = document.querySelector('.home-head');
    if (!head || !r.name || head.querySelector('.license-welcome')) return;
    var h = new Date().getHours();
    var hello = h < 5 ? 'Welcome back' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    var p = el('p', { class: 'license-welcome', text: hello + ', ' + r.name.split(' ')[0] });
    var title = head.querySelector('h1');
    head.insertBefore(p, title);
  }

  function personalise(r) {
    if (!document.body.classList.contains('home-page')) return;
    buildBadge(r);
    buildGreeting(r);
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (root.classList.contains('license-locked')) buildGate();
    else if (licence) personalise(licence);
  });
  document.addEventListener('studiolo-licensed', function (e) { personalise(e.detail); });

  global.StudioloLicense = {
    verify: verify,
    current: current,
    remove: clear,
    setName: setName,
    contact: CONTACT
  };
})(window);
