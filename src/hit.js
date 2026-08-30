/* =========================================================================
   hit.js — 히트 테스트 + 선택 상태 관리
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, M = AI.mat, R = AI.rect, G = AI.geom, Model = AI.model, Rn = AI.render;
  var H = AI.hit = {};
  var hctx = document.createElement('canvas').getContext('2d');

  H.TOL = 4; /* 화면 픽셀 */

  /* 아이템(화면 좌표) 히트 */
  H.testItem = function (app, it, sx, sy, vm) {
    if (!it.visible) return false;
    var m = M.mul(vm, Model.worldMatrix(app.doc, it));
    if (it.type === 'group') {
      for (var i = it.children.length - 1; i >= 0; i--) if (H.testItem(app, it.children[i], sx, sy, vm)) return true;
      return false;
    }
    if (it.type === 'text') {
      var b = Rn.localBounds(it);
      var inv = M.invert(m), p = M.apply(inv, sx, sy);
      return p.x >= b.x - 1 && p.x <= b.x2 + 1 && p.y >= b.y - 1 && p.y <= b.y2 + 1;
    }
    /* path */
    hctx.setTransform(1, 0, 0, 1, 0, 0);
    hctx.beginPath();
    G.tracePath(hctx, it, m);
    var fillable = it.fill && it.fill.type !== 'none' && !app.prefs.outline;
    var hasClosed = it.subs.some(function (s) { return s.closed; });
    if (fillable && hasClosed && hctx.isPointInPath(sx, sy, 'nonzero')) return true;
    var sw = (it.stroke && it.stroke.type !== 'none') ? it.stroke.width * app.view.scale : 0;
    hctx.lineWidth = Math.max(sw, H.TOL * 2);
    hctx.lineJoin = 'round'; hctx.lineCap = 'round';
    if (hctx.isPointInStroke(sx, sy)) return true;
    return false;
  };

  /* 클릭 지점의 아이템 — deep=true 면 그룹 내부 아이템 반환 */
  H.itemAt = function (app, sx, sy, deep) {
    var vm = AI.viewT.matrix(app), doc = app.doc, res = null;
    for (var L = doc.layers.length - 1; L >= 0 && !res; L--) {
      var ly = doc.layers[L];
      if (!ly.visible || ly.locked) continue;
      res = scan(ly.children);
    }
    function scan(list) {
      for (var i = list.length - 1; i >= 0; i--) {
        var it = list[i];
        if (!it.visible || it.locked) continue;
        if (it.type === 'group') {
          var inner = scan(it.children);
          if (inner) return deep ? inner : it;
        } else if (H.testItem(app, it, sx, sy, vm)) return it;
      }
      return null;
    }
    return res;
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

  /* 사각 영역과 교차하는 아이템(최상위) */
  H.itemsInRect = function (app, r, deep) {
    var out = [], doc = app.doc;
    doc.layers.forEach(function (ly) {
      if (!ly.visible || ly.locked) return;
      (function scan(list) {
        list.forEach(function (it) {
          if (!it.visible || it.locked) return;
          var b = Rn.worldBounds(doc, it);
          if (R.isEmpty(b) || !R.hit(b, r)) return;
          if (it.type === 'group' && deep) scan(it.children);
          else out.push(it);
        });
      })(ly.children);
    });
    return out;
  };

  /* 앵커 포인트 히트 (직접 선택) */
  H.anchorAt = function (app, sx, sy, items) {
    var vm = AI.viewT.matrix(app), best = null;
    (items || allPathItems(app)).forEach(function (it) {
      if (it.type !== 'path') return;
      if (Model.effLocked(app.doc, it)) return;
      var wm = M.mul(vm, Model.worldMatrix(app.doc, it));
      it.subs.forEach(function (sub, si) {
        sub.pts.forEach(function (p, pi) {
          var sp = M.apply(wm, p.x, p.y);
          var d = U.dist(sp.x, sp.y, sx, sy);
          if (d <= H.TOL + 2 && (!best || d < best.d)) best = { d: d, it: it, si: si, pi: pi, part: 'a' };
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
    var vm = AI.viewT.matrix(app), best = null;
    (items || allPathItems(app)).forEach(function (it) {
      if (it.type !== 'path' || Model.effLocked(app.doc, it)) return;
      var wm = M.mul(vm, Model.worldMatrix(app.doc, it));
      var inv = M.invert(wm), lp = M.apply(inv, sx, sy);
      var n = G.nearestOnPath(it, lp.x, lp.y);
      if (!n) return;
      var sp = M.apply(wm, n.x, n.y);
      var d = U.dist(sp.x, sp.y, sx, sy);
      if (d <= H.TOL + 2 && (!best || d < best.d)) best = { d: d, it: it, sub: n.sub, seg: n.seg, t: n.t, x: n.x, y: n.y };
    });
    return best;
  };

  function allPathItems(app) {
    var out = [];
    Model.walk(app.doc, function (it) { if (it.type === 'path') out.push(it); });
    return out;
  }
  H.allPathItems = allPathItems;

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

  S.clear = function (app) { app.sel = []; app.selPts = []; };
  S.set = function (app, items) {
    app.sel = items.slice();
    app.selPts = app.selPts.filter(function (sp) { return app.sel.indexOf(sp.it) >= 0; });
  };
  S.add = function (app, it) { if (app.sel.indexOf(it) < 0) app.sel.push(it); };
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
})(window.AI);
