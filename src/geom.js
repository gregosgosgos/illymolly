/* =========================================================================
   geom.js — 베지어 / 패스 기하 연산
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, M = AI.mat, R = AI.rect;
  var G = AI.geom = {};

  /* 세그먼트: p0 -> p1 의 제어점 */
  G.c1 = function (p) { return (p.ox != null) ? { x: p.ox, y: p.oy } : { x: p.x, y: p.y }; };
  G.c2 = function (p) { return (p.ix != null) ? { x: p.ix, y: p.iy } : { x: p.x, y: p.y }; };
  G.isLine = function (a, b) { return a.ox == null && b.ix == null; };

  /* 서브패스의 세그먼트 배열 [{a,b,c1,c2,line}] */
  G.segments = function (sub) {
    var out = [], n = sub.pts.length, i, a, b;
    if (n < 2) return out;
    for (i = 0; i < n - 1; i++) {
      a = sub.pts[i]; b = sub.pts[i + 1];
      out.push({ a: a, b: b, c1: G.c1(a), c2: G.c2(b), line: G.isLine(a, b), i: i, j: i + 1 });
    }
    if (sub.closed) {
      a = sub.pts[n - 1]; b = sub.pts[0];
      out.push({ a: a, b: b, c1: G.c1(a), c2: G.c2(b), line: G.isLine(a, b), i: n - 1, j: 0 });
    }
    return out;
  };

  G.cubic = function (p0, p1, p2, p3, t) {
    var mt = 1 - t, a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
    return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
  };
  G.cubicD = function (p0, p1, p2, p3, t) {
    var mt = 1 - t;
    return {
      x: 3 * mt * mt * (p1.x - p0.x) + 6 * mt * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
      y: 3 * mt * mt * (p1.y - p0.y) + 6 * mt * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y)
    };
  };
  /* de Casteljau 분할 */
  G.splitCubic = function (p0, p1, p2, p3, t) {
    function L(a, b) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
    var a = L(p0, p1), b = L(p1, p2), c = L(p2, p3);
    var d = L(a, b), e = L(b, c), f = L(d, e);
    return { left: [p0, a, d, f], right: [f, e, c, p3], pt: f };
  };

  /* 3차 베지어의 축별 극값 t */
  function extremaT(a, b, c, d) {
    var ts = [], A = -a + 3 * b - 3 * c + d, B = 2 * (a - 2 * b + c), C = b - a;
    if (Math.abs(A) < 1e-9) {
      if (Math.abs(B) > 1e-9) ts.push(-C / B);
    } else {
      var disc = B * B - 4 * A * C;
      if (disc >= 0) {
        var s = Math.sqrt(disc);
        ts.push((-B + s) / (2 * A), (-B - s) / (2 * A));
      }
    }
    return ts.filter(function (t) { return t > 0 && t < 1; });
  }

  G.cubicBounds = function (p0, p1, p2, p3, r) {
    r = r || R.empty();
    R.add(r, p0.x, p0.y); R.add(r, p3.x, p3.y);
    var tx = extremaT(p0.x, p1.x, p2.x, p3.x), ty = extremaT(p0.y, p1.y, p2.y, p3.y), i, p;
    for (i = 0; i < tx.length; i++) { p = G.cubic(p0, p1, p2, p3, tx[i]); R.add(r, p.x, p.y); }
    for (i = 0; i < ty.length; i++) { p = G.cubic(p0, p1, p2, p3, ty[i]); R.add(r, p.x, p.y); }
    return r;
  };

  /* 아이템 로컬 좌표계 기준 패스 바운딩 (기하 바운딩) */
  G.pathBounds = function (it, mtx) {
    var r = R.empty();
    if (!it.subs) return r;
    function T(p) { return mtx ? M.apply(mtx, p.x, p.y) : p; }
    for (var s = 0; s < it.subs.length; s++) {
      var sub = it.subs[s], segs = G.segments(sub);
      if (sub.pts.length === 1) { var q = T(sub.pts[0]); R.add(r, q.x, q.y); }
      for (var i = 0; i < segs.length; i++) {
        var g = segs[i];
        var a = T(g.a), b = T(g.b), c1 = T(g.c1), c2 = T(g.c2);
        if (g.line) { R.add(r, a.x, a.y); R.add(r, b.x, b.y); }
        else G.cubicBounds(a, c1, c2, b, r);
      }
    }
    return r;
  };

  /* 서브패스를 폴리라인으로 평탄화 */
  G.flattenSub = function (sub, tol, mtx) {
    tol = tol || 0.25;
    var out = [], segs = G.segments(sub);
    function T(p) { return mtx ? M.apply(mtx, p.x, p.y) : { x: p.x, y: p.y }; }
    if (!sub.pts.length) return out;
    out.push(T(sub.pts[0]));
    for (var i = 0; i < segs.length; i++) {
      var g = segs[i], a = T(g.a), b = T(g.b);
      if (g.line) { out.push(b); continue; }
      var c1 = T(g.c1), c2 = T(g.c2);
      var d = U.dist(a.x, a.y, c1.x, c1.y) + U.dist(c1.x, c1.y, c2.x, c2.y) + U.dist(c2.x, c2.y, b.x, b.y);
      var n = U.clamp(Math.ceil(d / Math.max(tol * 4, 0.5)), 2, 160);
      for (var k = 1; k <= n; k++) out.push(G.cubic(a, c1, c2, b, k / n));
    }
    if (sub.closed && out.length > 1) {
      var f = out[0], l = out[out.length - 1];
      if (Math.abs(f.x - l.x) < 1e-9 && Math.abs(f.y - l.y) < 1e-9) out.pop();
    }
    return out;
  };

  G.flattenItem = function (it, tol, mtx) {
    var polys = [];
    if (!it.subs) return polys;
    for (var i = 0; i < it.subs.length; i++) {
      var p = G.flattenSub(it.subs[i], tol, mtx);
      if (p.length > 1) polys.push({ pts: p, closed: !!it.subs[i].closed });
    }
    return polys;
  };

  /* Canvas2D 경로 생성 */
  G.tracePath = function (ctx, it, mtx) {
    if (!it.subs) return;
    function T(x, y) { return mtx ? M.apply(mtx, x, y) : { x: x, y: y }; }
    for (var s = 0; s < it.subs.length; s++) {
      var sub = it.subs[s], pts = sub.pts;
      if (pts.length < 1) continue;
      var p0 = T(pts[0].x, pts[0].y);
      ctx.moveTo(p0.x, p0.y);
      var segs = G.segments(sub);
      for (var i = 0; i < segs.length; i++) {
        var g = segs[i], b = T(g.b.x, g.b.y);
        if (g.line) ctx.lineTo(b.x, b.y);
        else {
          var c1 = T(g.c1.x, g.c1.y), c2 = T(g.c2.x, g.c2.y);
          ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y);
        }
      }
      if (sub.closed) ctx.closePath();
    }
  };

  /* SVG d 문자열 */
  G.toSvgD = function (it, mtx) {
    var d = [], f = function (v) { return U.round(v, 3); };
    function T(x, y) { return mtx ? M.apply(mtx, x, y) : { x: x, y: y }; }
    if (!it.subs) return '';
    for (var s = 0; s < it.subs.length; s++) {
      var sub = it.subs[s], pts = sub.pts;
      if (!pts.length) continue;
      var p0 = T(pts[0].x, pts[0].y);
      d.push('M' + f(p0.x) + ' ' + f(p0.y));
      var segs = G.segments(sub);
      for (var i = 0; i < segs.length; i++) {
        var g = segs[i], b = T(g.b.x, g.b.y);
        if (g.line) d.push('L' + f(b.x) + ' ' + f(b.y));
        else {
          var c1 = T(g.c1.x, g.c1.y), c2 = T(g.c2.x, g.c2.y);
          d.push('C' + f(c1.x) + ' ' + f(c1.y) + ' ' + f(c2.x) + ' ' + f(c2.y) + ' ' + f(b.x) + ' ' + f(b.y));
        }
      }
      if (sub.closed) d.push('Z');
    }
    return d.join(' ');
  };

  /* 점에서 가장 가까운 패스 위치 (로컬 좌표) */
  G.nearestOnPath = function (it, x, y, maxDist) {
    var best = null;
    for (var s = 0; s < it.subs.length; s++) {
      var segs = G.segments(it.subs[s]);
      for (var i = 0; i < segs.length; i++) {
        var g = segs[i], N = g.line ? 1 : 24, prev = null;
        for (var k = 0; k <= N; k++) {
          var t = k / N;
          var p = g.line
            ? { x: U.lerp(g.a.x, g.b.x, t), y: U.lerp(g.a.y, g.b.y, t) }
            : G.cubic(g.a, g.c1, g.c2, g.b, t);
          var d = U.dist(p.x, p.y, x, y);
          if (!best || d < best.d) best = { d: d, sub: s, seg: i, t: t, x: p.x, y: p.y };
          prev = p;
        }
      }
    }
    if (best && maxDist != null && best.d > maxDist) return null;
    return best;
  };

  /* 점 in 폴리곤 (nonzero) */
  G.pointInPolys = function (polys, x, y) {
    var w = 0;
    for (var p = 0; p < polys.length; p++) {
      var pts = polys[p].pts, n = pts.length;
      for (var i = 0; i < n; i++) {
        var a = pts[i], b = pts[(i + 1) % n];
        if (a.y <= y) {
          if (b.y > y && ((b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y)) > 0) w++;
        } else if (b.y <= y && ((b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y)) < 0) w--;
      }
    }
    return w !== 0;
  };

  /* 서브패스에 앵커 삽입 (t 위치에서 분할) */
  G.insertAnchor = function (sub, segIndex, t) {
    var segs = G.segments(sub), g = segs[segIndex];
    if (!g) return null;
    var a = g.a, b = g.b;
    var p0 = { x: a.x, y: a.y }, p1 = { x: g.c1.x, y: g.c1.y }, p2 = { x: g.c2.x, y: g.c2.y }, p3 = { x: b.x, y: b.y };
    var sp = G.splitCubic(p0, p1, p2, p3, t);
    var L = sp.left, Rt = sp.right;
    a.ox = L[1].x; a.oy = L[1].y;
    b.ix = Rt[2].x; b.iy = Rt[2].y;
    var np = { x: sp.pt.x, y: sp.pt.y, ix: L[2].x, iy: L[2].y, ox: Rt[1].x, oy: Rt[1].y };
    if (g.line) { delete a.ox; delete a.oy; delete b.ix; delete b.iy; delete np.ix; delete np.iy; delete np.ox; delete np.oy; }
    sub.pts.splice(g.i + 1, 0, np);
    return np;
  };

  /* 앵커 삭제 (부드럽게 이어붙이지 않고 단순 제거) */
  G.removeAnchor = function (sub, idx) {
    sub.pts.splice(idx, 1);
    if (sub.pts.length < 2) sub.closed = false;
  };

  /* 핸들 대칭 여부 판정 */
  G.isSmooth = function (p) {
    if (p.ix == null || p.ox == null) return false;
    var v1x = p.x - p.ix, v1y = p.y - p.iy, v2x = p.ox - p.x, v2y = p.oy - p.y;
    var l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
    if (l1 < 1e-6 || l2 < 1e-6) return false;
    var cross = (v1x * v2y - v1y * v2x) / (l1 * l2);
    return Math.abs(cross) < 0.03;
  };

  /* 서브패스 방향(면적) */
  G.subArea = function (poly) {
    var a = 0, n = poly.length;
    for (var i = 0; i < n; i++) { var p = poly[i], q = poly[(i + 1) % n]; a += p.x * q.y - q.x * p.y; }
    return a / 2;
  };

  /* 폴리라인을 패스 아이템의 subs 로 */
  G.polysToSubs = function (polys) {
    return polys.map(function (p) {
      return { closed: p.closed !== false, pts: p.pts.map(function (q) { return { x: q.x, y: q.y }; }) };
    });
  };

  /* --------- 자유곡선 스무딩 (연필/브러시) --------- */
  G.fitCurve = function (points, tol) {
    /* 단순화 후 Catmull-Rom -> 베지어 */
    var pts = G.simplify(points, tol == null ? 2 : tol);
    if (pts.length < 2) return pts.map(function (p) { return { x: p.x, y: p.y }; });
    var out = [], n = pts.length;
    for (var i = 0; i < n; i++) {
      var p = pts[i], prev = pts[i - 1] || pts[i], next = pts[i + 1] || pts[i];
      var tx = (next.x - prev.x) / 6, ty = (next.y - prev.y) / 6;
      var a = { x: p.x, y: p.y };
      if (i > 0) { a.ix = p.x - tx; a.iy = p.y - ty; }
      if (i < n - 1) { a.ox = p.x + tx; a.oy = p.y + ty; }
      out.push(a);
    }
    return out;
  };

  /* Ramer–Douglas–Peucker */
  G.simplify = function (pts, tol) {
    if (pts.length < 3) return pts.slice();
    var sq = tol * tol;
    function d2(p, a, b) {
      var x = a.x, y = a.y, dx = b.x - x, dy = b.y - y;
      if (dx || dy) {
        var t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
        if (t > 1) { x = b.x; y = b.y; } else if (t > 0) { x += dx * t; y += dy * t; }
      }
      dx = p.x - x; dy = p.y - y; return dx * dx + dy * dy;
    }
    function rec(first, last, out) {
      var max = sq, idx = -1;
      for (var i = first + 1; i < last; i++) {
        var d = d2(pts[i], pts[first], pts[last]);
        if (d > max) { max = d; idx = i; }
      }
      if (idx > -1) { rec(first, idx, out); out.push(pts[idx]); rec(idx, last, out); }
    }
    var out = [pts[0]];
    rec(0, pts.length - 1, out);
    out.push(pts[pts.length - 1]);
    return out;
  };

})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
