/*
 * Ring Breaker: drawing, input, sound, saving and menus. The rules live in core.js.
 */
(function () {
  'use strict';

  var Core = window.RBCore;
  var $ = function (id) { return document.getElementById(id); };
  var SAVE_KEY = 'ringbreaker-save-v1';
  var OFFLINE_CAP = 4 * 3600; // the ball keeps earning for up to 4 hours while you're away
  var TAU = Math.PI * 2;
  var MONO = '"SF Mono", "Cascadia Mono", "Roboto Mono", Consolas, ui-monospace, monospace';

  /* ============================================================
   * Save data
   * ============================================================ */

  function defaults() {
    return {
      v: 2, cash: 25, gems: 60, keys: 2, xp: 0, level: 1, stage: 1, ring: 0, hp: Core.ringHp(1, 0),
      up: { damage: 0, income: 0, speed: 0, balls: 0 }, cards: {}, order: [],
      theme: 'cyber', skin: 'white', themes: ['cyber', 'gold'], skins: ['white'],
      sound: true, vibrate: true, lastSeen: Date.now(), cps: 0, broken: 0, bestStage: 1,
      pending: 0, tipSeen: false, seconds: 0, gfx: 'auto', showFps: false, deaths: 0, crushTip: false, dev: false
    };
  }

  function load() {
    var s = defaults(), saved = null;
    try { saved = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { saved = null; }
    if (saved && typeof saved === 'object') {
      for (var k in s) if (saved[k] !== undefined && typeof saved[k] === typeof s[k]) s[k] = saved[k];
      s.up = Object.assign({ damage: 0, income: 0, speed: 0, balls: 0 }, saved.up || {});
      s.cards = saved.cards && typeof saved.cards === 'object' ? saved.cards : {};
      s.order = Array.isArray(saved.order) ? saved.order.filter(function (id) { return Core.card(id); }) : [];
      s.themes = Array.isArray(saved.themes) ? saved.themes : ['cyber', 'gold'];
      if (!saved.v || saved.v < 2) { // the new look: everyone gets the Cyber colours (Gold stays available)
        if (s.themes.indexOf('cyber') < 0) s.themes.unshift('cyber');
        if (s.theme === 'gold') s.theme = 'cyber';
        s.v = 2;
      }
      s.skins = Array.isArray(saved.skins) ? saved.skins : ['white'];
    }
    ['cash', 'gems', 'keys', 'xp', 'level', 'stage', 'ring', 'hp'].forEach(function (k) { if (!isFinite(s[k]) || s[k] < 0) s[k] = defaults()[k]; });
    s.stage = Math.max(1, Math.floor(s.stage));
    s.level = Math.max(1, Math.floor(s.level));
    s.ring = Math.min(Math.max(0, Math.floor(s.ring)), Core.ringsInStage(s.stage) - 1);
    if (s.hp <= 0 || s.hp > Core.ringHp(s.stage, s.ring)) s.hp = Core.ringHp(s.stage, s.ring);
    return s;
  }

  var state = load();
  var saveTimer = 0;
  function save() {
    state.lastSeen = Date.now();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* storage blocked: play without saving */ }
  }

  /* ============================================================
   * Looks
   * ============================================================ */

  var THEMES = {
    cyber: { name: 'Cyber', a: '#22e4ff', b: '#b46bff', cost: 0 },
    gold: { name: 'Gold', a: '#ffd43b', b: '#f08c00', cost: 0 },
    neon: { name: 'Toxic', a: '#b6ff3b', b: '#00e5ff', cost: 120 },
    synth: { name: 'Synthwave', a: '#ff3fd1', b: '#7a5cff', cost: 180 },
    ice: { name: 'Ice', a: '#e0fbff', b: '#3b82f6', cost: 160 },
    violet: { name: 'Violet', a: '#f3d9fa', b: '#9c36b5', cost: 200 },
    lava: { name: 'Lava', a: '#ffa94d', b: '#e03131', cost: 240 }
  };
  var SKINS = {
    white: { name: 'White', color: '#ffffff', cost: 0 },
    cyan: { name: 'Cyan', color: '#66e0ff', cost: 60 },
    pink: { name: 'Pink', color: '#ff8ad8', cost: 60 },
    lime: { name: 'Lime', color: '#b2f542', cost: 80 },
    ember: { name: 'Ember', color: '#ff922b', cost: 100 }
  };

  function rgb(hex) { var n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function mix(a, b, t) {
    var x = rgb(a), y = rgb(b);
    return 'rgb(' + Math.round(x[0] + (y[0] - x[0]) * t) + ',' + Math.round(x[1] + (y[1] - x[1]) * t) + ',' + Math.round(x[2] + (y[2] - x[2]) * t) + ')';
  }

  var RARITY_NAME = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };

  // Small flat icons for the cards, slots and chests (24 × 24 grid).
  var ICON = {
    power: '<path d="M6.500 17.500L17 7l1.500-1.500.500 4L9.500 19z" fill="#ff4d4d"/><path d="M5 19l3-3M10 13l2.500 2.500M16.500 5.500l2 2" stroke="#ffd6d6" stroke-width="1.600" stroke-linecap="round" fill="none"/>',
    fortune: '<circle cx="12" cy="12" r="8.500" fill="#ffd43b" stroke="#f08c00" stroke-width="1.600"/><path d="M12 7v10M14.500 9.500h-3.300a1.800 1.800 0 000 3.600h1.600a1.800 1.800 0 010 3.600H9.500" stroke="#8a5a00" stroke-width="1.700" stroke-linecap="round" fill="none"/>',
    swift: '<path d="M4 6l6 6-6 6M12 6l6 6-6 6" stroke="#4dd4ff" stroke-width="2.600" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    prospector: '<path d="M12 3.500l7.500 8.500L12 20.500 4.500 12z" fill="#38d9a9"/><path d="M4.500 12h15M9 3.500L12 12l3-8.500" stroke="#c3fae8" stroke-width="1.300" fill="none" stroke-linejoin="round"/>',
    crit: '<path d="M12 2.500l2.200 6.300 6.300-2.300-2.300 6.300 6 2.700-6.300 2.200 1.800 6.300-6-3.600L6 22l.8-6.500-6-2.700 6.200-1.800-.2-6.400 5.200 3.900z" transform="scale(.86) translate(2 1.500)" fill="#ff922b" stroke="#ffe066" stroke-width="1" stroke-linejoin="round"/>',
    burn: '<path d="M12 2.500c1 3-1.500 4.500-3 7-1.500 2.400-.8 5.200 1 6.600C9 13.500 10.500 12.500 12 11c.3 2 2.200 3 2.200 5.200a3.700 3.700 0 01-1.300 2.800c3.200-.4 5.600-2.800 5.100-6.200-.6-4-4.500-5.500-6-10.300z" fill="#ff7a1a"/><path d="M12 21a4 4 0 01-3.300-5.800c.8 1.200 1.800 1.800 2.800 1.800.2-1.200 0-2.300-.5-3.200 2.200 1 4 2.500 4 4.700A3.600 3.600 0 0112 21z" fill="#ffe066"/>',
    bomb: '<circle cx="12" cy="13.500" r="7" fill="#ffc9a3" stroke="#ff7a1a" stroke-width="2"/><path d="M12 6.500V4M14 3.500l1.500-1.500M9.500 3l-1.500-1" stroke="#ffd43b" stroke-width="1.800" stroke-linecap="round" fill="none"/>',
    lightning: '<path d="M13.500 2L5 13.500h5.500L9.500 22 19 10h-5.500z" fill="#ffe066" stroke="#fff3bf" stroke-width="1" stroke-linejoin="round"/>',
    twin: '<circle cx="9" cy="12" r="5.500" fill="#e5e7eb"/><circle cx="15.500" cy="12" r="5.500" fill="#74c0fc" opacity=".92"/>',
    finisher: '<path d="M12 3c-4.500 0-7 3-7 6.500 0 2.200 1 3.800 2.500 4.800V18h9v-3.700c1.500-1 2.500-2.600 2.500-4.800C19 6 16.500 3 12 3z" fill="#f1f3f5"/><circle cx="9.200" cy="10.500" r="1.800" fill="#212529"/><circle cx="14.800" cy="10.500" r="1.800" fill="#212529"/><path d="M10 21v-3M12 21v-3M14 21v-3" stroke="#f1f3f5" stroke-width="1.600" stroke-linecap="round"/>',
    chest: '<rect x="3" y="9" width="18" height="11" rx="2" fill="#c27a2c" stroke="#ffd43b" stroke-width="1.400"/><path d="M3 12h18" stroke="#ffd43b" stroke-width="1.400"/><path d="M4 9a8 5 0 0116 0z" fill="#e0a040" stroke="#ffd43b" stroke-width="1.400"/><rect x="10.500" y="11" width="3" height="4" rx=".8" fill="#ffd43b"/>',
    coin: '<path d="M9 3h6l-1.400 3h-3.200zM8.500 6.500C5.500 9 4 12 4 15a5 5 0 005 5h6a5 5 0 005-5c0-3-1.500-6-4.500-8.500M12 10v7M14 11.500h-3a1.300 1.300 0 000 2.600h2a1.300 1.300 0 010 2.600h-3" stroke="currentColor" fill="none"/>',
    gem: '<path d="M12 3l8 9-8 9-8-9zM4 12h16M9 3.500L12 12l3-8.500" stroke="currentColor" fill="none"/>'
  };
  function icon(id, size) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"' + (size ? ' width="' + size + '" height="' + size + '"' : '') + ' style="filter:drop-shadow(0 0 6px rgba(255,255,255,.18))">' + ICON[id] + '</svg>';
  }
  function plainIcon(id) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[id] + '</svg>'; }

  /* ============================================================
   * Sound (made with the browser's own synthesiser; nothing is downloaded)
   * ============================================================ */

  var AC = null, master = null, lastHitSound = 0;
  function audio() {
    if (AC === null) {
      try {
        AC = new (window.AudioContext || window.webkitAudioContext)();
        master = AC.createGain();
        master.gain.value = 0.32;
        master.connect(AC.destination);
      } catch (e) { AC = false; }
    }
    return AC;
  }
  function tone(freq, dur, type, vol, slide, delay) {
    if (!state.sound) return;
    var ac = audio();
    if (!ac) return;
    if (ac.state === 'suspended') ac.resume();
    var t0 = ac.currentTime + (delay || 0), o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t0 + dur);
    g.gain.setValueAtTime(vol || 0.2, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }
  function noise(dur, vol) {
    if (!state.sound) return;
    var ac = audio();
    if (!ac) return;
    var n = Math.floor(ac.sampleRate * dur), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var src = ac.createBufferSource(), g = ac.createGain();
    src.buffer = buf;
    g.gain.value = vol || 0.2;
    src.connect(g);
    g.connect(master);
    src.start();
  }
  var sfx = {
    hit: function (combo) {
      var now = performance.now();
      if (now - lastHitSound < 70) return;
      lastHitSound = now;
      tone(330 * Math.pow(1.0595, Math.min(combo, 14)), 0.07, 'triangle', 0.1);
    },
    crit: function () { tone(880, 0.12, 'square', 0.07, 1.6); },
    ring: function () { noise(0.28, 0.2); tone(180, 0.35, 'sawtooth', 0.12, 0.4); tone(523, 0.25, 'sine', 0.12, 1, 0.05); tone(784, 0.3, 'sine', 0.12, 1, 0.12); },
    boom: function () { noise(0.4, 0.28); tone(110, 0.4, 'sawtooth', 0.16, 0.3); },
    zap: function () { tone(1400, 0.16, 'sawtooth', 0.07, 0.25); },
    coin: function () { tone(1318, 0.08, 'square', 0.05); tone(1760, 0.14, 'square', 0.05, 1, 0.07); },
    buy: function () { tone(660, 0.07, 'square', 0.07); tone(990, 0.1, 'square', 0.07, 1, 0.06); },
    nope: function () { tone(160, 0.14, 'square', 0.08, 0.7); },
    level: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.22, 'triangle', 0.12, 1, i * 0.09); }); },
    pick: function () { tone(784, 0.1, 'triangle', 0.12); tone(1175, 0.2, 'triangle', 0.12, 1, 0.08); },
    warn: function (c) { tone(880 + c * 300, 0.07, 'square', 0.05); },
    crush: function () { noise(0.6, 0.32); tone(220, 0.6, 'sawtooth', 0.18, 0.15); tone(110, 0.8, 'square', 0.1, 0.3, 0.1); }
  };
  function buzz(ms) {
    if (!state.vibrate) return;
    try {
      if (window.RBNative && window.RBNative.vibrate) window.RBNative.vibrate(ms); // the Android app
      else if (navigator.vibrate) navigator.vibrate(ms);
    } catch (e) { /* not supported */ }
  }

  /* ============================================================
   * Game world
   * ============================================================ */

  var G = {
    balls: [], parts: [], texts: [], shocks: [], bombs: [], bolts: [], ghosts: [], stars: [],
    burn: null, burnAcc: 0, burnTextT: 0, hitCount: 0, shake: 0, flash: 0, time: 0,
    started: false, modals: 0, dmgLog: [], cashLog: [], tapCd: 0, intro: 1, streak: 0, lastHit: -9,
    mods: Core.mods(state.cards), segCache: {},
    ringT: 0, warnT: 0, // time spent on the current ring; when the next warning beep is due
    dev: { god: false, freeze: false, speed: 1 } // developer options (this session only)
  };
  var canvas = $('stage'), ctx = canvas.getContext('2d');
  var W = 0, H = 0, dpr = 1, CX = 0, CY = 0, SCALE = 1;

  function refreshMods() { G.mods = Core.mods(state.cards); }
  function ringMax() { return Core.ringHp(state.stage, state.ring); }
  function ringLimit() { return Core.ringTime(state.stage, state.ring, G.mods.timeMul); }
  function closing() { return Math.min(1, G.ringT / ringLimit()); } // 0 = just started, 1 = touching the ball
  function curRingR() { return Core.closingRadius(state.ring, closing()); }
  function arenaR() { return curRingR() - Core.THICK / 2; } // free space inside the ring right now
  function ringCount() { return Core.ringsInStage(state.stage); }
  function ballTotal() { return Math.min(8, 1 + state.up.balls + G.mods.twin); }
  function speed() { return Core.BASE_SPEED * Core.speedMult(state.up.speed) * G.mods.speedMul; }
  function hitDamage() { return Core.damage(state.up.damage) * G.mods.dmgMul; }

  function resetBalls() {
    G.balls = [];
    var R = arenaR() - Core.BALL_R;
    for (var i = 0; i < ballTotal(); i++) addBall(R * 0.5 * Math.random(), Math.random() * TAU);
  }
  function addBall(dist, ang) {
    var a = Math.random() * TAU, sp = speed();
    G.balls.push({ x: Math.cos(ang) * dist, y: Math.sin(ang) * dist, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, trail: [] });
  }
  function syncBallCount() {
    var want = ballTotal(), R = Math.max(4, arenaR() - Core.BALL_R);
    while (G.balls.length < want) addBall(R * 0.4 * Math.random(), Math.random() * TAU);
    while (G.balls.length > want) G.balls.pop();
  }

  /* ---- scoring and damage ---- */

  function gainCash(v) {
    state.cash += v;
    G.cashLog.push({ t: G.time, v: v });
  }

  function text(x, y, str, color, size) {
    if (G.texts.length > 28) G.texts.shift();
    G.texts.push({ x: x, y: y, s: str, c: color, z: size || 15, t: 0 });
  }

  function spark(x, y, color, n, speedMul) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * TAU, v = (60 + Math.random() * 180) * (speedMul || 1);
      G.parts.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.35 + Math.random() * 0.4, t: 0, c: color, r: 1.2 + Math.random() * 2.2 });
    }
    if (G.parts.length > 260) G.parts.splice(0, G.parts.length - 260);
  }

  function ringColor(i) {
    var th = THEMES[state.theme] || THEMES.cyber;
    if (Core.isBossRing(state.stage, i)) return '#ff3b5c';
    if (Core.isJackpot(state.stage, i)) return '#ffd43b';
    return mix(th.a, th.b, Math.min(1, Math.max(0, (i - state.ring) / 10)));
  }

  function dealDamage(amount, x, y, kind) {
    if (state.hp <= 0) return;
    var max = ringMax();
    amount = Math.min(amount, state.hp);
    state.hp -= amount;
    var reward = Core.ringReward(state.stage, state.ring, state.up.income) * G.mods.cashMul;
    gainCash(reward * 0.5 * (amount / max));
    G.dmgLog.push({ t: G.time, v: amount });
    if (kind !== 'burn') {
      var colors = { hit: '#e8f6ff', crit: '#ff3fd1', bomb: '#ff922b', bolt: '#74d7ff', tap: '#b6ff3b' };
      var big = kind === 'crit' || kind === 'bomb' || kind === 'bolt';
      text(x, y, Core.fmt(amount), colors[kind] || '#fff', big ? 21 : 14);
    }
    if (state.hp <= 1e-9) breakRing(x, y);
  }

  function breakRing(x, y) {
    var th = THEMES[state.theme] || THEMES.cyber;
    var color = ringColor(state.ring);
    var reward = Core.ringReward(state.stage, state.ring, state.up.income) * G.mods.cashMul;
    var jackpot = Core.isJackpot(state.stage, state.ring);
    gainCash(reward * 0.5);
    // pop-ups float above the HP gauge in the middle, never on top of it
    var popY = -Math.max(70, Core.arenaRadius(state.ring) * 0.55);
    text(0, popY, '+$' + Core.fmt(reward), jackpot ? '#ffd43b' : '#b6ff3b', jackpot ? 26 : 20);
    if (jackpot) { text(0, popY - 30, 'JACKPOT ×5', '#ffd43b', 22); sfx.coin(); setTimeout(sfx.coin, 140); }
    G.ghosts.push({ r: Core.ringRadius(state.ring), t: 0 });
    state.xp += Core.xpGain(state.stage, state.ring);
    var boss = Core.isBossRing(state.stage, state.ring);
    var gems = G.mods.gemBonus + (Math.random() < 0.1 ? 1 : 0) + (boss ? 6 : 0);
    if (gems) { state.gems += gems; text(0, -Math.max(70, Core.arenaRadius(state.ring) * 0.55) - 56, '+' + gems + ' gem' + (gems > 1 ? 's' : ''), '#c49bff', 16); }
    if (boss) { state.keys += 1; text(0, -Math.max(70, Core.arenaRadius(state.ring) * 0.55) - 78, '+1 key', '#ffd43b', 16); }
    state.broken++;

    G.shocks.push({ r: Core.ringRadius(state.ring), t: 0, c: color });
    for (var i = 0; i < 46; i++) {
      var a = (i / 46) * TAU + Math.random() * 0.2, rr = Core.ringRadius(state.ring);
      var v = 90 + Math.random() * 230;
      G.parts.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.6 + Math.random() * 0.6, t: 0, c: i % 3 ? color : '#ffffff', r: 1.6 + Math.random() * 3, shard: i % 2 === 0 });
    }
    G.shake = boss ? 14 : 7;
    G.flash = 1;
    sfx.ring();
    buzz(boss ? 60 : 18);

    G.bombs.length = 0;
    G.burn = null;
    G.ringT = 0;
    G.warnT = 0;
    state.ring++;
    if (state.ring >= ringCount()) {
      state.hp = 0;
      stageClear();
    } else {
      state.hp = ringMax();
    }
    checkLevelUp();
  }

  function checkLevelUp() {
    var up = false;
    while (state.xp >= Core.xpNeed(state.level)) {
      state.xp -= Core.xpNeed(state.level);
      state.level++;
      state.pending++;
      up = true;
    }
    if (up) sfx.level();
    if (state.pending > 0 && G.modals === 0 && G.started) showOffers();
  }

  function stageClear() {
    state.keys += 1;
    sfx.level();
    var done = state.stage;
    G.balls = [];
    showChests(done, function () {
      state.stage = done + 1;
      pathCache = {}; // shapes of the old stage's rings are no longer needed
      tickCache = {};
      G.segCache = {};
      state.bestStage = Math.max(state.bestStage, state.stage);
      state.ring = 0;
      state.hp = ringMax();
      G.ringT = 0;
      G.intro = 0;
      resetBalls();
      save();
      if (state.pending > 0) showOffers();
    });
  }

  /* ---- the ring reached the ball ---- */

  function crush() {
    var reached = state.ring + 1, total = ringCount();
    G.balls.forEach(function (b) {
      spark(b.x, b.y, '#ffffff', 26, 1.4);
      spark(b.x, b.y, '#ff2a4a', 30, 1.1);
    });
    G.shocks.push({ r: 10, t: 0, c: '#ff2a4a' });
    G.balls = [];
    G.shake = 18;
    G.flash = 1;
    G.bombs.length = 0;
    G.burn = null;
    sfx.crush();
    buzz(120);
    state.deaths++;
    save();
    setTimeout(function () {
      openModal(function (m, h) {
        var tip = state.crushTip ? 'Upgrade Damage, Ball Speed or Extra Ball, then try again. Chrono cards give you more time.'
          : 'The ring closed in before it broke. Break each ring before it reaches your core: upgrade Damage, Ball Speed or Extra Ball, then try again. Your cash is kept.';
        state.crushTip = true;
        m.innerHTML = '<h2 style="color:#ff5470;text-shadow:0 0 16px #ff2a4a,2px 0 0 rgba(255,63,209,.6),-2px 0 0 rgba(34,228,255,.5)">Core destroyed</h2>' +
          '<p class="sub">Stage ' + state.stage + ' · reached ring ' + reached + ' of ' + total + '</p>' +
          '<div class="panel frame" style="text-align:center"><p class="hint" style="margin:0;font-size:13px;line-height:1.5">' + tip + '</p></div>' +
          '<div class="row"><div class="col"><button class="btn gold" id="retry">↻ Retry stage</button></div></div>';
        m.querySelector('#retry').onclick = function () {
          h.close();
          state.ring = 0;
          state.hp = ringMax();
          G.ringT = 0;
          G.warnT = 0;
          G.intro = 0;
          resetBalls();
          save();
          if (state.pending > 0) showOffers();
        };
      });
    }, 900);
  }

  /* ---- one wall hit ---- */

  function wallHit(b, nx, ny) {
    G.hitCount++;
    G.streak = G.time - G.lastHit < 1.2 ? G.streak + 1 : 0;
    G.lastHit = G.time;
    var m = G.mods, R = arenaR();
    var px = -nx * R, py = -ny * R;
    var dmg = hitDamage(), kind = 'hit';
    if (m.finisher && state.hp < 0.3 * ringMax()) dmg *= 1 + m.finisher;
    if (m.critChance && Math.random() < m.critChance) { dmg *= 3; kind = 'crit'; sfx.crit(); }
    G.pulse = 1;
    spark(px, py, ringColor(state.ring), kind === 'crit' ? 10 : 4, 0.8);
    sfx.hit(G.streak);

    if (m.burnFrac) { G.burn = { dps: hitDamage() * m.burnFrac, t: 3 }; }
    if (m.bombChance && Math.random() < m.bombChance) G.bombs.push({ x: px * 0.92, y: py * 0.92, t: 0, dmg: hitDamage() * m.bombMul });
    if (m.lightMul && G.hitCount % 5 === 0) {
      var a = Math.random() * TAU, bx = Math.cos(a) * R, by = Math.sin(a) * R;
      G.bolts.push({ x: bx, y: by, t: 0, seed: Math.random() * 1000 });
      sfx.zap();
      dealDamage(hitDamage() * m.lightMul, bx, by, 'bolt');
      spark(bx, by, '#74d7ff', 10, 1);
    }
    dealDamage(dmg, px, py, kind);
  }

  /* ---- time step ---- */

  function step(h) {
    var sp = speed(), R = Math.max(0.5, arenaR() - Core.BALL_R);
    for (var i = 0; i < G.balls.length; i++) {
      var b = G.balls[i];
      var cur = Math.hypot(b.vx, b.vy) || 1;
      b.vx *= sp / cur;
      b.vy *= sp / cur;
      b.x += b.vx * h;
      b.y += b.vy * h;
      var d = Math.hypot(b.x, b.y);
      if (d >= R && d > 0) {
        var nx = -b.x / d, ny = -b.y / d, dot = b.vx * nx + b.vy * ny;
        if (dot < 0) {
          b.vx -= 2 * dot * nx;
          b.vy -= 2 * dot * ny;
          var a = (Math.random() - 0.5) * 0.24, c = Math.cos(a), s = Math.sin(a), vx = b.vx;
          b.vx = vx * c - b.vy * s;
          b.vy = vx * s + b.vy * c;
        }
        b.x = (b.x / d) * Math.max(0, R - 0.5);
        b.y = (b.y / d) * Math.max(0, R - 0.5);
        if (G.time - (b.lastHit || -1) >= Core.HIT_COOLDOWN) { b.lastHit = G.time; wallHit(b, nx, ny); }
        if (state.hp <= 0 && !G.balls.length) return;
      }
    }
  }

  function update(dt) {
    G.time += dt;
    G.tapCd = Math.max(0, G.tapCd - dt);
    if (G.intro < 1) G.intro = Math.min(1, G.intro + dt / 0.9);
    G.shake *= Math.pow(0.002, dt);
    G.flash = Math.max(0, G.flash - dt * 3);
    G.pulse = Math.max(0, G.pulse - dt * 6);
    state.seconds += dt;

    if (G.started && G.modals === 0) {
      if (state.hp > 0 && G.balls.length) {
        if (!G.dev.freeze) G.ringT += dt;
        if (G.dev.god) G.ringT = Math.min(G.ringT, ringLimit() * 0.97);
        var c = closing();
        if (c > 0.7) { // the wall is close: beep faster and faster
          G.warnT -= dt;
          if (G.warnT <= 0) { sfx.warn(c); G.warnT = 0.5 - (c - 0.7) * 1.2; }
        }
        if (c >= 1) { crush(); return; }
      }
      var n = Math.max(1, Math.ceil(dt / (1 / 120)));
      for (var i = 0; i < n && state.hp > 0; i++) step(dt / n);

      if (G.burn && state.hp > 0) {
        G.burn.t -= dt;
        G.burnAcc += G.burn.dps * dt;
        G.burnTextT += dt;
        if (G.burnTextT >= 0.5 && G.burnAcc > 0) {
          var a = Math.random() * TAU, R = arenaR();
          var amt = G.burnAcc;
          G.burnAcc = 0;
          G.burnTextT = 0;
          text(Math.cos(a) * R, Math.sin(a) * R, Core.fmt(amt), '#ff9f43', 13);
          dealDamage(amt, 0, 0, 'burn');
        }
        if (G.burn && G.burn.t <= 0) G.burn = null;
      }

      for (var k = G.bombs.length - 1; k >= 0; k--) {
        var bm = G.bombs[k];
        bm.t += dt;
        if (bm.t >= 1.1) {
          G.bombs.splice(k, 1);
          G.shocks.push({ r: 30, t: 0, c: '#ff922b', small: true });
          spark(bm.x, bm.y, '#ff922b', 22, 1.2);
          G.shake = Math.max(G.shake, 5);
          sfx.boom();
          dealDamage(bm.dmg, bm.x, bm.y, 'bomb');
        }
      }
    }

    // cosmetic things keep moving even while a menu is open
    for (var p = G.parts.length - 1; p >= 0; p--) {
      var q = G.parts[p];
      q.t += dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vx *= 0.97;
      q.vy *= 0.97;
      if (q.t >= q.life) G.parts.splice(p, 1);
    }
    for (var s2 = G.shocks.length - 1; s2 >= 0; s2--) { G.shocks[s2].t += dt; if (G.shocks[s2].t > 0.7) G.shocks.splice(s2, 1); }
    for (var g3 = G.ghosts.length - 1; g3 >= 0; g3--) { G.ghosts[g3].t += dt; if (G.ghosts[g3].t > 0.3) G.ghosts.splice(g3, 1); }
    updateStars(dt);
    for (var s3 = G.bolts.length - 1; s3 >= 0; s3--) { G.bolts[s3].t += dt; if (G.bolts[s3].t > 0.22) G.bolts.splice(s3, 1); }
    for (var t2 = G.texts.length - 1; t2 >= 0; t2--) { G.texts[t2].t += dt; G.texts[t2].y -= 38 * dt; if (G.texts[t2].t > 0.9) G.texts.splice(t2, 1); }
    for (var bi = 0; bi < G.balls.length; bi++) {
      var ball = G.balls[bi];
      ball.trail.push(ball.x, ball.y);
      if (ball.trail.length > 16) ball.trail.splice(0, 2);
    }
    while (G.dmgLog.length && G.time - G.dmgLog[0].t > 3) G.dmgLog.shift();
    while (G.cashLog.length && G.time - G.cashLog[0].t > 30) G.cashLog.shift();
  }

  /* ============================================================
   * Drawing
   * ============================================================ */

  // Drawing resolution. Pixels drawn per frame are what slow phones down most, so "auto" starts at
  // 1.5× (the glow art stays sharp) and steps down by itself if the game can't hold ~60 FPS.
  var Q = { dpr: 1.5, low: false };
  function setQuality() {
    var device = window.devicePixelRatio || 1;
    if (state.gfx === 'high') { Q.dpr = Math.min(device, 2); Q.low = false; }
    else if (state.gfx === 'low') { Q.dpr = 1; Q.low = true; }
    else { Q.dpr = Math.min(device, 1.5); Q.low = false; }
    resize();
  }

  function resize() {
    var r = canvas.getBoundingClientRect();
    dpr = Math.max(1, Math.min(Q.dpr, window.devicePixelRatio || 1));
    W = r.width;
    H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    var top = 150, bottom = Math.max(top + 200, H - Math.min(360, H * 0.44));
    CX = W / 2;
    CY = (top + bottom) / 2;
    SCALE = Math.min(W, 520) / 540;
  }

  // The same ring always breaks into the same arcs, so it doesn't flicker as it's redrawn.
  function segments(stage, i) {
    var key = stage * 100 + i;
    if (G.segCache[key]) return G.segCache[key];
    var seed = (key * 2654435761) >>> 0;
    function rnd() { seed = (seed + 0x6d2b79f5) >>> 0; var t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
    var m = 14, list = [], base = rnd() * TAU, slot = TAU / m;
    for (var s = 0; s < m; s++) {
      var fill = 0.62 + rnd() * 0.33;
      list.push({ a0: base + s * slot + (slot * (1 - fill)) / 2, a1: base + s * slot + (slot * (1 + fill)) / 2 });
    }
    list.speed = (0.12 + rnd() * 0.35) * (i % 2 ? -1 : 1);
    G.segCache[key] = list;
    return list;
  }

  /* ---- background: stars streaming out of the centre (the hex grid and glow are static CSS) ---- */

  function newStar(anywhere) {
    return { a: Math.random() * TAU, d: anywhere ? Math.random() : 0.02 + Math.random() * 0.05, v: 0.03 + Math.random() * 0.09, z: Math.random() };
  }
  function updateStars(dt) {
    var want = Q.low ? 50 : 110;
    while (G.stars.length < want) G.stars.push(newStar(true));
    if (G.stars.length > want) G.stars.length = want;
    for (var k = 0; k < G.stars.length; k++) {
      var st = G.stars[k];
      st.d += st.v * dt * (0.35 + st.d * 1.6);
      if (st.d > 1.05) G.stars[k] = newStar(false);
    }
  }

  // Ring shapes are built once and reused every frame (rotation is applied with a transform).
  var pathCache = {};
  function ringPath(stage, i, from, to) {
    var key = stage + ':' + i + ':' + from + ':' + to;
    var p = pathCache[key];
    if (p) return p;
    var segs = segments(stage, i), r = Core.ringRadius(i);
    p = new Path2D();
    for (var s = from; s < to; s++) {
      p.moveTo(Math.cos(segs[s].a0) * r, Math.sin(segs[s].a0) * r);
      p.arc(0, 0, r, segs[s].a0, segs[s].a1);
    }
    pathCache[key] = p;
    return p;
  }
  var tickCache = {};
  function tickPaths(i) {
    if (tickCache[i]) return tickCache[i];
    var r0 = Core.ringRadius(i) + Core.THICK * 1.3, major = new Path2D(), minor = new Path2D();
    for (var t = 0; t < 72; t++) {
      var an = (t / 72) * TAU, big = t % 6 === 0, p = big ? major : minor, r1 = r0 + (big ? 7 : 3.5);
      p.moveTo(Math.cos(an) * r0, Math.sin(an) * r0);
      p.lineTo(Math.cos(an) * r1, Math.sin(an) * r1);
    }
    tickCache[i] = { major: major, minor: minor };
    return tickCache[i];
  }
  // Soft glow sprite for the ball, drawn once per colour instead of a gradient every frame.
  var haloCache = {};
  function halo(color) {
    if (haloCache[color]) return haloCache[color];
    var c = document.createElement('canvas');
    c.width = c.height = 64;
    var x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    haloCache[color] = c;
    return c;
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);
    var th = THEMES[state.theme] || THEMES.cyber;
    var sx = G.shake > 0.3 ? (Math.random() - 0.5) * G.shake : 0, sy = G.shake > 0.3 ? (Math.random() - 0.5) * G.shake : 0;
    var maxR = Math.hypot(W, H) / 2;

    // stars, in three batches (one stroke each) instead of one stroke per star
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    var groups = [[th.a, 0.55, 1.6], [th.b, 0.45, 1.2], ['#ffffff', 0.32, 0.8]];
    for (var gi = 0; gi < 3; gi++) {
      ctx.strokeStyle = groups[gi][0];
      ctx.globalAlpha = groups[gi][1];
      ctx.lineWidth = groups[gi][2];
      ctx.beginPath();
      for (var k = gi; k < G.stars.length; k += 3) {
        var st = G.stars[k], d = st.d * maxR, len = Q.low ? 1.5 : 2 + st.v * st.d * 60;
        var cs = Math.cos(st.a), sn = Math.sin(st.a), x0 = CX + cs * d, y0 = CY + sn * d;
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 - cs * len, y0 - sn * len);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.translate(CX + sx, CY + sy);
    ctx.scale(SCALE, SCALE);
    ctx.lineCap = 'round';

    var n = ringCount(), limit = Math.hypot(W, H) / SCALE;
    var intro = 1 - Math.pow(1 - G.intro, 3), zoom = 0.7 + 0.3 * intro;
    var last = Math.min(n - 1, state.ring + 22);
    if (zoom !== 1) ctx.scale(zoom, zoom);

    // outer rings: one thin stroke each (plus a soft glow on the nearest few)
    ctx.globalCompositeOperation = 'lighter';
    for (var i = last; i > state.ring; i--) {
      if (Core.ringRadius(i) * zoom > limit) continue;
      var segs = segments(state.stage, i), path = ringPath(state.stage, i, 0, segs.length);
      var fade = Math.max(0.22, 1 - (i - state.ring) * 0.045) * intro;
      ctx.save();
      ctx.rotate(G.time * segs.speed);
      ctx.strokeStyle = ringColor(i);
      if (!Q.low && i - state.ring <= 4) {
        ctx.globalAlpha = fade * 0.16;
        ctx.lineWidth = Core.THICK * 1.5;
        ctx.stroke(path);
      }
      ctx.globalAlpha = fade * 0.8;
      ctx.lineWidth = Core.THICK * 0.42;
      ctx.stroke(path);
      ctx.restore();
    }

    // the ring being broken
    if (state.ring < n) {
      var cs2 = segments(state.stage, state.ring), crot = G.time * cs2.speed, col = ringColor(state.ring);
      var cl = closing(), danger = Math.max(0, (cl - 0.5) / 0.5), k = curRingR() / Core.ringRadius(state.ring);
      if (danger > 0) col = mix(col, '#ff2a4a', Math.min(1, danger * (0.75 + 0.25 * Math.sin(G.time * 18))));
      var alive = Math.max(0, Math.min(1, state.hp / ringMax())), aliveCount = Math.ceil(alive * cs2.length);
      var on = ringPath(state.stage, state.ring, 0, aliveCount), off = ringPath(state.stage, state.ring, aliveCount, cs2.length);
      ctx.save();
      ctx.rotate(crot);
      ctx.scale(k, k); // the cached shape, shrunk to where the wall is now
      var lw = 1 / k; // keep line widths the same while it shrinks
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = intro;
      ctx.strokeStyle = 'rgba(120, 140, 175, 0.16)';
      ctx.lineWidth = Core.THICK * 0.55 * lw;
      ctx.stroke(off);
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = G.burn ? '#ff7a1a' : col;
      if (!Q.low) {
        ctx.globalAlpha = (0.14 + G.pulse * 0.2 + danger * 0.15) * intro;
        ctx.lineWidth = Core.THICK * 3 * lw;
        ctx.stroke(on);
      }
      ctx.globalAlpha = (0.4 + G.pulse * 0.3) * intro;
      ctx.lineWidth = Core.THICK * 1.5 * lw;
      ctx.stroke(on);
      ctx.globalAlpha = intro;
      ctx.strokeStyle = mix(col, '#ffffff', 0.55);
      ctx.lineWidth = (Core.THICK * 0.7 + G.pulse * 2) * lw;
      ctx.stroke(on);
      ctx.restore();

      // tech ticks, turning the other way
      var tk = tickPaths(state.ring);
      ctx.save();
      ctx.rotate(-G.time * 0.25);
      ctx.scale(k, k);
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.4 / k;
      ctx.globalAlpha = 0.55 * intro;
      ctx.stroke(tk.major);
      if (!Q.low) { ctx.globalAlpha = 0.25 * intro; ctx.stroke(tk.minor); }
      ctx.restore();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    // glitch echo of a ring that just broke (red and cyan copies, slightly apart)
    ctx.globalCompositeOperation = 'lighter';
    G.ghosts.forEach(function (gh) {
      var k = gh.t / 0.3;
      ctx.lineWidth = Core.THICK * (1 - k) + 1;
      ctx.globalAlpha = (1 - k) * 0.85;
      ctx.strokeStyle = '#ff2a6d';
      ctx.beginPath(); ctx.arc(4 + k * 6, 0, gh.r + k * 30, 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#22e4ff';
      ctx.beginPath(); ctx.arc(-4 - k * 6, 0, gh.r + k * 30, 0, TAU); ctx.stroke();
    });

    // shock waves
    G.shocks.forEach(function (sw) {
      var k = sw.t / (sw.small ? 0.4 : 0.7);
      ctx.strokeStyle = sw.c;
      ctx.globalAlpha = Math.max(0, 1 - k) * 0.9;
      ctx.lineWidth = 6 * (1 - k) + 1;
      ctx.beginPath();
      ctx.arc(0, 0, sw.r + k * (sw.small ? 70 : 110), 0, TAU);
      ctx.stroke();
    });

    // bombs
    G.bombs.forEach(function (bm) {
      var k = bm.t / 1.1, pulse = 1 + Math.sin(bm.t * 20) * 0.12 * (1 + k * 2);
      ctx.globalAlpha = 0.35 + k * 0.4;
      ctx.fillStyle = '#ff7a1a';
      ctx.beginPath(); ctx.arc(bm.x, bm.y, 18 * pulse, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffe0c2';
      ctx.beginPath(); ctx.arc(bm.x, bm.y, 7 * pulse, 0, TAU); ctx.fill();
    });

    // lightning
    G.bolts.forEach(function (bl) {
      ctx.globalAlpha = Math.max(0, 1 - bl.t / 0.22);
      for (var pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass ? '#ffffff' : '#4dc9ff';
        ctx.lineWidth = pass ? 1.5 : 6;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        for (var j = 1; j <= 7; j++) {
          var q = j / 7, jx = Math.sin(bl.seed + j * 12.9898) * 12 * (1 - q * 0.3), jy = Math.cos(bl.seed + j * 78.233) * 12 * (1 - q * 0.3);
          ctx.lineTo(bl.x * q + (j === 7 ? 0 : jx), bl.y * q + (j === 7 ? 0 : jy));
        }
        ctx.stroke();
      }
    });
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();

    // the ring's HP in the middle, with a gauge around it
    ctx.save();
    ctx.translate(CX + sx, CY + sy);
    if (state.hp > 0) {
      var boss = Core.isBossRing(state.stage, state.ring), jack = Core.isJackpot(state.stage, state.ring);
      var hpCol = boss ? '#ff3b5c' : jack ? '#ffd43b' : th.a;
      var gR = Math.max(22, Math.min(48, (arenaR() - Core.BALL_R) * SCALE * 0.62));
      var frac = state.hp / ringMax();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(120, 140, 175, 0.18)';
      ctx.beginPath(); ctx.arc(0, 0, gR, 0, TAU); ctx.stroke();
      ctx.strokeStyle = hpCol;
      ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.arc(0, 0, gR, -Math.PI / 2, -Math.PI / 2 + frac * TAU); ctx.stroke();
      // time left before the wall reaches the core
      var left = Math.max(0, ringLimit() - G.ringT), timeFrac = 1 - closing();
      var tCol = timeFrac < 0.3 ? '#ff2a4a' : timeFrac < 0.55 ? '#ffb02e' : 'rgba(182, 255, 59, 0.85)';
      ctx.strokeStyle = tCol;
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.arc(0, 0, gR + 6, -Math.PI / 2, -Math.PI / 2 + timeFrac * TAU); ctx.stroke();
      ctx.lineWidth = 2;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '700 9px ' + MONO;
      ctx.fillStyle = hpCol;
      ctx.globalAlpha = 0.75;
      ctx.fillText(boss ? 'BOSS' : jack ? 'JACKPOT ×5' : 'HP', 0, -gR * 0.42);
      var hpText = Core.fmt(Math.ceil(state.hp));
      ctx.font = '800 ' + Math.round(Math.max(18, Math.min(30, gR * 0.62))) + 'px ' + MONO;
      ctx.globalAlpha = 0.3; // a cheap glow: a wide coloured outline instead of a blur
      ctx.lineWidth = 6;
      ctx.strokeStyle = hpCol;
      ctx.strokeText(hpText, 0, 3);
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = '#e8f6ff';
      ctx.fillText(hpText, 0, 3);
      ctx.font = '700 10px ' + MONO;
      ctx.fillStyle = tCol;
      ctx.fillText((G.dev.freeze ? '∞' : left.toFixed(1) + 's'), 0, gR * 0.45);
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // energy cores (balls) and particles
    ctx.save();
    ctx.translate(CX + sx, CY + sy);
    ctx.scale(SCALE, SCALE);
    var skin = (SKINS[state.skin] || SKINS.white).color;
    var glowSkin = state.skin === 'white' ? th.a : skin;
    ctx.globalCompositeOperation = 'lighter';
    for (var pi = 0; pi < G.parts.length; pi++) {
      var p = G.parts[pi];
      ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
      if (p.shard) {
        ctx.strokeStyle = p.c;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
        ctx.stroke();
      } else {
        ctx.fillStyle = p.c;
        ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
      }
    }
    var glow = halo(glowSkin), hr = Core.BALL_R * 3.4;
    G.balls.forEach(function (b) {
      var tr = b.trail;
      ctx.strokeStyle = glowSkin;
      for (var i2 = 2; i2 < tr.length; i2 += 2) {
        var q2 = i2 / tr.length;
        ctx.globalAlpha = q2 * 0.55;
        ctx.lineWidth = Core.BALL_R * 1.4 * q2;
        ctx.beginPath();
        ctx.moveTo(tr[i2 - 2], tr[i2 - 1]);
        ctx.lineTo(tr[i2], tr[i2 + 1]);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.6;
      ctx.drawImage(glow, b.x - hr, b.y - hr, hr * 2, hr * 2);
    });
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    G.balls.forEach(function (b) {
      ctx.fillStyle = skin;
      ctx.beginPath(); ctx.arc(b.x, b.y, Core.BALL_R, 0, TAU); ctx.fill();
      ctx.strokeStyle = glowSkin;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(b.x, b.y, Core.BALL_R + 3, G.time * 6, G.time * 6 + Math.PI * 1.2); ctx.stroke();
    });
    ctx.restore();

    // screen flash when a ring breaks
    if (G.flash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = th.a;
      ctx.globalAlpha = G.flash * 0.12;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // floating numbers
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0, 4, 12, 0.85)';
    G.texts.forEach(function (tx) {
      ctx.globalAlpha = Math.max(0, 1 - tx.t / 0.9);
      ctx.font = '800 ' + tx.z + 'px ' + MONO;
      var x = CX + tx.x * SCALE, y = CY + tx.y * SCALE;
      ctx.strokeText(tx.s, x, y);
      ctx.fillStyle = tx.c;
      ctx.fillText(tx.s, x, y);
    });
    ctx.globalAlpha = 1;
  }

  /* ============================================================
   * Screens: HUD, upgrade cards, slots
   * ============================================================ */

  var hudCache = {};
  function setText(id, value) {
    if (hudCache[id] !== value) { hudCache[id] = value; $(id).textContent = value; }
  }

  function dps() {
    var sum = 0;
    for (var i = 0; i < G.dmgLog.length; i++) sum += G.dmgLog[i].v;
    return sum / Math.min(3, Math.max(1, G.time));
  }

  var UPGRADES = [
    { id: 'damage', title: 'Damage', cost: Core.cost.damage, value: function (l) { return Core.fmt(Core.damage(l)); }, bar: function (l) { return (l % 10) / 10; }, x2: true },
    { id: 'income', title: 'Cash Income', cost: Core.cost.income, value: function (l) { return Core.fmt(Math.round(Core.income(l) * 10) / 10); }, bar: function (l) { return (l % 10) / 10; }, x2: true },
    { id: 'speed', title: 'Ball Speed', cost: Core.cost.speed, value: function (l) { return Math.round(Core.speedMult(l) * 100) + '%'; }, bar: function (l) { return l / Core.MAX_SPEED_LEVEL; }, max: Core.MAX_SPEED_LEVEL },
    { id: 'balls', title: 'Extra Ball', cost: Core.cost.balls, value: function (l) { return String(1 + l); }, bar: function (l) { return l / Core.MAX_EXTRA_BALLS; }, max: Core.MAX_EXTRA_BALLS, levelWord: 'Balls' }
  ];

  function buildCards() {
    var box = $('cards');
    box.innerHTML = '';
    UPGRADES.forEach(function (u) {
      var el = document.createElement('div');
      el.className = 'up frame';
      el.innerHTML = '<h3>' + u.title + '</h3><div class="lv"></div><div class="val"></div>' +
        '<div class="bar"><i></i>' + (u.x2 ? '<em>x2</em>' : '') + '</div>' +
        '<button class="buy" type="button"><span class="c">' + plainIcon('coin') + '</span><b></b></button>';
      box.appendChild(el);
      u.el = el;
      u.lv = el.querySelector('.lv');
      u.val = el.querySelector('.val');
      u.fill = el.querySelector('.bar i');
      u.btn = el.querySelector('.buy');
      u.price = el.querySelector('.buy b');
      u.btn.querySelector('.c').firstChild.setAttribute('width', '20');
      holdToBuy(u);
    });
  }

  function holdToBuy(u) {
    var timer = 0, rep = 0;
    function go() { if (!buy(u)) stop(); }
    function stop() { clearTimeout(timer); clearInterval(rep); }
    u.btn.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      go();
      timer = setTimeout(function () { rep = setInterval(go, 110); }, 380);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { u.btn.addEventListener(ev, stop); });
  }

  function buy(u) {
    var l = state.up[u.id];
    if (u.max && l >= u.max) return false;
    var price = u.cost(l);
    if (state.cash < price) { sfx.nope(); return false; }
    state.cash -= price;
    state.up[u.id]++;
    sfx.buy();
    if (u.id === 'balls') syncBallCount();
    if (!state.tipSeen) { state.tipSeen = true; showTip(''); }
    return true;
  }

  function updateCards() {
    UPGRADES.forEach(function (u) {
      var l = state.up[u.id], maxed = u.max && l >= u.max;
      var lvText = u.levelWord ? u.levelWord + ' ' + (1 + l) : 'Level ' + (l + 1);
      if (u.lv.textContent !== lvText) u.lv.textContent = lvText;
      var v = u.value(l);
      if (u.val.textContent !== v) u.val.textContent = v;
      var wv = Math.round(u.bar(l) * 100) + '%';
      if (u.fill.style.width !== wv) u.fill.style.width = wv;
      if (maxed) {
        u.price.textContent = 'MAX';
        u.btn.disabled = true;
        u.btn.classList.remove('can');
        u.el.classList.add('maxed');
      } else {
        var price = u.cost(l), t = Core.fmt(price);
        if (u.price.textContent !== t) u.price.textContent = t;
        var can = state.cash >= price;
        u.btn.classList.toggle('can', can);
        u.btn.disabled = false;
      }
    });
  }

  var slotInfoTimer = 0;
  function buildSlots() {
    var box = $('slots');
    box.innerHTML = '';
    for (var i = 0; i < 6; i++) {
      var id = state.order[i], b = document.createElement('button');
      b.type = 'button';
      if (id) {
        var c = Core.card(id);
        b.className = 'slot ' + c.rarity;
        b.innerHTML = plainIcon(id) + '<b>' + state.cards[id] + '</b>';
        b.setAttribute('aria-label', c.name + ' level ' + state.cards[id]);
        (function (card) {
          b.onclick = function () {
            var l = state.cards[card.id];
            $('slotInfo').textContent = card.name + ' · level ' + l + ' · ' + card.desc(l);
            clearTimeout(slotInfoTimer);
            slotInfoTimer = setTimeout(function () { $('slotInfo').textContent = ''; }, 5000);
          };
        })(c);
      } else {
        b.className = 'slot empty';
        b.disabled = true;
        b.innerHTML = '<span style="font-size:22px;color:#555">+</span>';
      }
      box.appendChild(b);
    }
  }

  function updateHud() {
    setText('cash', Core.fmt(state.cash));
    setText('gems', Core.fmt(state.gems));
    setText('keys', String(state.keys));
    setText('lvl', 'LVL ' + state.level);
    setText('stageNo', String(state.stage));
    var done = (state.ring + (1 - Math.min(1, Math.max(0, state.hp / ringMax())))) / ringCount();
    setText('pct', Math.max(0, Math.min(100, Math.floor(done * 100))) + '%');
    $('xpFill').style.width = Math.min(100, (state.xp / Core.xpNeed(state.level)) * 100) + '%';
    setText('dps', 'DPS: ' + Core.fmt(Math.round(dps() * 10) / 10));
    var near = G.started && G.modals === 0 && state.hp > 0 && G.balls.length ? Math.max(0, (closing() - 0.65) / 0.35) : 0;
    $('danger').style.opacity = near ? (0.35 + near * 0.65).toFixed(2) : '0';
    updateCards();
  }

  function showTip(str) {
    var t = $('tip');
    t.textContent = str;
    t.classList.toggle('show', !!str);
  }

  function toast(str) {
    var t = document.createElement('div');
    t.className = 'toast';
    t.textContent = str;
    $('app').appendChild(t);
    setTimeout(function () { t.remove(); }, 2300);
  }

  /* ============================================================
   * Modals
   * ============================================================ */

  function openModal(build) {
    var m = document.createElement('div');
    m.className = 'modal';
    $('modals').appendChild(m);
    G.modals++;
    var handle = { el: m, closed: false, close: function () { if (handle.closed) return; handle.closed = true; m.remove(); G.modals--; } };
    build(m, handle);
    return handle;
  }

  /* ---- level-up offers ---- */

  var offerState = null;
  function showOffers() {
    if (G.modals > 0 || state.pending <= 0) return;
    offerState = { refreshes: 2, boost: false, bought: false };
    var offers = Core.pickOffers(state.cards, Math.random, false);
    if (!offers.length) { state.pending = 0; state.gems += 30; toast('All cards maxed! +30 gems'); return; }

    openModal(function (m, h) {
      function render() {
        var allCost = 40 + 10 * state.level;
        m.innerHTML = '<h2>Upgrade Offers</h2><div class="offers"></div>' +
          '<p class="hint">High chance of <b>Epic or Legendary</b> cards after a refresh</p>' +
          '<div class="row"><div class="col"><button class="btn" id="refresh">Refresh</button><span>Remaining: <b style="color:#69db7c">' + offerState.refreshes + '</b> times</span></div>' +
          '<div class="col"><button class="btn green" id="all">Obtain all</button><span>' + plainIcon('gem') + ' <b style="color:' + (state.gems >= allCost ? '#69db7c' : '#ff8787') + '">' + allCost + '</b> gems · you have ' + Core.fmt(state.gems) + '</span></div></div>';
        var list = m.querySelector('.offers');
        offers.forEach(function (id) {
          var c = Core.card(id), l = state.cards[id] || 0, o = document.createElement('button');
          o.type = 'button';
          o.className = 'offer frame ' + c.rarity;
          o.innerHTML = '<span class="tag' + (l ? ' up2' : '') + '">' + (l ? 'Lv ' + l + ' → ' + (l + 1) : 'New') + '</span>' +
            '<h3>' + c.name + '</h3><span class="rar">' + RARITY_NAME[c.rarity] + '</span>' + icon(id) + '<p>' + c.desc(l + 1) + '</p>';
          o.onclick = function () { take([id]); };
          list.appendChild(o);
        });
        var r = m.querySelector('#refresh');
        r.disabled = offerState.refreshes <= 0;
        r.onclick = function () {
          if (offerState.refreshes <= 0) return;
          offerState.refreshes--;
          offerState.boost = true;
          offers = Core.pickOffers(state.cards, Math.random, true);
          sfx.buy();
          render();
        };
        var a = m.querySelector('#all');
        a.disabled = state.gems < allCost;
        a.onclick = function () { if (state.gems < allCost) return; state.gems -= allCost; take(offers.slice()); };
      }
      function take(ids) {
        ids.forEach(function (id) {
          var c = Core.card(id);
          if (!c) return;
          state.cards[id] = Math.min(c.max, (state.cards[id] || 0) + 1);
          if (state.order.indexOf(id) < 0) {
            if (state.order.length >= 6) state.order.shift();
            state.order.push(id);
          }
        });
        refreshMods();
        syncBallCount();
        buildSlots();
        sfx.pick();
        state.pending--;
        h.close();
        save();
        if (state.pending > 0) showOffers();
      }
      render();
    });
  }

  /* ---- chests at the end of a stage ---- */

  function showChests(stage, done) {
    openModal(function (m, h) {
      var opened = false;
      function render() {
        m.innerHTML = '<h2>Stage ' + stage + ' cleared!</h2>' +
          '<p class="sub">' + (state.keys > 0 && !opened ? 'Spend a key to open one chest.' : opened ? 'Nice find!' : 'No keys left. Bosses and stage clears give keys.') + '</p>' +
          '<div class="chests"></div>' +
          '<div class="row"><div class="col"><button class="btn gold" id="go">' + (opened ? 'Next stage' : (state.keys > 0 ? 'Skip' : 'Next stage')) + '</button></div></div>';
        var box = m.querySelector('.chests');
        for (var i = 0; i < 3; i++) {
          var c = document.createElement('button');
          c.type = 'button';
          c.className = 'chest';
          c.innerHTML = icon('chest') + '<span>' + (state.keys > 0 ? 'Open · 1 key' : 'Locked') + '</span>';
          c.disabled = opened || state.keys <= 0;
          (function (el) { el.onclick = function () { open(el); }; })(c);
          box.appendChild(c);
        }
        m.querySelector('#go').onclick = function () {
          if (!opened && state.keys <= 0) state.gems += 5;
          h.close();
          done();
        };
      }
      function open(el) {
        if (opened || state.keys <= 0) return;
        state.keys--;
        opened = true;
        var r = Math.random(), label;
        var base = Core.ringReward(stage, Core.ringsInStage(stage) - 1, state.up.income);
        if (r < 0.55) { var cash = base * (12 + Math.random() * 16); gainCash(cash); label = '+' + Core.fmt(cash) + ' cash'; }
        else if (r < 0.92) { var g = 15 + stage * 2 + Math.floor(Math.random() * 20); state.gems += g; label = '+' + g + ' gems'; }
        else { state.keys += 2; label = '+2 keys'; }
        sfx.coin();
        render();
        var all = m.querySelectorAll('.chest');
        var idx = Array.prototype.indexOf.call(el.parentNode.children, el);
        all[idx].classList.add('opened');
        all[idx].querySelector('span').innerHTML = '<span class="reward">' + label + '</span>';
        Array.prototype.forEach.call(all, function (x, i) { if (i !== idx) x.style.opacity = 0.4; });
      }
      render();
    });
  }

  /* ---- offline earnings ---- */

  function showWelcomeBack(secs, amount) {
    openModal(function (m, h) {
      var mins = Math.round(secs / 60);
      m.innerHTML = '<h2>Welcome back!</h2><p class="sub">Your ball kept working for ' + (mins >= 60 ? Math.floor(mins / 60) + ' h ' + (mins % 60) + ' min' : mins + ' min') + '.</p>' +
        '<div class="panel frame" style="text-align:center"><div class="big-num">+$' + Core.fmt(amount) + '</div><div class="hint">earned by your core while you were away</div></div>' +
        '<div class="row"><div class="col"><button class="btn gold" id="collect">Collect</button></div></div>';
      m.querySelector('#collect').onclick = function () { gainCash(amount); sfx.coin(); h.close(); save(); };
    });
  }

  /* ---- menu ---- */

  function showMenu() {
    openModal(function (m, h) {
      var tab = 'shop';
      function render() {
        var body = '';
        if (tab === 'shop') {
          body += '<div class="hint" style="margin-bottom:8px">Ring colours</div><div class="shop">';
          Object.keys(THEMES).forEach(function (k) {
            var t = THEMES[k], own = state.themes.indexOf(k) >= 0;
            body += '<div class="item' + (state.theme === k ? ' on' : '') + '"><div class="sw" style="background:linear-gradient(135deg,' + t.a + ',' + t.b + ')"></div><b>' + t.name + '</b>' +
              '<button class="btn small" data-theme="' + k + '"' + (!own && state.gems < t.cost ? ' disabled' : '') + '>' + (state.theme === k ? 'Equipped' : own ? 'Equip' : plainIcon('gem') + t.cost) + '</button></div>';
          });
          body += '</div><div class="hint" style="margin:14px 0 8px">Ball colours</div><div class="shop">';
          Object.keys(SKINS).forEach(function (k) {
            var t = SKINS[k], own = state.skins.indexOf(k) >= 0;
            body += '<div class="item' + (state.skin === k ? ' on' : '') + '"><div class="sw" style="background:' + t.color + ';box-shadow:0 0 14px ' + t.color + '"></div><b>' + t.name + '</b>' +
              '<button class="btn small" data-skin="' + k + '"' + (!own && state.gems < t.cost ? ' disabled' : '') + '>' + (state.skin === k ? 'Equipped' : own ? 'Equip' : plainIcon('gem') + t.cost) + '</button></div>';
          });
          body += '</div>';
        } else if (tab === 'settings') {
          body += '<div class="set"><span>Sound</span><button class="toggle" data-set="sound" aria-pressed="' + state.sound + '" aria-label="Sound"></button></div>' +
            '<div class="set"><span>Vibration</span><button class="toggle" data-set="vibrate" aria-pressed="' + state.vibrate + '" aria-label="Vibration"></button></div>' +
            '<div class="set"><span>Graphics</span><span>' + ['auto', 'high', 'low'].map(function (g) {
              return '<button class="btn small" data-gfx="' + g + '" style="width:auto;display:inline-flex;margin-left:6px;' + (state.gfx === g ? '' : 'opacity:.45') + '">' + g + '</button>';
            }).join('') + '</span></div>' +
            '<div class="set"><span>Show FPS</span><button class="toggle" data-set="showFps" aria-pressed="' + state.showFps + '" aria-label="Show FPS"></button></div>' +
            '<div class="set"><span>Erase all progress</span><button class="btn small" id="reset" style="width:auto">Reset</button></div>' +
            '<p class="hint" style="margin-top:12px">Your progress is saved on this device only. Nothing is sent anywhere.</p>';
        } else {
          var mins = Math.floor(state.seconds / 60);
          body += [['Best stage', state.bestStage], ['Rings broken', Core.fmt(state.broken)], ['Player level', state.level],
            ['Cards owned', state.order.length + ' / 10'], ['Time played', mins >= 60 ? Math.floor(mins / 60) + ' h ' + (mins % 60) + ' min' : mins + ' min']]
            .map(function (r) { return '<div class="stat-line"><span>' + r[0] + '</span><b>' + r[1] + '</b></div>'; }).join('');
        }
        m.innerHTML = '<button class="close" aria-label="Close">×</button><h2>Menu</h2><div class="panel frame"><div class="tabs" role="tablist">' +
          ['shop', 'settings', 'stats'].map(function (t) { return '<button role="tab" data-tab="' + t + '" aria-selected="' + (tab === t) + '">' + t[0].toUpperCase() + t.slice(1) + '</button>'; }).join('') +
          '</div>' + body + '</div>';
        m.querySelector('.close').onclick = function () { h.close(); save(); };
        Array.prototype.forEach.call(m.querySelectorAll('[data-tab]'), function (b) { b.onclick = function () { tab = b.dataset.tab; render(); }; });
        Array.prototype.forEach.call(m.querySelectorAll('[data-theme]'), function (b) {
          b.onclick = function () {
            var k = b.dataset.theme, t = THEMES[k];
            if (state.themes.indexOf(k) < 0) { if (state.gems < t.cost) return; state.gems -= t.cost; state.themes.push(k); sfx.buy(); }
            state.theme = k;
            applyThemeGlow();
            render();
          };
        });
        Array.prototype.forEach.call(m.querySelectorAll('[data-skin]'), function (b) {
          b.onclick = function () {
            var k = b.dataset.skin, t = SKINS[k];
            if (state.skins.indexOf(k) < 0) { if (state.gems < t.cost) return; state.gems -= t.cost; state.skins.push(k); sfx.buy(); }
            state.skin = k;
            render();
          };
        });
        Array.prototype.forEach.call(m.querySelectorAll('[data-set]'), function (b) {
          b.onclick = function () {
            state[b.dataset.set] = !state[b.dataset.set];
            if (b.dataset.set === 'sound' && state.sound) sfx.buy();
            if (b.dataset.set === 'showFps') $('fps').hidden = !state.showFps;
            render();
          };
        });
        Array.prototype.forEach.call(m.querySelectorAll('[data-gfx]'), function (b) {
          b.onclick = function () { state.gfx = b.dataset.gfx; fpsWindows = 0; setQuality(); render(); };
        });
        var reset = m.querySelector('#reset');
        if (reset) reset.onclick = function () {
          if (window.confirm('Erase all progress and start again?')) {
            try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* nothing stored */ }
            window.location.reload();
          }
        };
      }
      render();
    });
  }

  /* ---- developer menu (hidden: tap the LVL badge 7 times) ---- */

  function showDevMenu() {
    openModal(function (m, h) {
      function render() {
        var d = G.dev;
        var b = function (id, label, on) { return '<button class="btn small' + (on ? ' on' : '') + '" data-dev="' + id + '">' + label + '</button>'; };
        m.innerHTML = '<button class="close" aria-label="Close">×</button><h2 style="color:var(--pink)">Mod menu</h2>' +
          '<p class="sub">Developer options · cash ' + Core.fmt(state.cash) + ' · gems ' + Core.fmt(state.gems) + ' · stage ' + state.stage + '</p>' +
          '<div class="panel frame">' +
          '<p class="dev-h">Money</p><div class="dev-grid">' + b('c3', '+1K') + b('c6', '+1M') + b('c9', '+1B') + b('c12', '+1T') + b('cx', '×10 cash') + b('g', '+500 gems') + b('k', '+10 keys') + b('xp', 'Level up') + b('cards', 'Max cards') + '</div>' +
          '<p class="dev-h">Upgrades</p><div class="dev-grid">' + b('ud', 'Damage +10') + b('ui', 'Income +10') + b('us', 'Max speed') + b('ub', 'Max balls') + '</div>' +
          '<p class="dev-h">Stage</p><div class="dev-grid">' + b('ring', 'Skip ring') + b('stage', 'Clear stage') + b('prev', 'Stage −1') + b('next', 'Stage +1') + '</div>' +
          '<p class="dev-h">Cheats</p><div class="dev-grid">' + b('god', 'God mode', d.god) + b('freeze', 'Freeze wall', d.freeze) +
          b('s1', 'Speed 1×', d.speed === 1) + b('s2', 'Speed 2×', d.speed === 2) + b('s5', 'Speed 5×', d.speed === 5) + '</div>' +
          '<p class="dev-h">Other</p><div class="dev-grid">' + b('hide', 'Hide dev mode') + b('reset', 'Reset all') + '</div>' +
          '<p class="hint">God mode: the wall never crushes the core. Freeze wall: rings stop closing. Cheats last until the game is closed.</p></div>';
        m.querySelector('.close').onclick = function () { h.close(); save(); };
        Array.prototype.forEach.call(m.querySelectorAll('[data-dev]'), function (btn) {
          btn.onclick = function () { act(btn.dataset.dev); };
        });
      }
      function goStage(n) {
        state.stage = Math.max(1, n);
        state.bestStage = Math.max(state.bestStage, state.stage);
        state.ring = 0;
        state.hp = ringMax();
        G.ringT = 0;
        pathCache = {};
        tickCache = {};
        G.segCache = {};
        G.intro = 0;
        resetBalls();
      }
      function act(id) {
        var d = G.dev, money = { c3: 1e3, c6: 1e6, c9: 1e9, c12: 1e12 };
        if (money[id]) state.cash += money[id];
        else if (id === 'cx') state.cash = Math.max(10, state.cash) * 10;
        else if (id === 'g') state.gems += 500;
        else if (id === 'k') state.keys += 10;
        else if (id === 'xp') { state.pending++; state.level++; }
        else if (id === 'cards') { Core.CARDS.forEach(function (c) { state.cards[c.id] = c.max; }); state.order = Core.CARDS.slice(0, 6).map(function (c) { return c.id; }); refreshMods(); syncBallCount(); buildSlots(); }
        else if (id === 'ud') state.up.damage += 10;
        else if (id === 'ui') state.up.income += 10;
        else if (id === 'us') state.up.speed = Core.MAX_SPEED_LEVEL;
        else if (id === 'ub') { state.up.balls = Core.MAX_EXTRA_BALLS; syncBallCount(); }
        else if (id === 'ring') { if (state.hp > 0) { h.close(); dealDamage(state.hp + 1, 0, 0, 'hit'); return; } }
        else if (id === 'stage') { h.close(); for (var i = 0; i < 60 && G.modals === 0 && state.hp > 0; i++) dealDamage(state.hp + 1, 0, 0, 'hit'); return; }
        else if (id === 'prev') goStage(state.stage - 1);
        else if (id === 'next') goStage(state.stage + 1);
        else if (id === 'god') d.god = !d.god;
        else if (id === 'freeze') d.freeze = !d.freeze;
        else if (id === 's1' || id === 's2' || id === 's5') d.speed = +id.slice(1);
        else if (id === 'hide') { state.dev = false; d.god = d.freeze = false; d.speed = 1; $('devBtn').hidden = true; h.close(); save(); return; }
        else if (id === 'reset') {
          if (window.confirm('Erase all progress and start again?')) { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* nothing stored */ } window.location.reload(); }
          return;
        }
        sfx.buy();
        save();
        render();
        if (id === 'xp' && state.pending > 0) { h.close(); showOffers(); }
      }
      render();
    });
  }

  var lvlTaps = [];
  $('lvl').addEventListener('click', function () {
    var now = Date.now();
    lvlTaps = lvlTaps.filter(function (t) { return now - t < 3000; });
    lvlTaps.push(now);
    if (lvlTaps.length >= 7 && !state.dev) {
      state.dev = true;
      lvlTaps = [];
      $('devBtn').hidden = false;
      toast('Developer mode on');
      save();
    }
  });
  $('devBtn').addEventListener('click', function () { if (G.started && G.modals === 0) showDevMenu(); });
  $('devBtn').hidden = !state.dev;

  /* ============================================================
   * Start, loop, input
   * ============================================================ */

  function begin() {
    if (G.started) return;
    G.started = true;
    $('start').remove();
    audio();
    resetBalls();
    G.intro = 0;
    var secs = Math.min((Date.now() - state.lastSeen) / 1000, OFFLINE_CAP);
    if (secs >= 90 && state.cps > 0) showWelcomeBack(secs, secs * state.cps);
    if (!state.tipSeen) {
      showTip('Your ball breaks the rings by itself.\nUpgrade Damage to break them faster!');
      setTimeout(function () { showTip(''); }, 9000);
    }
    checkLevelUp();
  }

  var lastT = 0, hudT = 0, fpsT = 0, fpsN = 0, fpsWindows = 0, modalT = 0;
  function frame(now) {
    var raw = (now - lastT) / 1000 || 0.016, dt = Math.min(0.05, raw);
    lastT = now;
    update(G.dev.speed > 1 ? Math.min(0.05 * G.dev.speed, dt * G.dev.speed) : dt);
    // Under a menu the game is paused: after the fade-in, stop redrawing it (saves battery).
    modalT = G.modals > 0 ? modalT + dt : 0;
    if (modalT < 0.6) draw();
    hudT += dt;
    if (hudT > 0.1) { hudT = 0; updateHud(); }
    watchFps(raw);
    requestAnimationFrame(frame);
  }

  // Measures the frame rate; in "auto" quality, steps the resolution down until the game runs smoothly.
  function watchFps(raw) {
    if (G.modals > 0 || document.hidden || raw > 0.5) return;
    fpsT += raw;
    fpsN++;
    if (fpsT < 2) return;
    var fps = fpsN / fpsT;
    fpsT = 0;
    fpsN = 0;
    fpsWindows++;
    var el = $('fps');
    el.hidden = !state.showFps;
    if (state.showFps) el.textContent = Math.round(fps) + ' FPS · ' + dpr.toFixed(2) + '×' + (Q.low ? ' · lite' : '');
    if (state.gfx !== 'auto' || fpsWindows < 2 || !G.started) return; // let things settle first
    if (fps < 50 && Q.dpr > 1) { Q.dpr = Math.max(1, Q.dpr - 0.25); resize(); }
    else if (fps < 45 && !Q.low) { Q.low = true; }
  }

  canvas.addEventListener('pointerdown', function (e) {
    if (!G.started || G.modals > 0 || G.tapCd > 0 || state.hp <= 0) return;
    G.tapCd = 0.22;
    var r = canvas.getBoundingClientRect();
    var x = (e.clientX - r.left - CX) / SCALE, y = (e.clientY - r.top - CY) / SCALE;
    var d = Math.hypot(x, y) || 1, R = arenaR();
    spark(x, y, '#d0ebff', 6, 0.6);
    G.pulse = 0.7;
    dealDamage(hitDamage() * 2, (x / d) * R, (y / d) * R, 'tap');
    sfx.hit(8);
  });

  $('menuBtn').addEventListener('click', function () { if (G.started && G.modals === 0) showMenu(); });
  $('playBtn').addEventListener('click', begin);
  window.addEventListener('resize', resize);
  var hiddenAt = 0;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { hiddenAt = Date.now(); updateCps(); save(); return; }
    // Back from another app or tab: pay out what the ball earned in the meantime.
    var secs = hiddenAt ? Math.min((Date.now() - hiddenAt) / 1000, OFFLINE_CAP) : 0;
    hiddenAt = 0;
    if (G.started && G.modals === 0 && secs >= 90 && state.cps > 0) showWelcomeBack(secs, secs * state.cps);
  });
  window.addEventListener('pagehide', function () { updateCps(); save(); });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { var last = $('modals').lastElementChild; var c = last && last.querySelector('.close'); if (c) c.click(); }
  });

  // The Android app calls this for the back button. true = handled here, false = leave the game (it keeps running in the background).
  window.RBBack = function () {
    var last = $('modals').lastElementChild;
    if (!last) return false;
    var c = last.querySelector('.close');
    if (c) c.click(); // menus close; offers and chests must be answered, so the button does nothing there
    return true;
  };

  function updateCps() {
    if (G.time < 20) return;
    var sum = 0;
    for (var i = 0; i < G.cashLog.length; i++) sum += G.cashLog[i].v;
    state.cps = sum / Math.min(30, G.time);
  }
  setInterval(function () { if (G.started) { updateCps(); save(); } }, 5000);

  function applyThemeGlow() {
    var th = THEMES[state.theme] || THEMES.cyber;
    $('app').style.setProperty('--glow', mix(th.b, '#02030a', 0.78));
  }
  applyThemeGlow();
  setQuality();
  buildCards();
  buildSlots();
  refreshMods();
  updateHud();
  requestAnimationFrame(function (t) { lastT = t; frame(t); });

  // Handy for tests and tinkering from the browser console.
  window.RB = {
    Core: Core, state: state, G: G, begin: begin, save: save,
    debug: {
      cash: function (n) { state.cash += n; },
      gems: function (n) { state.gems += n; },
      xp: function (n) { state.xp += n; checkLevelUp(); },
      breakRing: function () { dealDamage(state.hp + 1, 0, 0, 'hit'); },
      clearStage: function () { for (var i = 0; i < 40 && G.modals === 0; i++) dealDamage(state.hp + 1, 0, 0, 'hit'); }
    }
  };
})();
