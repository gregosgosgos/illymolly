/* =========================================================================
   tools/directselect.js — 직접 선택 도구 (A)
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, M = AI.mat, R = AI.rect, Model = AI.model, H = AI.hit, E = AI.edit, T = AI.tools, G = AI.geom;

  var st = null;

  function snapshotPts(app) {
    return app.selPts.map(function (s) {
      var p = s.it.subs[s.si].pts[s.pi];
      return { s: s, x: p.x, y: p.y, ix: p.ix, iy: p.iy, ox: p.ox, oy: p.oy };
    });
  }

  T.mk({
    id: 'directselect', name: '직접 선택 도구', key: 'a', cursor: 'default', direct: true,

    onDown: function (app, e) {
      app.smart = [];
      /* 1) 방향선(핸들) */
      var hh = H.handleAt(app, e.x, e.y);
      if (hh) {
        app.history.begin('방향선 편집', app.doc);
        var p = hh.it.subs[hh.si].pts[hh.pi];
        Model.expandShape(hh.it);
        st = { kind: 'handle', it: hh.it, si: hh.si, pi: hh.pi, part: hh.part, smooth: G.isSmooth(p), moved: false };
        return;
      }
      /* 2) 앵커 */
      var an = H.anchorAt(app, e.x, e.y);
      if (an) {
        if (e.shift) {
          if (AI.sel.isPtSelected(app, an.it, an.si, an.pi)) AI.sel.removePt(app, an.it, an.si, an.pi);
          else AI.sel.addPt(app, an.it, an.si, an.pi);
        } else if (!AI.sel.isPtSelected(app, an.it, an.si, an.pi)) {
          AI.sel.clear(app);
          AI.sel.addPt(app, an.it, an.si, an.pi);
        }
        AI.sel.add(app, an.it);
        app.history.begin('앵커 이동', app.doc);
        st = { kind: 'pts', snap: snapshotPts(app), moved: false };
        app.invalidate();
        return;
      }
      /* 3) 세그먼트 */
      var sg = H.segmentAt(app, e.x, e.y);
      if (sg) {
        if (!e.shift) { AI.sel.clear(app); }
        AI.sel.add(app, sg.it);
        var sub = sg.it.subs[sg.sub], segs = G.segments(sub), g = segs[sg.seg];
        Model.expandShape(sg.it);
        st = {
          kind: 'seg', it: sg.it, sub: sg.sub, seg: sg.seg, t: sg.t, moved: false,
          a: g.a, b: g.b,
          snapA: { x: g.a.x, y: g.a.y, ox: g.a.ox, oy: g.a.oy, ix: g.a.ix, iy: g.a.iy },
          snapB: { x: g.b.x, y: g.b.y, ox: g.b.ox, oy: g.b.oy, ix: g.b.ix, iy: g.b.iy },
          line: g.line
        };
        app.history.begin('세그먼트 편집', app.doc);
        app.invalidate();
        return;
      }
      /* 4) 오브젝트 (칠 영역) 클릭 -> 전체 앵커 선택 후 이동 */
      var hit = H.itemAt(app, e.x, e.y, true);
      if (hit && hit.type === 'path') {
        if (!e.shift) AI.sel.clear(app);
        AI.sel.add(app, hit);
        AI.sel.selectAllPts(app, hit);
        app.history.begin('이동', app.doc);
        st = { kind: 'pts', snap: snapshotPts(app), moved: false };
        app.invalidate();
        return;
      }
      if (hit && hit.type !== 'path') {
        if (!e.shift) AI.sel.clear(app);
        AI.sel.add(app, hit);
        app.history.begin('이동', app.doc);
        st = { kind: 'obj', orig: app.sel.map(function (i) { return i.m.slice(); }), sel: app.sel.slice(), moved: false };
        app.invalidate();
        return;
      }
      /* 5) 마퀴 */
      if (!e.shift) AI.sel.clear(app);
      st = { kind: 'marquee', start: { x: e.x, y: e.y }, additive: e.shift, base: app.selPts.slice() };
      app.marquee = { x: e.x, y: e.y, x2: e.x, y2: e.y };
      app.invalidate();
    },

    onMove: function (app, e) {
      if (!st) {
        var over = H.anchorAt(app, e.x, e.y) || H.handleAt(app, e.x, e.y);
        AI.cursors.set(app, over ? AI.cursors.arrowPlus() : AI.cursors.arrowWhite());
        return;
      }
      var dpt = AI.viewT.toDoc(app, e.x, e.y), spt = AI.viewT.toDoc(app, e.sx, e.sy);
      var dx = dpt.x - spt.x, dy = dpt.y - spt.y;
      if (e.shift && st.kind !== 'handle') { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }

      if (st.kind === 'marquee') {
        app.marquee = R.fromPts(st.start.x, st.start.y, e.x, e.y);
        var p1 = AI.viewT.toDoc(app, app.marquee.x, app.marquee.y);
        var p2 = AI.viewT.toDoc(app, app.marquee.x2, app.marquee.y2);
        var rect = R.fromPts(p1.x, p1.y, p2.x, p2.y);
        var list = st.additive ? st.base.slice() : [];
        H.editablePaths(app).forEach(function (o) {
          var it = o.it, wm = o.m;
          it.subs.forEach(function (sub, si) {
            sub.pts.forEach(function (p, pi) {
              var w = M.apply(wm, p.x, p.y);
              if (R.has(rect, w.x, w.y)) {
                var dup = list.some(function (q) { return q.it === it && q.si === si && q.pi === pi; });
                if (!dup) list.push({ it: it, si: si, pi: pi });
              }
            });
          });
        });
        AI.sel.setPts(app, list);
        AI.sel.set(app, AI.sel.ptItems(app));
        app.invalidate();
        return;
      }

      st.moved = true;

      if (st.kind === 'pts') {
        /* 원래 위치로 되돌린 뒤 델타 적용 */
        st.snap.forEach(function (o) {
          var p = o.s.it.subs[o.s.si].pts[o.s.pi];
          p.x = o.x; p.y = o.y;
          if (o.ix != null) { p.ix = o.ix; p.iy = o.iy; }
          if (o.ox != null) { p.ox = o.ox; p.oy = o.oy; }
        });
        E.movePoints(app, dx, dy);
      } else if (st.kind === 'obj') {
        for (var i = 0; i < st.sel.length; i++) st.sel[i].m = st.orig[i].slice();
        E.transformSelection(app, M.translate(dx, dy));
      } else if (st.kind === 'handle') {
        var it = st.it, p = it.subs[st.si].pts[st.pi];
        var wm = Model.worldMatrix(app.doc, it), inv = M.invert(wm);
        var lp = M.apply(inv, dpt.x, dpt.y);
        if (st.part === 'o') { p.ox = lp.x; p.oy = lp.y; } else { p.ix = lp.x; p.iy = lp.y; }
        if (st.smooth && !e.alt) {
          var other = st.part === 'o' ? 'i' : 'o';
          var ox = st.part === 'o' ? p.ox : p.ix, oy = st.part === 'o' ? p.oy : p.iy;
          var vx = ox - p.x, vy = oy - p.y, l = Math.hypot(vx, vy) || 1;
          var cur = (other === 'i') ? { x: p.ix, y: p.iy } : { x: p.ox, y: p.oy };
          var ol = cur.x == null ? l : Math.hypot(cur.x - p.x, cur.y - p.y);
          if (other === 'i') { p.ix = p.x - vx / l * ol; p.iy = p.y - vy / l * ol; }
          else { p.ox = p.x - vx / l * ol; p.oy = p.y - vy / l * ol; }
        }
      } else if (st.kind === 'seg') {
        var it2 = st.it, wm2 = Model.worldMatrix(app.doc, it2), inv2 = M.invert(wm2);
        var d2 = M.applyV(inv2, dx, dy);
        var a = st.a, b = st.b;
        if (st.line) {
          a.x = st.snapA.x + d2.x; a.y = st.snapA.y + d2.y;
          b.x = st.snapB.x + d2.x; b.y = st.snapB.y + d2.y;
          if (st.snapA.ox != null) { a.ox = st.snapA.ox + d2.x; a.oy = st.snapA.oy + d2.y; }
          if (st.snapA.ix != null) { a.ix = st.snapA.ix + d2.x; a.iy = st.snapA.iy + d2.y; }
          if (st.snapB.ox != null) { b.ox = st.snapB.ox + d2.x; b.oy = st.snapB.oy + d2.y; }
          if (st.snapB.ix != null) { b.ix = st.snapB.ix + d2.x; b.iy = st.snapB.iy + d2.y; }
        } else {
          var t = st.t, mt = 1 - t;
          var w1 = 3 * mt * mt * t, w2 = 3 * mt * t * t;
          var denom = (w1 * w1 + w2 * w2) || 1;
          var k1 = w1 / denom, k2 = w2 / denom;
          var c1x = (st.snapA.ox == null ? st.snapA.x : st.snapA.ox);
          var c1y = (st.snapA.oy == null ? st.snapA.y : st.snapA.oy);
          var c2x = (st.snapB.ix == null ? st.snapB.x : st.snapB.ix);
          var c2y = (st.snapB.iy == null ? st.snapB.y : st.snapB.iy);
          a.ox = c1x + d2.x * k1; a.oy = c1y + d2.y * k1;
          b.ix = c2x + d2.x * k2; b.iy = c2y + d2.y * k2;
        }
      }
      app.invalidate();
      AI.ui && AI.ui.syncSelection && AI.ui.syncSelection(app);
    },

    onUp: function (app) {
      if (!st) return;
      if (st.kind === 'marquee') { app.marquee = null; app.history.abort(); }
      else if (st.moved) app.history.commit();
      else app.history.abort();
      st = null;
      app.invalidate();
    }
  });
})(window.AI);
