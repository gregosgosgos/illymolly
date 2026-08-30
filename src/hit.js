/* =========================================================================
   hit.js — 히트 테스트 + 선택 상태 관리
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, M = AI.mat, R = AI.rect, G = AI.geom, Model = AI.model, Rn = AI.render;
  var H = AI.hit = {};
  var hctx = U.hasDOM ? document.createElement('canvas').getContext('2d') : null;

  /* 캔버스가 없을 때: 평탄화한 폴리곤/폴리라인으로 직접 판정 */
  function geomTest(app, it, sx, sy, m) {
    var polys = G.flattenItem(it, 0.4, m);
    if (!polys.length) return false;
    var fillable = AI.appearance.hasFill(it) && !app.prefs.outline;
    if (fillable && polys.some(function (p) { return p.closed; })) {
      if (G.pointInPolys(polys.filter(function (p) { return p.closed; }), sx, sy)) return true;
    }
    var sw = AI.appearance.maxStrokeWidth(it) * (app.view ? app.view.scale : 1);
    var tol = Math.max(sw / 2, H.TOL);
    for (var i = 0; i < polys.length; i++) {
      var pts = polys[i].pts, n = pts.length;
      var last = polys[i].closed ? n : n - 1;
      for (var j = 0; j < last; j++) {
        var a = pts[j], b = pts[(j + 1) % n];
        var dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
        var t = l2 < 1e-12 ? 0 : U.clamp(((sx - a.x) * dx + (sy - a.y) * dy) / l2, 0, 1);
        if (U.dist(sx, sy, a.x + dx * t, a.y + dy * t) <= tol) return true;
      }
    }
    return false;
  }

  H.TOL = 4; /* 화면 픽셀 */

  /* 아이템(화면 좌표) 히트 — m 은 이미 합성된 (view × world) 행렬 */
  H.testItemM = function (app, it, sx, sy, m) {
    if (it.type === 'symbol') {
      /* 심볼은 정의 아트웍에 그대로 위임한다 */
      var def = AI.assets.findSymbol(app.doc, it.symbolId);
      if (!def) return false;
      return H.testItemM(app, def.item, sx, sy, M.mul(m, def.item.m));
    }
    if (it.type === 'text' || it.type === 'image') {
      var b = Rn.localBounds(it);
      var p = M.apply(M.invert(m), sx, sy);
      return p.x >= b.x - 1 && p.x <= b.x2 + 1 && p.y >= b.y - 1 && p.y <= b.y2 + 1;
    }
    if (it.type !== 'path') return false;
    /* 왜곡 및 변형 — 변형된 기하 중 하나라도 맞으면 맞은 것 */
    var px = AI.distort.proxies(it);
    if (px) {
      for (var k = 0; k < px.length; k++) {
        if (H.testItemM(app, px[k], sx, sy, M.mul(m, px[k].fxm))) return true;
      }
      return false;
    }
    if (!hctx) return geomTest(app, it, sx, sy, m);
    hctx.setTransform(1, 0, 0, 1, 0, 0);
    hctx.beginPath();
    G.tracePath(hctx, it, m);
    var fillable = AI.appearance.hasFill(it) && !app.prefs.outline;
    var hasClosed = it.subs.some(function (s) { return s.closed; });
    if (fillable && hasClosed && hctx.isPointInPath(sx, sy, 'nonzero')) return true;
    var sw = AI.appearance.maxStrokeWidth(it) * app.view.scale;
    hctx.lineWidth = Math.max(sw, H.TOL * 2);
    hctx.lineJoin = 'round'; hctx.lineCap = 'round';
    return hctx.isPointInStroke(sx, sy);
  };

  H.testItem = function (app, it, sx, sy, vm) {
    if (!it.visible) return false;
    var m = M.mul(vm, Model.worldMatrix(app.doc, it));
    if (it.type === 'group') {
      for (var i = it.children.length - 1; i >= 0; i--) if (H.testItem(app, it.children[i], sx, sy, vm)) return true;
      return false;
    }
    return H.testItemM(app, it, sx, sy, m);
  };

  /* 클릭 지점의 아이템 — deep=true 면 그룹 내부 아이템 반환
     행렬을 하향 누적하고 화면 바운딩으로 먼저 걸러 O(n) 로 동작한다. */
  H.itemAt = function (app, sx, sy, deep) {
    var vm = AI.viewT.matrix(app), doc = app.doc, tol = H.TOL + 2, sc = app.view.scale;

    function scan(list, pm) {
      for (var i = list.length - 1; i >= 0; i--) {
        var it = list[i];
        if (!it.visible || it.locked) continue;
        var m = M.mul(pm, it.m);
        var b = Rn.boundsM(it, m, false, sc);
        if (R.isEmpty(b) || !R.has(R.grow(b, tol), sx, sy)) continue;
        if (it.type === 'group') {
          var inner = scan(it.children, m);
          if (inner) return deep ? inner : it;
        } else if (H.testItemM(app, it, sx, sy, m)) return it;
      }
      return null;
    }

    for (var L = doc.layers.length - 1; L >= 0; L--) {
      var ly = doc.layers[L];
      if (!ly.visible || ly.locked) continue;
      var res = scan(ly.children, vm);
      if (res) return res;
    }
    return null;
  };

  /* 격리 모드 / 그룹 컨텍스트를 고려한 선택 대상 */
  H.selectTarget = function (app, sx, sy) {
    var hitDeep = H.itemAt(app, sx, sy, true);
    if (!hitDeep) return null;
    if (app.isolation && app.isolation.length) {
      /* 격리된 그룹 안에서는 그 그룹의 직속 자식까지만 */
      var root = app.isolation[app.isolation.length - 1];
      var chain = ancestors(app.doc, hitDeep);
      var idx = chain.indexOf(root);
      if (idx >= 0 && idx < chain.length - 1) return chain[idx + 1];
      if (hitDeep === root) return root;
      return topAncestor(app.doc, hitDeep);
    }
    return topAncestor(app.doc, hitDeep);
  };

  function ancestors(doc, it) {
    var chain = [];
    function rec(list, acc) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c === it) { chain = acc.concat([c]); return true; }
        if (c.type === 'group' && rec(c.children, acc.concat([c]))) return true;
      }
      return false;
    }
    for (var L = 0; L < doc.layers.length; L++) if (rec(doc.layers[L].children, [])) break;
    return chain;
  }
  H.ancestors = ancestors;
  function topAncestor(doc, it) { var c = ancestors(doc, it); return c[0] || it; }
  H.topAncestor = topAncestor;

  /* 사각 영역과 교차하는 아이템 (문서 좌표)
     deep=false 면 레이어 직속 아이템만, deep=true 면 말단 아이템까지 */
  H.itemsInRect = function (app, r, deep) {
    var out = [];
    function scan(list, pm) {
      for (var i = 0; i < list.length; i++) {
        var it = list[i];
        if (!it.visible || it.locked) continue;
        var m = M.mul(pm, it.m);
        var b = Rn.boundsM(it, m, false, 1);
        if (R.isEmpty(b) || !R.hit(b, r)) continue;
        if (it.type === 'group' && deep) scan(it.children, m);
        else out.push(it);
      }
    }
    app.doc.layers.forEach(function (ly) {
      if (!ly.visible || ly.locked) return;
      scan(ly.children, M.ident());
    });
    return out;
  };

  /* 편집 가능한 패스 목록 (월드 행렬 동반) */
  H.editablePaths = function (app) {
    var out = [];
    Model.walkWorld(app.doc, function (it, info) {
      if (it.type === 'path') out.push({ it: it, m: info.m });
    }, { skipLocked: true, skipHidden: true });
    return out;
  };

  /* 앵커 포인트 히트 (직접 선택) */
  H.anchorAt = function (app, sx, sy, items) {
    var vm = AI.viewT.matrix(app), best = null, tol = H.TOL + 2;
    var list = items
      ? items.filter(function (i) { return i.type === 'path'; })
        .map(function (i) { return { it: i, m: Model.worldMatrix(app.doc, i) }; })
      : H.editablePaths(app);
    list.forEach(function (o) {
      var wm = M.mul(vm, o.m);
      o.it.subs.forEach(function (sub, si) {
        sub.pts.forEach(function (p, pi) {
          var sp = M.apply(wm, p.x, p.y);
          if (Math.abs(sp.x - sx) > tol || Math.abs(sp.y - sy) > tol) return;
          var d = U.dist(sp.x, sp.y, sx, sy);
          if (d <= tol && (!best || d < best.d)) best = { d: d, it: o.it, si: si, pi: pi, part: 'a' };
        });
      });
    });
    return best;
  };

  /* 방향선(핸들) 히트 — 선택된 아이템만 */
  H.handleAt = function (app, sx, sy) {
    var vm = AI.viewT.matrix(app), best = null;
    app.sel.forEach(function (it) {
      if (it.type !== 'path') return;
      var wm = M.mul(vm, Model.worldMatrix(app.doc, it));
      it.subs.forEach(function (sub, si) {
        sub.pts.forEach(function (p, pi) {
          if (!AI.sel.isPtSelected(app, it, si, pi) && !AI.sel.neighborSelected(app, it, si, pi)) return;
          [['i', p.ix, p.iy], ['o', p.ox, p.oy]].forEach(function (h) {
            if (h[1] == null) return;
            var sp = M.apply(wm, h[1], h[2]);
            var d = U.dist(sp.x, sp.y, sx, sy);
            if (d <= H.TOL + 2 && (!best || d < best.d)) best = { d: d, it: it, si: si, pi: pi, part: h[0] };
          });
        });
      });
    });
    return best;
  };

  /* 패스 위(세그먼트) 히트 */
  H.segmentAt = function (app, sx, sy, items) {
    var vm = AI.viewT.matrix(app), best = null, tol = H.TOL + 2, sc = app.view.scale;
    var list = items
      ? items.filter(function (i) { return i.type === 'path'; })
        .map(function (i) { return { it: i, m: Model.worldMatrix(app.doc, i) }; })
      : H.editablePaths(app);
    list.forEach(function (o) {
      var wm = M.mul(vm, o.m);
      var b = Rn.boundsM(o.it, wm, false, sc);
      if (R.isEmpty(b) || !R.has(R.grow(b, tol), sx, sy)) return;
      var inv = M.invert(wm), lp = M.apply(inv, sx, sy);
      var n = G.nearestOnPath(o.it, lp.x, lp.y);
      if (!n) return;
      var sp = M.apply(wm, n.x, n.y);
      var d = U.dist(sp.x, sp.y, sx, sy);
      if (d <= tol && (!best || d < best.d)) best = { d: d, it: o.it, sub: n.sub, seg: n.seg, t: n.t, x: n.x, y: n.y };
    });
    return best;
  };

  function allPathItems(app) {
    return H.editablePaths(app).map(function (o) { return o.it; });
  }
  H.allPathItems = allPathItems;

  /* 라이브 모퉁이 위젯 히트 */
  H.cornerWidgetAt = function (app, sx, sy) {
    var cw = Rn.cornerWidgets(app);
    if (!cw) return null;
    for (var i = 0; i < cw.pts.length; i++) {
      var p = cw.pts[i];
      if (U.dist(p.x, p.y, sx, sy) <= 7) return { item: cw.item, pt: p };
    }
    return null;
  };

  /* 라이브 셰이프 위젯 히트 (원형 파이 각도 · 다각형 변 수) */
  H.liveWidgetAt = function (app, sx, sy) {
    var lw = Rn.liveWidgets(app);
    if (!lw) return null;
    var best = null, bd = 7;
    for (var i = 0; i < lw.pts.length; i++) {
      var p = lw.pts[i], d = U.dist(p.x, p.y, sx, sy);
      if (d <= bd) { bd = d; best = p; }
    }
    return best ? { item: lw.item, pt: best } : null;
  };

  /* 바운딩 박스 핸들 히트: 0..7 인덱스 / 'rotate' / null */
  H.bboxHandleAt = function (app, sx, sy) {
    var f = Rn.bboxFrame(app);
    if (!f) return null;
    for (var i = 0; i < 8; i++) {
      var p = f.pts[i];
      if (Math.abs(p.x - sx) <= 5 && Math.abs(p.y - sy) <= 5) return { index: i, frame: f };
    }
    /* 코너 바깥 = 회전 */
    for (i = 0; i < 8; i += 2) {
      var q = f.pts[i], c = { x: (f.pts[0].x + f.pts[4].x) / 2, y: (f.pts[0].y + f.pts[4].y) / 2 };
      var dx = q.x - c.x, dy = q.y - c.y, l = Math.hypot(dx, dy) || 1;
      var ox = q.x + dx / l * 7, oy = q.y + dy / l * 7;
      if (U.dist(ox, oy, sx, sy) <= 8) return { index: i, frame: f, rotate: true };
    }
    return null;
  };

  /* =======================================================================
     선택 상태
     ======================================================================= */
  var S = AI.sel = {};

  S.clear = function (app) { app.sel = []; app.selPts = []; app.apIndex = null; };
  S.set = function (app, items) {
    app.sel = items.slice();
    app.selPts = app.selPts.filter(function (sp) { return app.sel.indexOf(sp.it) >= 0; });
    app.apIndex = null;   /* 모양 패널에서 고른 겹은 선택이 바뀌면 초기화 */
  };
  S.add = function (app, it) { if (app.sel.indexOf(it) < 0) app.sel.push(it); app.apIndex = null; };
  S.remove = function (app, it) {
    var i = app.sel.indexOf(it); if (i >= 0) app.sel.splice(i, 1);
    app.selPts = app.selPts.filter(function (sp) { return sp.it !== it; });
  };
  S.toggle = function (app, it) { if (app.sel.indexOf(it) >= 0) S.remove(app, it); else S.add(app, it); };
  S.has = function (app, it) { return app.sel.indexOf(it) >= 0; };

  S.isPtSelected = function (app, it, si, pi) {
    for (var i = 0; i < app.selPts.length; i++) {
      var s = app.selPts[i];
      if (s.it === it && s.si === si && s.pi === pi) return true;
    }
    return false;
  };
  S.neighborSelected = function (app, it, si, pi) {
    var sub = it.subs[si]; if (!sub) return false;
    var n = sub.pts.length;
    var prev = pi - 1 < 0 ? (sub.closed ? n - 1 : -1) : pi - 1;
    var next = pi + 1 >= n ? (sub.closed ? 0 : -1) : pi + 1;
    return (prev >= 0 && S.isPtSelected(app, it, si, prev)) || (next >= 0 && S.isPtSelected(app, it, si, next));
  };
  S.addPt = function (app, it, si, pi) {
    if (!S.isPtSelected(app, it, si, pi)) app.selPts.push({ it: it, si: si, pi: pi });
    S.add(app, it);
  };
  S.removePt = function (app, it, si, pi) {
    app.selPts = app.selPts.filter(function (s) { return !(s.it === it && s.si === si && s.pi === pi); });
  };
  S.setPts = function (app, list) { app.selPts = list.slice(); };
  S.clearPts = function (app) { app.selPts = []; };
  S.selectAllPts = function (app, it) {
    it.subs.forEach(function (sub, si) { sub.pts.forEach(function (p, pi) { S.addPt(app, it, si, pi); }); });
  };
  /* 선택된 포인트가 속한 아이템 목록 */
  S.ptItems = function (app) {
    var out = [];
    app.selPts.forEach(function (s) { if (out.indexOf(s.it) < 0) out.push(s.it); });
    return out;
  };
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
