/*
 * Start-up splash screen. Shown once each time the app is opened (home page only), it preloads
 * the app's components (fonts, PDF tools, image editor, collage maker, converter) with a live
 * progress bar, then fades away. Everything it loads is local; nothing comes from the internet.
 * Loaded in <head> of index.html so it appears before anything else paints.
 */
(function () {
  'use strict';

  try { if (sessionStorage.getItem('splash-shown')) return; } catch (e) { /* storage blocked: show it */ }

  var MIN_MS = 1900;   // long enough to enjoy the effects
  var MAX_MS = 9000;   // never hold the app back longer than this
  var GROUPS = [
    { label: 'Fonts and icons', files: ['fonts/dancing-script.woff2', 'fonts/great-vibes.woff2', 'fonts/allura.woff2', 'fonts/caveat.woff2'] },
    { label: 'PDF tools', files: ['js/vendor/pdf.min.js', 'js/vendor/pdf.worker.min.js', 'js/vendor/pdf-lib.min.js', 'js/pdf/combine.js', 'js/pdf/sign.js', 'css/pdf.css', 'css/sign.css'] },
    { label: 'Image editor', files: ['js/editor/layers.js', 'js/editor/filters.js', 'js/editor/inpaint.js', 'js/editor/toolbar.js', 'js/editor/editor.js', 'css/editor.css'] },
    { label: 'Collage maker', files: ['js/collage.js', 'css/collage.css'] },
    { label: 'File converter', files: ['js/detect.js', 'js/decode.js', 'js/eps.js', 'js/encoders.js', 'js/app.js', 'js/vendor/UTIF.js', 'js/vendor/pako_inflate.min.js'] }
  ];

  var root = document.documentElement;
  var icon = document.querySelector('link[rel="icon"]');
  var logoUrl = icon && /^(?!data:image\/svg)/.test(icon.getAttribute('href') || '') ? icon.getAttribute('href') : '';
  var name = (document.title || 'Loading').replace(/\s*[·|–-].*$/, '');

  var css = document.createElement('style');
  css.textContent =
    '#splash{position:fixed;inset:0;z-index:2000;display:grid;place-items:center;overflow:hidden;background:var(--bg,#0b0d14);color:var(--text,#e8eaf2);' +
    'font:14px/1.5 Inter,"Segoe UI",system-ui,sans-serif;transition:opacity .7s ease,transform .7s ease,filter .7s ease}' +
    '#splash.out{opacity:0;transform:scale(1.06);filter:blur(6px);pointer-events:none}' +
    '#splash i{position:absolute;width:60vmax;height:60vmax;border-radius:50%;filter:blur(90px);opacity:.34;animation:sp-drift 12s ease-in-out infinite alternate}' +
    '#splash i:nth-child(1){background:var(--logo-a,#7c6cff);top:-25vmax;left:-15vmax}' +
    '#splash i:nth-child(2){background:var(--logo-b,#3b82f6);bottom:-30vmax;right:-20vmax;animation-delay:-5s;opacity:.26}' +
    '#splash .sp-grid{position:absolute;left:-20%;right:-20%;bottom:-25%;height:60%;opacity:.4;transform:perspective(500px) rotateX(62deg);transform-origin:center top;' +
    'background-image:linear-gradient(color-mix(in srgb,var(--accent,#7c6cff) 35%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--accent,#7c6cff) 35%,transparent) 1px,transparent 1px);' +
    'background-size:56px 56px;-webkit-mask-image:linear-gradient(to bottom,transparent,#000 30%,#000 55%,transparent);mask-image:linear-gradient(to bottom,transparent,#000 30%,#000 55%,transparent);animation:sp-floor 9s linear infinite}' +
    '#splash .sp-box{position:relative;z-index:1;width:min(440px,86vw);text-align:center;animation:sp-rise .9s cubic-bezier(.2,.8,.2,1) both}' +
    '#splash .sp-mark{position:relative;width:112px;height:112px;margin:0 auto 26px;display:grid;place-items:center}' +
    '#splash .sp-ring{position:absolute;inset:0;border-radius:50%;background:conic-gradient(from 0deg,var(--logo-a,#7c6cff),var(--logo-b,#3b82f6),transparent 70%,var(--logo-a,#7c6cff));' +
    '-webkit-mask:radial-gradient(circle,transparent 52px,#000 53px);mask:radial-gradient(circle,transparent 52px,#000 53px);animation:sp-spin 2.2s linear infinite;filter:drop-shadow(0 0 14px color-mix(in srgb,var(--accent,#7c6cff) 60%,transparent))}' +
    '#splash .sp-pulse{position:absolute;inset:14px;border-radius:50%;background:color-mix(in srgb,var(--accent,#7c6cff) 22%,transparent);animation:sp-pulse 1.8s ease-out infinite}' +
    '#splash img{position:relative;width:64px;height:64px;border-radius:16px;animation:sp-float 3s ease-in-out infinite;filter:drop-shadow(0 10px 22px rgba(0,0,0,.35))}' +
    '#splash .sp-dot{position:relative;width:46px;height:46px;border-radius:14px;background:var(--grad,linear-gradient(135deg,#7c6cff,#3b82f6));animation:sp-float 3s ease-in-out infinite}' +
    '#splash h1{margin:0 0 4px;font-size:clamp(30px,6vw,40px);font-weight:800;letter-spacing:-.035em;text-transform:none;' +
    'background:linear-gradient(110deg,var(--text,#e8eaf2) 25%,var(--logo-a,#7c6cff) 45%,var(--logo-b,#3b82f6) 55%,var(--text,#e8eaf2) 75%);background-size:250% 100%;' +
    '-webkit-background-clip:text;background-clip:text;color:transparent;animation:sp-shimmer 3.2s ease-in-out infinite}' +
    '#splash .sp-sub{margin:0 0 30px;color:var(--muted,#8b90a3);letter-spacing:.12em;text-transform:uppercase;font-size:11.5px;font-weight:600}' +
    '#splash .sp-bar{height:6px;border-radius:99px;background:color-mix(in srgb,var(--text,#e8eaf2) 10%,transparent);overflow:hidden}' +
    '#splash .sp-fill{height:100%;width:0;border-radius:99px;background:var(--grad,linear-gradient(90deg,#7c6cff,#3b82f6));box-shadow:0 0 16px color-mix(in srgb,var(--accent,#7c6cff) 70%,transparent);transition:width .35s ease;position:relative;overflow:hidden}' +
    '#splash .sp-fill::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.5),transparent);transform:translateX(-100%);animation:sp-sweep 1.2s linear infinite}' +
    '#splash .sp-row{display:flex;justify-content:space-between;margin-top:12px;color:var(--muted,#8b90a3);font-size:12.5px}' +
    '#splash .sp-pct{font-variant-numeric:tabular-nums;color:var(--text,#e8eaf2);font-weight:600}' +
    '#splash .sp-chips{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:20px}' +
    '#splash .sp-chip{padding:3px 10px;border:1px solid var(--border-strong,#2b3042);border-radius:99px;font-size:11.5px;color:var(--muted,#8b90a3);opacity:.45;transition:all .35s}' +
    '#splash .sp-chip.on{opacity:1;color:var(--text,#e8eaf2);border-color:var(--accent,#7c6cff);background:color-mix(in srgb,var(--accent,#7c6cff) 16%,transparent);transform:translateY(-1px)}' +
    '@keyframes sp-drift{to{transform:translate(6vmax,5vmax) scale(1.15)}}' +
    '@keyframes sp-floor{to{background-position:0 56px,0 0}}' +
    '@keyframes sp-rise{from{opacity:0;transform:translateY(24px) scale(.96)}}' +
    '@keyframes sp-spin{to{transform:rotate(360deg)}}' +
    '@keyframes sp-pulse{0%{transform:scale(.7);opacity:.9}100%{transform:scale(1.5);opacity:0}}' +
    '@keyframes sp-float{50%{transform:translateY(-5px)}}' +
    '@keyframes sp-shimmer{0%,100%{background-position:100% 0}50%{background-position:0 0}}' +
    '@keyframes sp-sweep{to{transform:translateX(100%)}}' +
    '@media (prefers-reduced-motion:reduce){#splash *,#splash{animation:none!important;transition:opacity .3s!important}}';
  document.head.appendChild(css);

  function make(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  var splash = make('div');
  splash.id = 'splash';
  splash.setAttribute('role', 'status');
  splash.setAttribute('aria-label', 'Loading ' + name);
  splash.appendChild(make('i'));
  splash.appendChild(make('i'));
  splash.appendChild(make('div', 'sp-grid'));

  var box = make('div', 'sp-box');
  var mark = make('div', 'sp-mark');
  mark.appendChild(make('div', 'sp-pulse'));
  mark.appendChild(make('div', 'sp-ring'));
  if (logoUrl) {
    var img = make('img');
    img.alt = '';
    img.src = logoUrl;
    mark.appendChild(img);
  } else {
    mark.appendChild(make('div', 'sp-dot'));
  }
  box.appendChild(mark);
  box.appendChild(make('h1', '', name));
  box.appendChild(make('p', 'sp-sub', 'Getting things ready'));

  var bar = make('div', 'sp-bar');
  var fill = make('div', 'sp-fill');
  bar.appendChild(fill);
  box.appendChild(bar);
  var row = make('div', 'sp-row');
  var status = make('span', '', 'Starting…');
  var pct = make('span', 'sp-pct', '0%');
  row.appendChild(status);
  row.appendChild(pct);
  box.appendChild(row);
  var chips = make('div', 'sp-chips');
  var chipEls = GROUPS.map(function (g) { var c = make('span', 'sp-chip', g.label); chips.appendChild(c); return c; });
  box.appendChild(chips);
  splash.appendChild(box);

  root.appendChild(splash);
  root.style.overflow = 'hidden';

  /* ---- preload the components ---- */
  var jobs = [];
  GROUPS.forEach(function (g, gi) { g.files.forEach(function (f) { jobs.push({ url: f, group: gi }); }); });
  var total = jobs.length, done = 0, shown = 0, started = Date.now(), finished = false, next = 0;
  var left = GROUPS.map(function (g) { return g.files.length; });

  function render() {
    var target = Math.round((done / total) * 100);
    if (shown < target) shown += Math.max(1, Math.ceil((target - shown) / 6));
    if (shown > target) shown = target;
    fill.style.width = shown + '%';
    pct.textContent = shown + '%';
    var active = -1;
    for (var i = 0; i < left.length; i++) { if (left[i] > 0) { active = i; break; } }
    chipEls.forEach(function (c, i) { c.classList.toggle('on', left[i] === 0 || i === active); });
    status.textContent = active >= 0 ? 'Loading ' + GROUPS[active].label.toLowerCase() + '…' : 'All set';
  }

  function finish() {
    if (finished) return;
    finished = true;
    done = total; shown = 100; left = left.map(function () { return 0; });
    render();
    try { sessionStorage.setItem('splash-shown', '1'); } catch (e) { /* storage blocked */ }
    setTimeout(function () {
      splash.classList.add('out');
      root.style.overflow = '';
      setTimeout(function () { splash.remove(); css.remove(); }, 800);
    }, 350);
  }

  function ticker() {
    if (finished) return;
    render();
    var waited = Date.now() - started;
    if ((done >= total && shown >= 100 && waited >= MIN_MS) || waited >= MAX_MS) return finish();
    setTimeout(ticker, 60);
  }

  function load(job, cb) {
    var ok = function () { left[job.group]--; done++; cb(); };
    // Opened straight from disk the browser can't fetch files, and there's nothing to warm up anyway.
    if (location.protocol === 'file:') return void setTimeout(ok, 45);
    try {
      fetch(job.url, { cache: 'force-cache' }).then(function (r) { return r.arrayBuffer(); }).then(ok, ok);
    } catch (e) { ok(); }
  }

  function pump() {
    if (next >= jobs.length) return;
    load(jobs[next++], pump);
  }
  for (var w = 0; w < 4; w++) pump();
  ticker();
})();
