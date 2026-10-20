/*
 * Ring Breaker: game rules and balance. Pure functions, no drawing, so they can be tested on their own.
 *
 * The idea: a ball bounces inside a ring. Each hit damages the ring; at 0 the ring breaks and the ball
 * escapes to the next, bigger ring. Break every ring to clear the stage. Cash buys upgrades, and every
 * level-up offers three upgrade cards (Burn, Bomb, Power, ...).
 */
(function (root) {
  'use strict';

  var Core = {
    R0: 70, // radius of the innermost ring (world units)
    SP: 26, // distance between rings
    THICK: 8, // ring thickness
    BALL_R: 10,
    BASE_SPEED: 300, // world units per second
    MAX_CARD_LEVEL: 10
  };

  /* ---------- numbers ---------- */

  var UNITS = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

  Core.fmt = function (n) {
    if (!isFinite(n)) return '∞';
    if (n < 1000) return n < 10 && n % 1 ? n.toFixed(1) : String(Math.floor(n));
    var i = -1;
    while (n >= 1000 && i < UNITS.length - 1) { n /= 1000; i++; }
    return (n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : String(Math.floor(n))) + UNITS[i];
  };

  /* ---------- stages and rings ---------- */

  Core.ringsInStage = function (stage) { return Math.min(10 + stage * 2, 26); };
  Core.isBossStage = function (stage) { return stage % 5 === 0; };
  Core.isBossRing = function (stage, i) { return Core.isBossStage(stage) && i === Core.ringsInStage(stage) - 1; };

  Core.ringHp = function (stage, i) {
    var hp = 8 * Math.pow(1.6, stage - 1) * Math.pow(1.11, i);
    if (Core.isBossRing(stage, i)) hp *= 6;
    return Math.ceil(hp);
  };

  Core.ringRadius = function (i) { return Core.R0 + i * Core.SP; };
  Core.arenaRadius = function (i) { return Core.ringRadius(i) - Core.THICK / 2; }; // free space inside ring i

  /* ---------- upgrades bought with cash ---------- */

  function round1(x) { return x < 10 ? Math.round(x * 10) / 10 : Math.round(x); }

  // Every 10th level doubles the effect (the "x2" bar on the card).
  Core.damage = function (level) { return round1(1.5 * Math.pow(1.075, level) * Math.pow(2, Math.floor(level / 10))); };
  Core.income = function (level) { return (1 + 0.4 * level) * Math.pow(2, Math.floor(level / 10)); };
  Core.speedMult = function (level) { return 1 + 0.05 * Math.min(level, 30); };
  Core.MAX_SPEED_LEVEL = 30;
  Core.MAX_EXTRA_BALLS = 4;

  Core.cost = {
    damage: function (l) { return Math.ceil(8 * Math.pow(1.27, l)); },
    income: function (l) { return Math.ceil(10 * Math.pow(1.29, l)); },
    speed: function (l) { return Math.ceil(60 * Math.pow(1.38, l)); },
    balls: function (n) { return Math.ceil(400 * Math.pow(9, n)); }
  };

  // About 1 ring in 12 is a gold Jackpot ring worth 5× cash (never the first ring or a boss).
  // Decided by the stage and ring number, so it stays the same after reloading.
  Core.isJackpot = function (stage, i) {
    if (i === 0 || Core.isBossRing(stage, i)) return false;
    var h = Math.imul(stage * 7919 + i * 104729, 2654435761) >>> 0;
    return (h % 1000) < 85;
  };

  // Cash for breaking a ring (half is paid out as the ring is damaged, half when it breaks).
  Core.ringReward = function (stage, i, incomeLevel) {
    return Core.ringHp(stage, i) * 1.5 * Core.income(incomeLevel) * (Core.isJackpot(stage, i) ? 5 : 1);
  };

  Core.xpNeed = function (level) { return Math.round(25 * Math.pow(1.45, level - 1)); };
  Core.xpGain = function (stage, i) { return 3 + stage * 2 + (Core.isBossRing(stage, i) ? 12 : 0); };

  /* ---------- upgrade cards (offered at every level-up) ---------- */

  var pct = function (x) { return Math.round(x * 100); };

  Core.CARDS = [
    { id: 'power', name: 'Power', rarity: 'common', combat: false, max: 10,
      desc: function (l) { return '+' + 5 * l + '% damage and unlocks combat upgrades'; } },
    { id: 'fortune', name: 'Fortune', rarity: 'common', combat: false, max: 10,
      desc: function (l) { return '+' + 8 * l + '% cash from every hit'; } },
    { id: 'swift', name: 'Swift', rarity: 'common', combat: false, max: 10,
      desc: function (l) { return '+' + 4 * l + '% ball speed'; } },
    { id: 'prospector', name: 'Prospector', rarity: 'rare', combat: false, max: 10,
      desc: function (l) { return '+' + l + ' gem' + (l > 1 ? 's' : '') + ' from every ring'; } },
    { id: 'crit', name: 'Crit', rarity: 'rare', combat: true, max: 10,
      desc: function (l) { return Math.min(60, 6 * l) + '% chance to hit for 3× damage'; } },
    { id: 'burn', name: 'Burn', rarity: 'rare', combat: true, max: 10,
      desc: function (l) { return 'Ignites a ring, dealing ' + pct(0.25 + 0.1 * l) + '% of your hit damage every second for 3s'; } },
    { id: 'bomb', name: 'Bomb', rarity: 'epic', combat: true, max: 10,
      desc: function (l) { return '15% chance to leave a clone that explodes for ' + (5 * (1 + 0.25 * (l - 1))).toFixed(l > 1 ? 2 : 0).replace(/\.?0+$/, '') + '× damage'; } },
    { id: 'lightning', name: 'Lightning', rarity: 'epic', combat: true, max: 10,
      desc: function (l) { return 'Every 5th hit strikes for ' + (4 * (1 + 0.2 * (l - 1))).toFixed(1).replace(/\.0$/, '') + '× damage'; } },
    { id: 'twin', name: 'Twin', rarity: 'legendary', combat: false, max: 3,
      desc: function (l) { return '+' + l + ' extra ball' + (l > 1 ? 's' : ''); } },
    { id: 'finisher', name: 'Finisher', rarity: 'legendary', combat: true, max: 10,
      desc: function (l) { return '+' + 15 * l + '% damage against rings below 30% HP'; } }
  ];

  Core.card = function (id) {
    for (var i = 0; i < Core.CARDS.length; i++) if (Core.CARDS[i].id === id) return Core.CARDS[i];
    return null;
  };

  // What the owned cards add up to. cards = { id: level }.
  Core.mods = function (cards) {
    var L = function (id) { return (cards && cards[id]) || 0; };
    return {
      dmgMul: 1 + 0.05 * L('power'),
      cashMul: 1 + 0.08 * L('fortune'),
      speedMul: 1 + 0.04 * L('swift'),
      gemBonus: L('prospector'),
      critChance: Math.min(0.6, 0.06 * L('crit')),
      burnFrac: L('burn') ? 0.25 + 0.1 * L('burn') : 0,
      bombChance: L('bomb') ? 0.15 : 0,
      bombMul: L('bomb') ? 5 * (1 + 0.25 * (L('bomb') - 1)) : 0,
      lightMul: L('lightning') ? 4 * (1 + 0.2 * (L('lightning') - 1)) : 0,
      finisher: 0.15 * L('finisher'),
      twin: L('twin')
    };
  };

  var WEIGHT = { common: 50, rare: 30, epic: 14, legendary: 6 };
  var BOOST = { common: 1, rare: 1.3, epic: 3, legendary: 4 };

  // Three different cards the player can still improve. Combat cards appear once Power is owned.
  // boost = true after a Refresh: epic and legendary cards become much more likely.
  Core.pickOffers = function (cards, rand, boost) {
    rand = rand || Math.random;
    var hasAny = false, k;
    for (k in cards) if (cards[k] > 0) hasAny = true;
    if (!hasAny) return ['burn', 'bomb', 'power']; // the very first offer
    var pool = Core.CARDS.filter(function (c) {
      return (cards[c.id] || 0) < c.max && (!c.combat || (cards.power || 0) >= 1);
    });
    var out = [];
    while (out.length < 3 && pool.length) {
      var total = 0;
      pool.forEach(function (c) { total += WEIGHT[c.rarity] * (boost ? BOOST[c.rarity] : 1); });
      var r = rand() * total, idx = 0;
      for (var i = 0; i < pool.length; i++) {
        r -= WEIGHT[pool[i].rarity] * (boost ? BOOST[pool[i].rarity] : 1);
        if (r <= 0) { idx = i; break; }
      }
      out.push(pool[idx].id);
      pool.splice(idx, 1);
    }
    return out;
  };

  /* ---------- expected-value simulation (for balancing) ---------- */

  // Plays the game on paper: a greedy buyer, expected hits per second from the ring size.
  // Returns when each stage was cleared (seconds).
  Core.simulate = function (seconds, opts) {
    opts = opts || {};
    var s = { cash: 0, stage: 1, ring: 0, hp: Core.ringHp(1, 0), up: { damage: 0, income: 0, speed: 0, balls: 0 } };
    var t = 0, dt = 0.25, log = [], stageStart = 0;
    var cardMul = opts.cardBoost || 1; // rough stand-in for the cards
    while (t < seconds) {
      var maxHp = Core.ringHp(s.stage, s.ring);
      var R = Core.arenaRadius(s.ring) - Core.BALL_R;
      var speed = Core.BASE_SPEED * Core.speedMult(s.up.speed);
      var hits = (1 + s.up.balls) * (speed / (1.5 * R)) * dt;
      var dealt = Math.min(s.hp, hits * Core.damage(s.up.damage) * cardMul);
      var reward = Core.ringReward(s.stage, s.ring, s.up.income);
      s.hp -= dealt;
      s.cash += reward * 0.5 * (dealt / maxHp);
      if (s.hp <= 1e-9) {
        s.cash += reward * 0.5;
        s.ring++;
        if (s.ring >= Core.ringsInStage(s.stage)) {
          log.push({ stage: s.stage, seconds: Math.round(t - stageStart), t: Math.round(t), dmg: s.up.damage, inc: s.up.income });
          stageStart = t;
          s.stage++;
          s.ring = 0;
        }
        s.hp = Core.ringHp(s.stage, s.ring);
      }
      // greedy buying: whichever of damage / income is cheaper
      for (var guard = 0; guard < 50; guard++) {
        var cd = Core.cost.damage(s.up.damage), ci = Core.cost.income(s.up.income);
        if (cd <= ci && s.cash >= cd) { s.cash -= cd; s.up.damage++; }
        else if (ci < cd && s.cash >= ci) { s.cash -= ci; s.up.income++; }
        else break;
      }
      t += dt;
    }
    return { stages: log, state: s };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.RBCore = Core;
})(typeof window !== 'undefined' ? window : this);
