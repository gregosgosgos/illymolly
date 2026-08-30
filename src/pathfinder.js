/* =========================================================================
   pathfinder.js — 폴리곤 불리언 연산 (패스파인더)
   -------------------------------------------------------------------------
   입력/출력 단위는 "링(ring)" = {x,y} 배열 (닫힌 폴리곤).
   곡선은 미리 평탄화(flatten)해서 넣는다.
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util;
  var PF = AI.pathfinder = {};

  var EPS = 1e-7;
  var SNAP = 1e6; /* 좌표 스냅 해상도 */

  function key(p) { return Math.round(p.x * SNAP) + ',' + Math.round(p.y * SNAP); }
  function same(a, b) { return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6; }

  /* ---------- 링 유틸 ---------- */
  function area(ring) {
    var a = 0, n = ring.length;
    for (var i = 0; i < n; i++) { var p = ring[i], q = ring[(i + 1) % n]; a += p.x * q.y - q.x * p.y; }
    return a / 2;
  }
  PF.area = area;

  function ringBounds(ring) {
    var r = AI.rect.empty();
    for (var i = 0; i < ring.length; i++) AI.rect.add(r, ring[i].x, ring[i].y);
    return r;
  }

  function pointInRing(ring, x, y) {
    var inside = false, n = ring.length;
    for (var i = 0, j = n - 1; i < n; j = i++) {
      var a = ring[i], b = ring[j];
      if (((a.y > y) !== (b.y > y)) && (x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x)) inside = !inside;
    }
    return inside;
  }

  /* 링 집합에 대한 nonzero 판정 */
  function pointInRings(rings, x, y) {
    var w = 0;
    for (var r = 0; r < rings.length; r++) {
      var ring = rings[r], n = ring.length;
      for (var i = 0; i < n; i++) {
        var a = ring[i], b = ring[(i + 1) % n];
        if (a.y <= y) {
          if (b.y > y && ((b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y)) > 0) w++;
        } else if (b.y <= y && ((b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y)) < 0) w--;
      }
    }
    return w !== 0;
  }
  PF.pointInRings = pointInRings;

  function distToSeg(px, py, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    if (l2 < EPS) return U.dist(px, py, a.x, a.y);
    var t = U.clamp(((px - a.x) * dx + (py - a.y) * dy) / l2, 0, 1);
    return U.dist(px, py, a.x + dx * t, a.y + dy * t);
  }
  function nearRings(rings, x, y, eps) {
    for (var r = 0; r < rings.length; r++) {
      var ring = rings[r], n = ring.length;
      for (var i = 0; i < n; i++) if (distToSeg(x, y, ring[i], ring[(i + 1) % n]) < eps) return true;
    }
    return false;
  }

  /* ---------- 선분 교차 ---------- */
  function segInter(a, b, c, d) {
    var r1 = b.x - a.x, r2 = b.y - a.y, s1 = d.x - c.x, s2 = d.y - c.y;
    var den = r1 * s2 - r2 * s1;
    var qpx = c.x - a.x, qpy = c.y - a.y;
    if (Math.abs(den) < 1e-12) return null;      /* 평행 (겹침은 무시) */
    var t = (qpx * s2 - qpy * s1) / den;
    var u = (qpx * r2 - qpy * r1) / den;
    if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
    return { t: U.clamp(t, 0, 1), u: U.clamp(u, 0, 1), x: a.x + r1 * t, y: a.y + r2 * t };
  }

  /* 링 집합의 모든 변을 다른 집합과의 교차점에서 분할 -> 에지 배열 */
  function splitEdges(ringsA, ringsB) {
    var edges = [];
    for (var r = 0; r < ringsA.length; r++) {
      var ring = ringsA[r], n = ring.length;
      for (var i = 0; i < n; i++) {
        var a = ring[i], b = ring[(i + 1) % n];
        var ts = [0, 1];
        for (var q = 0; q < ringsB.length; q++) {
          var rb = ringsB[q], m = rb.length;
          for (var j = 0; j < m; j++) {
            var it = segInter(a, b, rb[j], rb[(j + 1) % m]);
            if (it) ts.push(it.t);
          }
        }
        ts.sort(function (x, y) { return x - y; });
        for (var k = 0; k < ts.length - 1; k++) {
          var t0 = ts[k], t1 = ts[k + 1];
          if (t1 - t0 < 1e-9) continue;
          edges.push({
            a: { x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 },
            b: { x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 }
          });
        }
      }
    }
    return edges;
  }

  /* 에지들을 무향으로 이어 붙여 닫힌 링으로 */
  function chain(edges) {
    var map = Object.create(null), i;
    function add(k, idx) { (map[k] || (map[k] = [])).push(idx); }
    for (i = 0; i < edges.length; i++) {
      if (same(edges[i].a, edges[i].b)) { edges[i].used = true; continue; }
      add(key(edges[i].a), i); add(key(edges[i].b), i);
    }
    var rings = [];
    for (i = 0; i < edges.length; i++) {
      if (edges[i].used) continue;
      var ring = [], cur = edges[i], from = cur.a, to = cur.b, startKey = key(cur.a), guard = 0;
      cur.used = true; ring.push({ x: from.x, y: from.y });
      while (guard++ < 200000) {
        ring.push({ x: to.x, y: to.y });
        if (key(to) === startKey) break;
        var cand = map[key(to)] || [], next = -1, bestDot = -2;
        var dx = to.x - from.x, dy = to.y - from.y, dl = Math.hypot(dx, dy) || 1;
        for (var c = 0; c < cand.length; c++) {
          var e = edges[cand[c]];
          if (e.used) continue;
          var far = same(e.a, to) ? e.b : e.a;
          var ex = far.x - to.x, ey = far.y - to.y, el = Math.hypot(ex, ey) || 1;
          var dot = (dx * ex + dy * ey) / (dl * el);
          if (dot > bestDot) { bestDot = dot; next = cand[c]; }
        }
        if (next < 0) break;
        var ne = edges[next]; ne.used = true;
        from = to;
        to = same(ne.a, from) ? ne.b : ne.a;
      }
      if (ring.length > 3) {
        if (same(ring[0], ring[ring.length - 1])) ring.pop();
        if (ring.length > 2 && Math.abs(area(ring)) > 1e-6) rings.push(ring);
      }
    }
    return rings;
  }

  /* 중첩 깊이에 따라 방향 정규화 (짝수=외곽 CCW, 홀수=구멍 CW) */
  function normalize(rings) {
    var info = rings.map(function (r) { return { ring: r, bb: ringBounds(r), depth: 0 }; });
    for (var i = 0; i < info.length; i++) {
      for (var j = 0; j < info.length; j++) {
        if (i === j) continue;
        if (!AI.rect.contains(info[j].bb, info[i].bb)) continue;
        var p = info[i].ring[0];
        if (pointInRing(info[j].ring, p.x, p.y)) info[i].depth++;
      }
    }
    return info.map(function (o) {
      var a = area(o.ring);
      var wantPositive = (o.depth % 2 === 0);
      if ((a > 0) !== wantPositive) o.ring = o.ring.slice().reverse();
      return o.ring;
    });
  }
  PF.normalize = normalize;

  /* ---------- 핵심 불리언 ---------- */
  /* op: 'unite' | 'intersect' | 'minus' | 'exclude'  (A op B) */
  PF.boolean = function (A, B, op) {
    if (!A.length) return op === 'unite' || op === 'exclude' ? normalize(B.slice()) : [];
    if (!B.length) return op === 'intersect' ? [] : normalize(A.slice());

    var ea = splitEdges(A, B), eb = splitEdges(B, A);
    var keep = [], i, e, mx, my, eps = 1e-5;

    function classify(list, other, self) {
      var out = [];
      for (i = 0; i < list.length; i++) {
        e = list[i];
        mx = (e.a.x + e.b.x) / 2; my = (e.a.y + e.b.y) / 2;
        if (nearRings(other, mx, my, eps)) { e.on = true; }
        e.inside = pointInRings(other, mx, my);
        out.push(e);
      }
      return out;
    }
    classify(ea, B); classify(eb, A);

    function push(list, wantInside, allowOn) {
      for (i = 0; i < list.length; i++) {
        e = list[i];
        if (e.on) { if (allowOn) keep.push({ a: e.a, b: e.b }); continue; }
        if (wantInside === null || e.inside === wantInside) keep.push({ a: e.a, b: e.b });
      }
    }

    if (op === 'unite') { push(ea, false, true); push(eb, false, false); }
    else if (op === 'intersect') { push(ea, true, true); push(eb, true, false); }
    else if (op === 'minus') { push(ea, false, false); push(eb, true, false); }
    else { push(ea, null, false); push(eb, null, false); } /* exclude */

    return normalize(chain(keep));
  };

  PF.uniteAll = function (list) {
    if (!list.length) return [];
    var acc = list[0];
    for (var i = 1; i < list.length; i++) acc = PF.boolean(acc, list[i], 'unite');
    return acc;
  };

  /* ---------- 평면 분할 (Divide / Trim / Crop / Merge) ---------- */
  /* 모든 링을 하나의 평면 그래프로 만들고 면(face)들을 추출 */
  PF.faces = function (ringSets) {
    var all = [];
    ringSets.forEach(function (rs) { rs.forEach(function (r) { all.push(r); }); });
    if (!all.length) return [];

    /* 모든 변을 모든 변과의 교차점에서 분할 */
    var raw = [];
    all.forEach(function (ring, ri) {
      var n = ring.length;
      for (var i = 0; i < n; i++) raw.push({ a: ring[i], b: ring[(i + 1) % n], ri: ri });
    });
    var segs = [];
    for (var i = 0; i < raw.length; i++) {
      var a = raw[i].a, b = raw[i].b, ts = [0, 1];
      for (var j = 0; j < raw.length; j++) {
        if (i === j) continue;
        var it = segInter(a, b, raw[j].a, raw[j].b);
        if (it) ts.push(it.t);
      }
      ts.sort(function (x, y) { return x - y; });
      for (var k = 0; k < ts.length - 1; k++) {
        if (ts[k + 1] - ts[k] < 1e-9) continue;
        segs.push({
          a: { x: a.x + (b.x - a.x) * ts[k], y: a.y + (b.y - a.y) * ts[k] },
          b: { x: a.x + (b.x - a.x) * ts[k + 1], y: a.y + (b.y - a.y) * ts[k + 1] }
        });
      }
    }
    /* 중복 제거 */
    var seen = Object.create(null), half = [];
    segs.forEach(function (s) {
      var k1 = key(s.a) + '|' + key(s.b), k2 = key(s.b) + '|' + key(s.a);
      if (seen[k1] || seen[k2]) return;
      seen[k1] = 1;
      half.push({ a: s.a, b: s.b, used: false });
      half.push({ a: s.b, b: s.a, used: false });
    });

    var vmap = Object.create(null);
    half.forEach(function (h, idx) { (vmap[key(h.a)] || (vmap[key(h.a)] = [])).push(idx); });

    var faces = [];
    for (var h = 0; h < half.length; h++) {
      if (half[h].used) continue;
      var ring = [], cur = h, guard = 0;
      while (guard++ < 100000) {
        var e = half[cur];
        if (e.used) break;
        e.used = true;
        ring.push({ x: e.a.x, y: e.a.y });
        var outs = vmap[key(e.b)] || [];
        var inAng = Math.atan2(e.a.y - e.b.y, e.a.x - e.b.x); /* 들어온 방향의 역 */
        var best = -1, bestAng = Infinity;
        for (var o = 0; o < outs.length; o++) {
          var f = half[outs[o]];
          if (f.used) continue;
          var ang = Math.atan2(f.b.y - f.a.y, f.b.x - f.a.x) - inAng;
          while (ang <= 0) ang += Math.PI * 2;
          while (ang > Math.PI * 2) ang -= Math.PI * 2;
          if (ang < bestAng) { bestAng = ang; best = outs[o]; }
        }
        if (best < 0) break;
        cur = best;
        if (cur === h) break;
      }
      if (ring.length > 2 && Math.abs(area(ring)) > 1e-4) faces.push(ring);
    }
    /* 가장 바깥 면(전체를 감싸는 면) 제거 : 면적 부호가 반대이면서 최대 */
    var maxA = 0, outer = -1;
    faces.forEach(function (f, i) { var a = area(f); if (a < maxA) { maxA = a; outer = i; } });
    if (outer >= 0) faces.splice(outer, 1);
    return faces;
  };

  /* 링들의 대표점 (내부의 한 점) */
  PF.repPoint = function (ring) {
    var bb = ringBounds(ring);
    var cy = (bb.y + bb.y2) / 2;
    /* 스캔라인 교차 중간점 */
    var xs = [], n = ring.length;
    for (var i = 0; i < n; i++) {
      var a = ring[i], b = ring[(i + 1) % n];
      if ((a.y > cy) !== (b.y > cy)) xs.push(a.x + (b.x - a.x) * (cy - a.y) / (b.y - a.y));
    }
    xs.sort(function (p, q) { return p - q; });
    if (xs.length >= 2) return { x: (xs[0] + xs[1]) / 2, y: cy };
    var c = { x: 0, y: 0 };
    ring.forEach(function (p) { c.x += p.x; c.y += p.y; });
    return { x: c.x / n, y: c.y / n };
  };

})(window.AI);
