/* =========================================================================
   distort.js — 왜곡 및 변형 (벡터 효과)
   -------------------------------------------------------------------------
   일러스트레이터의 [효과 > 왜곡 및 변형] 에 대응한다. 흐림·그림자와 달리
   래스터가 아니라 **기하 자체**를 바꾸는 효과라, 원본 패스를 건드리지 않고
   그리는 시점에만 변형된 서브패스를 만들어 낸다 (비파괴).

     it.effects = [ { type:'zigzag', size:10, ridges:4, smooth:false }, … ]

   결과는 (서브패스 + 추가 변환) 목록이다. '변형' 효과는 사본을 만들 수 있어
   한 아이템이 여러 벌의 기하를 갖게 되므로 목록 형태가 필요하다.

     DT.result(it) -> [ { subs:[…], m:[a,b,c,d,e,f] }, … ]

   같은 입력에 대해 항상 같은 결과가 나오도록 난수는 시드 기반이다
   (프레임마다 모양이 떨리면 안 된다).
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, M = AI.mat, R = AI.rect, G = AI.geom;
  var DT = AI.distort = {};

  /* ---------------- 정의 ---------------- */
  DT.DEFS = {
    zigzag: {
      name: '지그재그', menu: '왜곡 및 변형', geo: true,
      make: function () { return { type: 'zigzag', size: 10, ridges: 4, smooth: false }; },
      label: function (e) {
        return '지그재그 ' + U.fmt(e.size) + 'pt · ' + e.ridges + '개' + (e.smooth ? ' (매끄럽게)' : '');
      }
    },
    roughen: {
      name: '거칠게 하기', menu: '왜곡 및 변형', geo: true,
      make: function () { return { type: 'roughen', size: 5, detail: 10, smooth: true }; },
      label: function (e) { return '거칠게 ' + U.fmt(e.size) + 'pt · 세부 ' + U.fmt(e.detail); }
    },
    puckerBloat: {
      name: '오목· 볼록', menu: '왜곡 및 변형', geo: true,
      make: function () { return { type: 'puckerBloat', amount: 30 }; },
      label: function (e) {
        return (e.amount >= 0 ? '볼록 ' : '오목 ') + U.fmt(Math.abs(e.amount)) + '%';
      }
    },
    twist: {
      name: '비틀기', menu: '왜곡 및 변형', geo: true,
      make: function () { return { type: 'twist', angle: 45 }; },
      label: function (e) { return '비틀기 ' + U.fmt(e.angle) + '°'; }
    },
    transformFx: {
      name: '변형', menu: '왜곡 및 변형', geo: true,
      make: function () {
        return {
          type: 'transformFx', scaleX: 100, scaleY: 100, moveX: 0, moveY: 0,
          angle: 0, copies: 0, anchor: 4, reflectX: false, reflectY: false
        };
      },
      label: function (e) {
        var p = [];
        if (e.scaleX !== 100 || e.scaleY !== 100) p.push(U.fmt(e.scaleX) + '×' + U.fmt(e.scaleY) + '%');
        if (e.angle) p.push(U.fmt(e.angle) + '°');
        if (e.moveX || e.moveY) p.push('이동 ' + U.fmt(e.moveX) + ',' + U.fmt(e.moveY));
        if (e.copies) p.push('사본 ' + e.copies);
        return '변형' + (p.length ? ' ' + p.join(' · ') : '');
      }
    },
    freeDistort: {
      name: '자유 왜곡', menu: '왜곡 및 변형', geo: true,
      make: function () {
        /* 네 모퉁이의 이동량 (바운딩 박스 기준 %) */
        return { type: 'freeDistort', tl: [0, 0], tr: [0, 0], br: [0, 0], bl: [0, 0] };
      },
      label: function (e) {
        var m = Math.max.apply(null, [e.tl, e.tr, e.br, e.bl].map(function (c) {
          return Math.max(Math.abs(c[0]), Math.abs(c[1]));
        }));
        return '자유 왜곡 ' + U.fmt(m) + '%';
      }
    }
  };

  DT.isGeo = function (type) { return !!(DT.DEFS[type] && DT.DEFS[type].geo); };

  /* 이 아이템에 기하 효과가 걸려 있는가 */
  DT.has = function (it) {
    if (!it || it.type !== 'path' || !it.effects) return false;
    for (var i = 0; i < it.effects.length; i++) if (DT.isGeo(it.effects[i].type)) return true;
    return false;
  };

  /* ---------------- 시드 난수 ----------------
     같은 인덱스에는 항상 같은 값이 나와야 화면이 떨리지 않는다. */
  function rand(seed) {
    var x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
    return x - Math.floor(x);          /* 0..1 */
  }
  function rand2(seed) { return rand(seed) * 2 - 1; }   /* -1..1 */

  /* ---------------- 개별 효과 ---------------- */

  /* 지그재그: 각 세그먼트를 ridges 조각으로 나누고 법선 방향으로 번갈아 민다 */
  function zigzag(subs, e, bounds) {
    var size = e.size || 0;
    var ridges = Math.max(1, Math.round(e.ridges || 1));
    if (!size) return subs;
    return subs.map(function (sub) {
      var segs = G.segments(sub);
      if (!segs.length) return sub;
      var out = [], flip = 1, idx = 0;
      segs.forEach(function (g) {
        var steps = ridges + 1;
        for (var k = 0; k < steps; k++) {
          var t = k / steps;
          var p = g.line ? lerp(g.a, g.b, t) : G.cubic(g.a, g.c1, g.c2, g.b, t);
          var d = g.line ? sub2(g.b, g.a) : G.cubicD(g.a, g.c1, g.c2, g.b, t);
          var n = normal(d);
          /* 시작 앵커는 제자리, 사이의 마루/골만 민다 */
          var amt = (k === 0) ? 0 : size * flip;
          if (k > 0) flip = -flip;
          out.push(mk(p.x + n.x * amt, p.y + n.y * amt, e.smooth));
          idx++;
        }
      });
      if (!sub.closed) {
        var last = segs[segs.length - 1];
        out.push(mk(last.b.x, last.b.y, e.smooth));
      }
      return finish(sub, out, e.smooth);
    });
  }

  /* 거칠게 하기: 잘게 나눈 뒤 각 점을 시드 난수로 흔든다 */
  function roughen(subs, e, bounds) {
    var size = e.size || 0;
    if (!size) return subs;
    var diag = Math.hypot(R.w(bounds), R.h(bounds)) || 100;
    /* detail = 단위 길이당 점의 개수 (일러스트레이터의 '세부' 와 같은 감각) */
    var perUnit = Math.max(0.5, e.detail || 10) / 100;
    var seed = 1;
    return subs.map(function (sub, si) {
      var segs = G.segments(sub);
      if (!segs.length) return sub;
      var out = [];
      segs.forEach(function (g, gi) {
        var len = g.line ? dist(g.a, g.b) : approxLen(g);
        var steps = Math.max(1, Math.round(len * perUnit));
        for (var k = 0; k < steps; k++) {
          var t = k / steps;
          var p = g.line ? lerp(g.a, g.b, t) : G.cubic(g.a, g.c1, g.c2, g.b, t);
          seed++;
          out.push(mk(p.x + rand2(seed * 3.1 + si) * size,
            p.y + rand2(seed * 7.7 + si * 2) * size, e.smooth));
        }
      });
      if (!sub.closed) {
        var last = segs[segs.length - 1];
        seed++;
        out.push(mk(last.b.x + rand2(seed * 3.1 + si) * size,
          last.b.y + rand2(seed * 7.7 + si * 2) * size, e.smooth));
      }
      return finish(sub, out, e.smooth);
    });
  }

  /* 오목·볼록: 앵커는 두고 방향선만 중심에서 밀거나 당긴다.
     양수 = 볼록(바깥으로 부풀음), 음수 = 오목(앵커가 뾰족해짐). */
  function puckerBloat(subs, e, bounds) {
    var k = (e.amount || 0) / 100;
    if (!k) return subs;
    var cx = (bounds.x + bounds.x2) / 2, cy = (bounds.y + bounds.y2) / 2;
    return subs.map(function (sub) {
      var pts = sub.pts.map(function (p, pi) {
        var o = { x: p.x, y: p.y };
        /* 방향선이 없으면 직선 세그먼트용으로 만들어 준다 */
        var seg = neighborDirs(sub, pi);
        var h1 = (p.ix != null) ? { x: p.ix, y: p.iy } : seg.inH;
        var h2 = (p.ox != null) ? { x: p.ox, y: p.oy } : seg.outH;
        if (h1) {
          o.ix = h1.x + (h1.x - cx) * k;
          o.iy = h1.y + (h1.y - cy) * k;
        }
        if (h2) {
          o.ox = h2.x + (h2.x - cx) * k;
          o.oy = h2.y + (h2.y - cy) * k;
        }
        return o;
      });
      return { closed: sub.closed, pts: pts };
    });
  }

  /* 비틀기: 중심에서 먼 점일수록 많이 돌린다 */
  function twist(subs, e, bounds) {
    var maxA = U.rad(e.angle || 0);
    if (!maxA) return subs;
    var cx = (bounds.x + bounds.x2) / 2, cy = (bounds.y + bounds.y2) / 2;
    var maxR = Math.max(1e-6, Math.hypot(R.w(bounds), R.h(bounds)) / 2);
    function tw(x, y) {
      var dx = x - cx, dy = y - cy;
      var r = Math.hypot(dx, dy);
      var a = maxA * (r / maxR);
      var c = Math.cos(a), s = Math.sin(a);
      return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
    }
    return subs.map(function (sub) {
      return {
        closed: sub.closed,
        pts: sub.pts.map(function (p) {
          var q = tw(p.x, p.y), o = { x: q.x, y: q.y };
          if (p.ix != null) { var a = tw(p.ix, p.iy); o.ix = a.x; o.iy = a.y; }
          if (p.ox != null) { var b = tw(p.ox, p.oy); o.ox = b.x; o.oy = b.y; }
          return o;
        })
      };
    });
  }

  /* 자유 왜곡: 바운딩 박스를 네 모퉁이로 옮긴 사각형에 쌍선형 사상 */
  function freeDistort(subs, e, bounds) {
    var w = R.w(bounds) || 1, h = R.h(bounds) || 1;
    function corner(c) { return { x: (c[0] || 0) / 100 * w, y: (c[1] || 0) / 100 * h }; }
    var tl = corner(e.tl), tr = corner(e.tr), br = corner(e.br), bl = corner(e.bl);
    if (!tl.x && !tl.y && !tr.x && !tr.y && !br.x && !br.y && !bl.x && !bl.y) return subs;
    function map(x, y) {
      var u = (x - bounds.x) / w, v = (y - bounds.y) / h;
      var dx = (1 - u) * (1 - v) * tl.x + u * (1 - v) * tr.x + u * v * br.x + (1 - u) * v * bl.x;
      var dy = (1 - u) * (1 - v) * tl.y + u * (1 - v) * tr.y + u * v * br.y + (1 - u) * v * bl.y;
      return { x: x + dx, y: y + dy };
    }
    return subs.map(function (sub) {
      return {
        closed: sub.closed,
        pts: sub.pts.map(function (p) {
          var q = map(p.x, p.y), o = { x: q.x, y: q.y };
          if (p.ix != null) { var a = map(p.ix, p.iy); o.ix = a.x; o.iy = a.y; }
          if (p.ox != null) { var b = map(p.ox, p.oy); o.ox = b.x; o.oy = b.y; }
          return o;
        })
      };
    });
  }

  /* ---------------- 파이프라인 ---------------- */
  /* 결과: [{ subs, m }] — '변형' 효과의 사본 때문에 여러 벌이 나올 수 있다 */
  function compute(it) {
    var out = [{ subs: it.subs, m: M.ident() }];
    (it.effects || []).forEach(function (e) {
      if (!DT.isGeo(e.type)) return;
      if (e.type === 'transformFx') {
        out = applyTransform(out, e, it);
        return;
      }
      out = out.map(function (entry) {
        var b = G.pathBounds({ subs: entry.subs }, null);
        if (R.isEmpty(b)) return entry;
        var fn = e.type === 'zigzag' ? zigzag
          : e.type === 'roughen' ? roughen
            : e.type === 'puckerBloat' ? puckerBloat
              : e.type === 'twist' ? twist
                : e.type === 'freeDistort' ? freeDistort : null;
        if (!fn) return entry;
        return { subs: fn(entry.subs, e, b), m: entry.m };
      });
    });
    return out;
  }

  /* '변형' 효과 — 사본을 만들면 변환이 누적된다 */
  function applyTransform(entries, e, it) {
    var copies = U.clamp(Math.round(e.copies || 0), 0, 60);
    var out = [];
    entries.forEach(function (entry) {
      var b = G.pathBounds({ subs: entry.subs }, null);
      if (R.isEmpty(b)) { out.push(entry); return; }
      var ref = AI.edit.refPointOf(b, e.anchor == null ? 4 : e.anchor);
      var step = M.mulAll(
        M.translate(e.moveX || 0, e.moveY || 0),
        M.around(M.rotate(U.rad(-(e.angle || 0))), ref.x, ref.y),
        M.around(M.scale((e.scaleX == null ? 100 : e.scaleX) / 100 || 1e-6,
          (e.scaleY == null ? 100 : e.scaleY) / 100 || 1e-6), ref.x, ref.y)
      );
      if (e.reflectX) step = M.mul(step, M.around(M.scale(-1, 1), ref.x, ref.y));
      if (e.reflectY) step = M.mul(step, M.around(M.scale(1, -1), ref.x, ref.y));

      var acc = M.ident();
      for (var i = 0; i <= copies; i++) {
        out.push({ subs: entry.subs, m: M.mul(entry.m, acc) });
        acc = M.mul(acc, step);
      }
    });
    return out;
  }

  /* ---------------- 캐시 ----------------
     매 프레임 다시 계산하면 비싸다. 효과 설정과 패스 모양이 그대로면 재사용한다. */
  function signature(it) {
    var h = 0, n = 0;
    for (var s = 0; s < it.subs.length; s++) {
      var pts = it.subs[s].pts;
      n += pts.length;
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        h = (h * 31 + p.x * 7.1 + p.y * 3.3 + (p.ix || 0) * 1.7 + (p.oy || 0) * 0.9) % 1e9;
      }
      h = (h * 31 + (it.subs[s].closed ? 1 : 0)) % 1e9;
    }
    return n + ':' + U.round(h, 2) + '|' + JSON.stringify(it.effects.filter(function (e) {
      return DT.isGeo(e.type);
    }));
  }

  DT.result = function (it) {
    if (!DT.has(it)) return null;
    var key = signature(it);
    if (it.__geo && it.__geo.key === key) return it.__geo.out;
    var out = compute(it);
    /* 열거되지 않게 숨겨 두어 JSON 저장·deepCopy 에 섞이지 않도록 한다 */
    try {
      Object.defineProperty(it, '__geo', {
        value: { key: key, out: out }, writable: true, configurable: true, enumerable: false
      });
    } catch (err) { it.__geo = { key: key, out: out }; }
    return out;
  };

  /* 렌더·히트·내보내기가 그대로 재활용할 수 있는 대역 아이템.
     원본을 프로토타입으로 삼아 subs 만 갈아 끼우므로 칠·획·모양 스택이
     전부 상속된다. effects 를 비워 두어 재귀도 끊는다. */
  DT.proxies = function (it) {
    var res = DT.result(it);
    if (!res) return null;
    return res.map(function (e) {
      var px = Object.create(it);
      px.subs = e.subs;
      px.effects = null;
      px.fxm = e.m;
      return px;
    });
  };

  /* 이 아이템에 특정 기하 효과가 걸려 있는가 */
  DT.hasType = function (it, type) {
    if (!it || !it.effects) return false;
    for (var i = 0; i < it.effects.length; i++) if (it.effects[i].type === type) return true;
    return false;
  };

  /* 효과를 실제 패스로 굳힌다 (오브젝트 > 모양 확장) */
  DT.expand = function (it) {
    var res = DT.result(it);
    if (!res) return null;
    return res.map(function (entry) {
      return {
        subs: entry.subs.map(function (sub) { return U.deepCopy(sub); }),
        m: entry.m.slice()
      };
    });
  };

  /* ---------------- 잔손질 ---------------- */
  function mk(x, y, smooth) { return { x: x, y: y }; }
  function lerp(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
  function sub2(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
  function dist(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }
  function normal(d) {
    var l = Math.hypot(d.x, d.y) || 1;
    return { x: -d.y / l, y: d.x / l };
  }
  function approxLen(g) {
    var l = 0, prev = g.a;
    for (var k = 1; k <= 8; k++) {
      var p = G.cubic(g.a, g.c1, g.c2, g.b, k / 8);
      l += dist(prev, p);
      prev = p;
    }
    return l;
  }
  /* 방향선이 없는 앵커에 이웃 방향으로 임시 핸들을 만든다 (오목·볼록용) */
  function neighborDirs(sub, i) {
    var n = sub.pts.length, p = sub.pts[i];
    if (i < 0 || n < 2) return { inH: null, outH: null };
    var prev = sub.pts[(i - 1 + n) % n], next = sub.pts[(i + 1) % n];
    if (!sub.closed && i === 0) prev = null;
    if (!sub.closed && i === n - 1) next = null;
    return {
      inH: prev ? lerp(p, prev, 1 / 3) : null,
      outH: next ? lerp(p, next, 1 / 3) : null
    };
  }
  /* 점 목록을 서브패스로 — 매끄럽게 옵션이면 곡선으로 맞춘다 */
  function finish(sub, pts, smooth) {
    if (smooth && pts.length > 2) {
      return { closed: sub.closed, pts: G.fitCurve(pts, 0.4) };
    }
    return { closed: sub.closed, pts: pts };
  }
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
