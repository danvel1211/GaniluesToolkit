/*
 * Object removal without AI: patch-based image completion (PatchMatch, Barnes et al. 2009,
 * with the multi-scale voting of Wexler et al. 2007, the approach behind classic
 * "content-aware fill"). Holes are rebuilt from similar patches found elsewhere in the image.
 *
 * Inpaint.run(rgba, hole, w, h, onProgress) → Promise<Uint8ClampedArray>
 * Runs in a Web Worker when possible so the page stays responsive.
 */
(function (global) {
  'use strict';

  // Everything the worker needs lives inside this function; it is serialised into the worker.
  function factory() {
    var R = 3; // patch radius → 7×7 patches
    var SIGMA2 = 2 * 20 * 20; // similarity weighting for voting

    var seed = 123456789;
    function rand() { // xorshift32, fast and deterministic
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      return (seed >>> 0) / 4294967296;
    }

    function downsample(lv) {
      var w = lv.w, h = lv.h, nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1);
      var img = new Float32Array(nw * nh * 4), hole = new Uint8Array(nw * nh);
      for (var y = 0; y < nh; y++) {
        for (var x = 0; x < nw; x++) {
          var n = 0, anyHole = 0, acc = [0, 0, 0, 0];
          for (var dy = 0; dy < 2; dy++) {
            for (var dx = 0; dx < 2; dx++) {
              var sx = Math.min(w - 1, x * 2 + dx), sy = Math.min(h - 1, y * 2 + dy), si = sy * w + sx;
              if (lv.hole[si]) { anyHole = 1; continue; }
              for (var c = 0; c < 4; c++) acc[c] += lv.img[si * 4 + c];
              n++;
            }
          }
          var o = y * nw + x;
          hole[o] = anyHole; // conservative: the coarse hole covers the fine one
          for (var k = 0; k < 4; k++) img[o * 4 + k] = n ? acc[k] / n : 0;
        }
      }
      return { img: img, hole: hole, w: nw, h: nh };
    }

    // Sources are patch centres whose whole patch is inside the image and outside the hole.
    function buildSources(lv) {
      var w = lv.w, h = lv.h, sum = new Int32Array((w + 1) * (h + 1));
      for (var y = 0; y < h; y++) {
        var row = 0;
        for (var x = 0; x < w; x++) {
          row += lv.hole[y * w + x];
          sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row;
        }
      }
      var valid = new Uint8Array(w * h), list = [];
      for (var cy = R; cy < h - R; cy++) {
        for (var cx = R; cx < w - R; cx++) {
          var x0 = cx - R, y0 = cy - R, x1 = cx + R + 1, y1 = cy + R + 1;
          var holes = sum[y1 * (w + 1) + x1] - sum[y0 * (w + 1) + x1] - sum[y1 * (w + 1) + x0] + sum[y0 * (w + 1) + x0];
          if (!holes) { valid[cy * w + cx] = 1; list.push(cy * w + cx); }
        }
      }
      lv.valid = valid;
      lv.sources = Int32Array.from(list);
    }

    // Targets are patch centres that overlap the hole.
    function buildTargets(lv) {
      var w = lv.w, h = lv.h, mark = new Uint8Array(w * h), list = [];
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          if (!lv.hole[y * w + x]) continue;
          for (var dy = -R; dy <= R; dy++) {
            var yy = y + dy;
            if (yy < 0 || yy >= h) continue;
            for (var dx = -R; dx <= R; dx++) {
              var xx = x + dx;
              if (xx >= 0 && xx < w) mark[yy * w + xx] = 1;
            }
          }
        }
      }
      for (var i = 0; i < w * h; i++) if (mark[i]) list.push(i);
      lv.isTarget = mark;
      lv.targets = Int32Array.from(list);
    }

    function distance(lv, t, s, best) {
      var w = lv.w, h = lv.h, img = lv.img;
      var tx = t % w, ty = (t / w) | 0, sx = s % w, sy = (s / w) | 0, sum = 0;
      for (var dy = -R; dy <= R; dy++) {
        var y = ty + dy;
        if (y < 0 || y >= h) continue;
        var trow = y * w, srow = (sy + dy) * w;
        for (var dx = -R; dx <= R; dx++) {
          var x = tx + dx;
          if (x < 0 || x >= w) continue;
          var ti = (trow + x) * 4, si = (srow + sx + dx) * 4;
          var d0 = img[ti] - img[si], d1 = img[ti + 1] - img[si + 1], d2 = img[ti + 2] - img[si + 2];
          sum += d0 * d0 + d1 * d1 + d2 * d2;
          if (sum >= best) return sum;
        }
      }
      return sum;
    }

    function randomSource(lv) {
      return lv.sources[(rand() * lv.sources.length) | 0];
    }

    function patchMatch(lv, passes, searchRadius) {
      var w = lv.w, h = lv.h, nnf = lv.nnf, dist = lv.dist, targets = lv.targets;
      for (var i = 0; i < targets.length; i++) dist[targets[i]] = distance(lv, targets[i], nnf[targets[i]], Infinity);
      for (var pass = 0; pass < passes; pass++) {
        var fwd = pass % 2 === 0, dir = fwd ? 1 : -1;
        for (var k = 0; k < targets.length; k++) {
          var t = targets[fwd ? k : targets.length - 1 - k];
          var tx = t % w, ty = (t / w) | 0;
          var best = dist[t], bestS = nnf[t], c, d;
          // Propagation: reuse the neighbour's match, shifted by one pixel.
          var nx = tx - dir;
          if (nx >= 0 && nx < w && lv.isTarget[t - dir]) {
            c = nnf[t - dir] + dir;
            var cx = c % w;
            if (cx >= 0 && cx < w && lv.valid[c]) {
              d = distance(lv, t, c, best);
              if (d < best) { best = d; bestS = c; }
            }
          }
          var ny = ty - dir;
          if (ny >= 0 && ny < h && lv.isTarget[t - dir * w]) {
            c = nnf[t - dir * w] + dir * w;
            if (c >= 0 && c < w * h && lv.valid[c]) {
              d = distance(lv, t, c, best);
              if (d < best) { best = d; bestS = c; }
            }
          }
          // Random search around the current best, shrinking the window.
          var bx = bestS % w, by = (bestS / w) | 0;
          for (var r = searchRadius; r >= 1; r >>= 1) {
            var rx = Math.min(w - 1, Math.max(0, bx + Math.round((rand() * 2 - 1) * r)));
            var ry = Math.min(h - 1, Math.max(0, by + Math.round((rand() * 2 - 1) * r)));
            c = ry * w + rx;
            if (!lv.valid[c]) continue;
            d = distance(lv, t, c, best);
            if (d < best) { best = d; bestS = c; }
          }
          nnf[t] = bestS;
          dist[t] = best;
        }
      }
    }

    // Each hole pixel becomes the weighted average of what overlapping patches say it should be.
    function vote(lv) {
      var w = lv.w, h = lv.h, img = lv.img, nnf = lv.nnf, dist = lv.dist, targets = lv.targets;
      var acc = new Float32Array(w * h * 4), wsum = new Float32Array(w * h);
      for (var k = 0; k < targets.length; k++) {
        var t = targets[k], s = nnf[t];
        var tx = t % w, ty = (t / w) | 0, sx = s % w, sy = (s / w) | 0;
        var weight = Math.exp(-(dist[t] / ((2 * R + 1) * (2 * R + 1) * 3)) / SIGMA2) + 1e-6;
        for (var dy = -R; dy <= R; dy++) {
          var y = ty + dy;
          if (y < 0 || y >= h) continue;
          for (var dx = -R; dx <= R; dx++) {
            var x = tx + dx;
            if (x < 0 || x >= w) continue;
            var p = y * w + x;
            if (!lv.hole[p]) continue;
            var si = ((sy + dy) * w + sx + dx) * 4;
            acc[p * 4] += weight * img[si];
            acc[p * 4 + 1] += weight * img[si + 1];
            acc[p * 4 + 2] += weight * img[si + 2];
            acc[p * 4 + 3] += weight * img[si + 3];
            wsum[p] += weight;
          }
        }
      }
      for (var i = 0; i < w * h; i++) {
        if (!lv.hole[i] || !wsum[i]) continue;
        for (var c = 0; c < 4; c++) img[i * 4 + c] = acc[i * 4 + c] / wsum[i];
      }
    }

    // Coarsest level starts from the hole's surroundings, filled inwards ring by ring.
    function onionFill(lv) {
      var w = lv.w, h = lv.h, known = new Uint8Array(w * h), img = lv.img, left = 0, i;
      for (i = 0; i < w * h; i++) { known[i] = lv.hole[i] ? 0 : 1; if (!known[i]) left++; }
      while (left > 0) {
        var ring = [];
        for (i = 0; i < w * h; i++) {
          if (known[i]) continue;
          var x = i % w, y = (i / w) | 0, n = 0, acc = [0, 0, 0, 0];
          for (var dy = -1; dy <= 1; dy++) {
            for (var dx = -1; dx <= 1; dx++) {
              var xx = x + dx, yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
              var j = yy * w + xx;
              if (!known[j]) continue;
              for (var c = 0; c < 4; c++) acc[c] += img[j * 4 + c];
              n++;
            }
          }
          if (n) ring.push([i, acc[0] / n, acc[1] / n, acc[2] / n, acc[3] / n]);
        }
        if (!ring.length) break;
        ring.forEach(function (r) {
          for (var c = 0; c < 4; c++) img[r[0] * 4 + c] = r[c + 1];
          known[r[0]] = 1;
          left--;
        });
      }
    }

    return function inpaint(rgba, holeMask, w, h, progress) {
      var base = { img: new Float32Array(rgba), hole: holeMask, w: w, h: h };
      var levels = [base];
      // Build the pyramid down to where the hole is a few patches across.
      while (levels.length < 7) {
        var top = levels[levels.length - 1];
        if (top.w < 48 || top.h < 48) break;
        levels.push(downsample(top));
      }
      levels.forEach(function (lv) { buildSources(lv); buildTargets(lv); });
      while (levels.length > 1 && levels[levels.length - 1].sources.length < 16) levels.pop();
      if (!levels[0].sources.length) throw new Error('Not enough of the photo around the selection to rebuild it from.');

      var totalWork = 0, done = 0;
      levels.forEach(function (lv, i) { lv.iters = i === levels.length - 1 ? 6 : i === 0 ? 2 : 4; totalWork += lv.iters * lv.targets.length; });

      for (var li = levels.length - 1; li >= 0; li--) {
        var lv = levels[li];
        lv.nnf = new Int32Array(lv.w * lv.h).fill(-1);
        lv.dist = new Float64Array(lv.w * lv.h);
        var coarser = levels[li + 1];
        for (var k = 0; k < lv.targets.length; k++) {
          var t = lv.targets[k], s = -1;
          if (coarser) { // inherit the coarse match, scaled up
            var x = t % lv.w, y = (t / lv.w) | 0;
            var cx = Math.min(coarser.w - 1, x >> 1), cy = Math.min(coarser.h - 1, y >> 1);
            var cs = coarser.nnf[cy * coarser.w + cx];
            if (cs >= 0) {
              var sx = Math.min(lv.w - 1, (cs % coarser.w) * 2 + (x & 1));
              var sy = Math.min(lv.h - 1, ((cs / coarser.w) | 0) * 2 + (y & 1));
              s = sy * lv.w + sx;
              if (!lv.valid[s]) s = -1;
            }
          }
          lv.nnf[t] = s >= 0 ? s : randomSource(lv);
        }
        if (coarser) vote(lv); else onionFill(lv);
        var radius = coarser ? Math.max(4, Math.max(lv.w, lv.h) >> 2) : Math.max(lv.w, lv.h);
        for (var it = 0; it < lv.iters; it++) {
          patchMatch(lv, coarser ? 2 : 3, radius);
          vote(lv);
          done += lv.targets.length;
          if (progress) progress(done / totalWork);
        }
      }

      var out = new Uint8ClampedArray(w * h * 4);
      for (var i = 0; i < out.length; i++) out[i] = base.img[i];
      for (var p = 0; p < w * h; p++) if (!holeMask[p]) { // keep untouched pixels exact
        for (var c = 0; c < 4; c++) out[p * 4 + c] = rgba[p * 4 + c];
      }
      return out;
    };
  }

  var workerUrl = null;
  function makeWorker() {
    if (!workerUrl) {
      var src = 'var inpaint = (' + factory.toString() + ')();\n' +
        'self.onmessage = function (e) {\n' +
        '  var d = e.data;\n' +
        '  try {\n' +
        '    var out = inpaint(d.rgba, d.hole, d.w, d.h, function (p) { self.postMessage({ progress: p }); });\n' +
        '    self.postMessage({ done: true, rgba: out }, [out.buffer]);\n' +
        '  } catch (err) { self.postMessage({ error: err.message }); }\n' +
        '};\n';
      workerUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    }
    return new Worker(workerUrl);
  }

  function runInPage(rgba, hole, w, h, onProgress) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () { // let the busy indicator paint first
        try { resolve(factory()(rgba, hole, w, h, onProgress)); } catch (e) { reject(e); }
      }, 30);
    });
  }

  function run(rgba, hole, w, h, onProgress) {
    var worker;
    try { worker = makeWorker(); } catch (e) { return runInPage(rgba, hole, w, h, onProgress); }
    return new Promise(function (resolve, reject) {
      var started = false;
      worker.onmessage = function (e) {
        started = true;
        if (e.data.progress !== undefined) { if (onProgress) onProgress(e.data.progress); return; }
        worker.terminate();
        if (e.data.error) reject(new Error(e.data.error));
        else resolve(e.data.rgba);
      };
      worker.onerror = function (e) {
        e.preventDefault();
        worker.terminate();
        // Some browsers block workers on pages opened from disk; fall back to the page itself.
        if (!started) runInPage(rgba, hole, w, h, onProgress).then(resolve, reject);
        else reject(new Error(e.message || 'Worker failed'));
      };
      worker.postMessage({ rgba: rgba, hole: hole, w: w, h: h });
    });
  }

  global.Inpaint = { run: run, core: factory };
})(window);
