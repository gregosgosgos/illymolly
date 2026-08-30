/* =========================================================================
   util.js — 수학 / 행렬 / 공용 헬퍼
   ========================================================================= */
(function (root) { root.AI = root.AI || {}; })(typeof globalThis !== 'undefined' ? globalThis : this);
(function (AI) {
  'use strict';

  var U = AI.util = {};

  U.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  U.lerp = function (a, b, t) { return a + (b - a) * t; };
  U.dist = function (ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); };
  U.deg = function (r) { return r * 180 / Math.PI; };
  U.rad = function (d) { return d * Math.PI / 180; };
  U.sign = function (v) { return v < 0 ? -1 : 1; };

  /* ---- 식별자 ----
     기본은 결정적(순차) — 같은 스크립트를 돌리면 같은 id 가 나와야
     AI 에이전트가 결과를 재현하고 비교할 수 있다. */
  var _id = 0, _idMode = 'sequential';
  U.idMode = function (m) { if (m) _idMode = m; return _idMode; };
  U.resetIds = function (n) { _id = n || 0; };
  U.uid = function (p) {
    p = p || 'o';
    if (_idMode === 'random') return p + (++_id) + '_' + Math.random().toString(36).slice(2, 7);
    return p + '-' + (++_id);
  };
  /* 문서를 불러온 뒤 카운터를 기존 최대값 위로 올려 충돌을 막는다 */
  U.bumpIds = function (doc) {
    var max = 0;
    function scan(id) {
      var m = /-(\d+)$/.exec(String(id || ''));
      if (m) max = Math.max(max, +m[1]);
    }
    (doc.layers || []).forEach(function (l) {
      scan(l.id);
      (function rec(list) {
        (list || []).forEach(function (it) { scan(it.id); if (it.children) rec(it.children); });
      })(l.children);
    });
    (doc.artboards || []).forEach(function (a) { scan(a.id); });
    if (max > _id) _id = max;
  };

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

  /* ---------- 구조 공유 복사 ----------
     실행 취소 스냅샷은 문서 전체를 통째로 베껴 두는 방식이라, 점 하나만 옮겨도
     수천 개의 오브젝트가 새로 만들어졌다. 직전 스냅샷과 비교해 **바뀌지 않은
     가지는 그대로 다시 쓴다**. 저장된 스냅샷은 절대 수정되지 않으므로
     (되돌릴 때도 deepCopy 로 꺼낸다) 여러 스냅샷이 같은 가지를 나눠 가져도 안전하다.

       U.copyShare(현재, 직전스냅샷) -> 새 스냅샷 (바뀐 부분만 새 객체)
       U.copyShare.allocated  방금 새로 만든 노드 수 (메모리 예산 계산용)          */
  var _same = false, _alloc = 0;

  function cs(cur, old) {
    if (cur === null || typeof cur !== 'object') { _same = (cur === old); return cur; }

    if (Array.isArray(cur)) {
      var oldArr = Array.isArray(old) ? old : null;
      var allSame = !!oldArr && oldArr.length === cur.length;
      var out = new Array(cur.length);
      for (var i = 0; i < cur.length; i++) {
        out[i] = cs(cur[i], oldArr ? oldArr[i] : undefined);
        if (!_same) allSame = false;
      }
      if (allSame) { _same = true; return old; }
      _alloc++; _same = false; return out;
    }

    var oldObj = (old && typeof old === 'object' && !Array.isArray(old)) ? old : null;
    var o = {}, n = 0, allSame2 = !!oldObj;
    for (var k in cur) {
      if (!Object.prototype.hasOwnProperty.call(cur, k)) continue;
      n++;
      o[k] = cs(cur[k], oldObj ? oldObj[k] : undefined);
      if (!_same) allSame2 = false;
    }
    if (allSame2) {
      /* 키 개수까지 같아야 같은 것 (지워진 키를 놓치지 않는다) */
      var m = 0;
      for (var k2 in oldObj) if (Object.prototype.hasOwnProperty.call(oldObj, k2)) m++;
      if (m === n) { _same = true; return old; }
    }
    _alloc++; _same = false; return o;
  }

  U.copyShare = function (cur, old) {
    _same = false; _alloc = 0;
    var v = cs(cur, old);
    U.copyShare.allocated = _alloc;
    U.copyShare.unchanged = _same;
    return v;
  };
  U.copyShare.allocated = 0;

  /* 객체 트리의 노드 수 (메모리 사용량 어림) */
  U.nodeCount = function (o) {
    if (o === null || typeof o !== 'object') return 0;
    var n = 1;
    if (Array.isArray(o)) { for (var i = 0; i < o.length; i++) n += U.nodeCount(o[i]); return n; }
    for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) n += U.nodeCount(o[k]);
    return n;
  };

  U.hasDOM = (typeof document !== 'undefined' && !!document.createElement);
  U.isMac = (typeof navigator !== 'undefined') &&
    /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

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
  /* HTML 삽입용 이스케이프 — 사용자가 붙인 이름이 마크업이 되지 않게 한다 */
  U.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  U.el = function (tag, cls, html) {
    if (!U.hasDOM) return null;
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
    if (!U.hasDOM) { (AI.log || function () { })(msg); return; }
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 1600);
  };

})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
