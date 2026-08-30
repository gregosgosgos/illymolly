/* =========================================================================
   util.js — 수학 / 행렬 / 공용 헬퍼
   ========================================================================= */
window.AI = window.AI || {};
(function (AI) {
  'use strict';

  var U = AI.util = {};

  U.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  U.lerp = function (a, b, t) { return a + (b - a) * t; };
  U.dist = function (ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); };
  U.deg = function (r) { return r * 180 / Math.PI; };
  U.rad = function (d) { return d * Math.PI / 180; };
  U.sign = function (v) { return v < 0 ? -1 : 1; };

  var _id = 0;
  U.uid = function (p) { return (p || 'o') + (++_id) + '_' + Math.random().toString(36).slice(2, 7); };

  /* 소수점 정리 (부동소수 오차 제거) */
  U.round = function (v, n) {
    var p = Math.pow(10, n === undefined ? 3 : n);
    return Math.round(v * p) / p;
  };
  U.fmt = function (v) {
    if (!isFinite(v)) return '0';
    var r = U.round(v, 2);
    return String(r);
  };
  /* "12mm", "3 + 4", "50%" 같은 입력 파싱 */
  U.parseNum = function (s, fallback, pctBase) {
    if (typeof s === 'number') return s;
    if (s == null) return fallback;
    s = String(s).trim().replace(/,/g, '');
    if (!s) return fallback;
    if (/%$/.test(s) && pctBase != null) {
      var p = parseFloat(s);
      return isNaN(p) ? fallback : pctBase * p / 100;
    }
    s = s.replace(/(px|pt|mm|cm|in|deg|°)/gi, function (m) {
      m = m.toLowerCase();
      if (m === 'mm') return '*2.83465';
      if (m === 'cm') return '*28.3465';
      if (m === 'in') return '*72';
      return '';
    });
    if (!/^[-+*/(). 0-9]+$/.test(s)) { var f = parseFloat(s); return isNaN(f) ? fallback : f; }
    try {
      /* eslint-disable no-new-func */
      var v = Function('"use strict";return (' + s + ')')();
      return (typeof v === 'number' && isFinite(v)) ? v : fallback;
    } catch (e) { return fallback; }
  };

  /* ---------------------- 단위 (내부 기준은 pt) ---------------------- */
  U.UNITS = { pt: 1, px: 1, mm: 2.8346456693, cm: 28.346456693, in: 72 };
  U.unitFactor = function (u) { return U.UNITS[u] || 1; };
  U.toUnit = function (v, u) { return v / U.unitFactor(u); };
  U.fromUnit = function (v, u) { return v * U.unitFactor(u); };
  U.fmtUnit = function (v, u) { return U.fmt(U.toUnit(v, u)); };
  /* 사용자가 단위를 직접 적었으면 그 값을 쓰고, 아니면 문서 단위로 해석 */
  U.parseLen = function (s, fallbackPt, unit) {
    if (typeof s === 'number') return s;
    var str = String(s == null ? '' : s);
    var explicit = /(px|pt|mm|cm|in)\s*$/i.test(str);
    var v = U.parseNum(str, null);
    if (v == null || !isFinite(v)) return fallbackPt;
    return explicit ? v : U.fromUnit(v, unit);
  };

  U.deepCopy = function (o) {
    if (o === null || typeof o !== 'object') return o;
    if (Array.isArray(o)) { var a = new Array(o.length); for (var i = 0; i < o.length; i++) a[i] = U.deepCopy(o[i]); return a; }
    var r = {};
    for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = U.deepCopy(o[k]);
    return r;
  };

  U.isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  /* ---------------------- 2x3 행렬 ----------------------
     m = [a,b,c,d,e,f]  ->  x' = a*x + c*y + e ,  y' = b*x + d*y + f     */
  var M = AI.mat = {};

  M.ident = function () { return [1, 0, 0, 1, 0, 0]; };
  M.clone = function (m) { return m.slice(); };

  /* m1 을 적용한 뒤 m2 를 적용 == mul(m2, m1) */
  M.mul = function (m2, m1) {
    return [
      m2[0] * m1[0] + m2[2] * m1[1],
      m2[1] * m1[0] + m2[3] * m1[1],
      m2[0] * m1[2] + m2[2] * m1[3],
      m2[1] * m1[2] + m2[3] * m1[3],
      m2[0] * m1[4] + m2[2] * m1[5] + m2[4],
      m2[1] * m1[4] + m2[3] * m1[5] + m2[5]
    ];
  };
  M.mulAll = function () {
    var r = M.ident();
    for (var i = 0; i < arguments.length; i++) r = M.mul(r, arguments[i]);
    return r;
  };
  M.apply = function (m, x, y) {
    return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
  };
  M.applyV = function (m, x, y) { /* 벡터(평행이동 제외) */
    return { x: m[0] * x + m[2] * y, y: m[1] * x + m[3] * y };
  };
  M.invert = function (m) {
    var det = m[0] * m[3] - m[1] * m[2];
    if (Math.abs(det) < 1e-12) return M.ident();
    var id = 1 / det;
    return [
      m[3] * id, -m[1] * id, -m[2] * id, m[0] * id,
      (m[2] * m[5] - m[3] * m[4]) * id,
      (m[1] * m[4] - m[0] * m[5]) * id
    ];
  };
  M.translate = function (x, y) { return [1, 0, 0, 1, x, y]; };
  M.scale = function (sx, sy) { return [sx, 0, 0, sy === undefined ? sx : sy, 0, 0]; };
  M.rotate = function (a) { var c = Math.cos(a), s = Math.sin(a); return [c, s, -s, c, 0, 0]; };
  M.skew = function (ax, ay) { return [1, Math.tan(ay || 0), Math.tan(ax || 0), 1, 0, 0]; };
  M.around = function (m, cx, cy) { return M.mulAll(M.translate(cx, cy), m, M.translate(-cx, -cy)); };
  M.isIdent = function (m) {
    return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
  };
  /* 회전각(도) 추출 */
  M.angle = function (m) { return U.deg(Math.atan2(m[1], m[0])); };
  M.decompose = function (m) {
    var a = m[0], b = m[1], c = m[2], d = m[3];
    var sx = Math.hypot(a, b);
    var rot = Math.atan2(b, a);
    var sh = (a * c + b * d) / (sx * sx || 1);
    var sy = Math.hypot(c - sh * a, d - sh * b);
    return { x: m[4], y: m[5], sx: sx, sy: sy, rot: rot, shear: Math.atan(sh) };
  };
  M.toCSS = function (m) { return 'matrix(' + m.join(',') + ')'; };

  /* ---------------------- 사각형 ---------------------- */
  var R = AI.rect = {};
  R.empty = function () { return { x: Infinity, y: Infinity, x2: -Infinity, y2: -Infinity }; };
  R.isEmpty = function (r) { return !r || !(r.x2 >= r.x); };
  R.add = function (r, x, y) {
    if (x < r.x) r.x = x; if (y < r.y) r.y = y;
    if (x > r.x2) r.x2 = x; if (y > r.y2) r.y2 = y;
    return r;
  };
  R.union = function (r, o) {
    if (R.isEmpty(o)) return r;
    if (R.isEmpty(r)) return { x: o.x, y: o.y, x2: o.x2, y2: o.y2 };
    return { x: Math.min(r.x, o.x), y: Math.min(r.y, o.y), x2: Math.max(r.x2, o.x2), y2: Math.max(r.y2, o.y2) };
  };
  R.grow = function (r, d) { return { x: r.x - d, y: r.y - d, x2: r.x2 + d, y2: r.y2 + d }; };
  R.w = function (r) { return r.x2 - r.x; };
  R.h = function (r) { return r.y2 - r.y; };
  R.cx = function (r) { return (r.x + r.x2) / 2; };
  R.cy = function (r) { return (r.y + r.y2) / 2; };
  R.has = function (r, x, y) { return x >= r.x && x <= r.x2 && y >= r.y && y <= r.y2; };
  R.hit = function (a, b) { return !(a.x2 < b.x || b.x2 < a.x || a.y2 < b.y || b.y2 < a.y); };
  R.contains = function (a, b) { return a.x <= b.x && a.y <= b.y && a.x2 >= b.x2 && a.y2 >= b.y2; };
  R.fromPts = function (x1, y1, x2, y2) {
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), x2: Math.max(x1, x2), y2: Math.max(y1, y2) };
  };
  R.norm = function (r) { return { x: r.x, y: r.y, w: r.x2 - r.x, h: r.y2 - r.y }; };

  /* ---------------------- DOM ---------------------- */
  U.el = function (tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };
  U.on = function (el, ev, fn, opt) {
    ev.split(' ').forEach(function (e) { el.addEventListener(e, fn, opt); });
    return el;
  };
  U.q = function (s, root) { return (root || document).querySelector(s); };
  U.qa = function (s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); };

  var toastTimer = null;
  U.toast = function (msg) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 1600);
  };

})(window.AI);
