/* =========================================================================
   tools/freehand.js — 페인트브러시(B) / 연필(N) / 물방울 브러시(Shift+B)
                       / 지우개(Shift+E) / 매끄럽게
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, M = AI.mat, R = AI.rect, Model = AI.model, T = AI.tools, G = AI.geom, Col = AI.color, E = AI.edit;

  var st = null;

  /* 폴리라인을 폭 w 의 리본 폴리곤으로 */
  function ribbon(pts, w) {
    var r = w / 2, left = [], right = [], i;
    var simple = G.simplify(pts, 0.6);
    if (simple.length < 2) {
      var c = simple[0] || pts[0], ring = [];
      for (i = 0; i < 16; i++) ring.push({ x: c.x + Math.cos(i / 16 * 6.2832) * r, y: c.y + Math.sin(i / 16 * 6.2832) * r });
      return ring;
    }
    for (i = 0; i < simple.length; i++) {
      var p = simple[i];
      var a = simple[Math.max(0, i - 1)], b = simple[Math.min(simple.length - 1, i + 1)];
      var dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
      var nx = -dy / l * r, ny = dx / l * r;
      left.push({ x: p.x + nx, y: p.y + ny });
      right.push({ x: p.x - nx, y: p.y - ny });
    }
    /* 끝단 반원 */
    function cap(center, from, to) {
      var out = [], a0 = Math.atan2(from.y - center.y, from.x - center.x);
      var a1 = Math.atan2(to.y - center.y, to.x - center.x);
      var d = a1 - a0;
      while (d <= 0) d += Math.PI * 2;
      for (var k = 1; k < 8; k++) {
        var a = a0 + d * k / 8;
        out.push({ x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r });
      }
      return out;
    }
    var end = simple[simple.length - 1], start = simple[0];
    var ring = left.slice();
    ring = ring.concat(cap(end, left[left.length - 1], right[right.length - 1]));
    ring = ring.concat(right.slice().reverse());
    ring = ring.concat(cap(start, right[0], left[0]));
    return ring;
  }

  function docPts(app, screenPts) {
    return screenPts.map(function (p) { return AI.viewT.toDoc(app, p.x, p.y); });
  }

  /* ---------------- 페인트브러시 / 연필 ---------------- */
  function strokeTool(id, name, key, opts) {
    T.mk({
      id: id, name: name, key: key, cursor: 'crosshair',
      onDown: function (app, e) {
        app.history.begin(name, app.doc);
        st = { pts: [{ x: e.x, y: e.y }], item: null };
      },
      onMove: function (app, e) {
        if (!st || !e.down) return;
        var last = st.pts[st.pts.length - 1];
        if (U.dist(last.x, last.y, e.x, e.y) < 2) return;
        st.pts.push({ x: e.x, y: e.y });
        rebuild(app, e);
      },
      onUp: function (app, e) {
        if (!st) return;
        if (st.pts.length < 2) { if (st.item) { var l = Model.locate(app.doc, st.item); if (l) l.list.splice(l.index, 1); } app.history.abort(); st = null; app.invalidate(); return; }
        rebuild(app, e, true);
        app.history.commit();
        st = null;
        app.invalidate();
        AI.ui && AI.ui.syncSelection && AI.ui.syncSelection(app);
      }
    });

    function rebuild(app, e, final) {
      var dp = docPts(app, st.pts);
      if (st.item) { var loc = Model.locate(app.doc, st.item); if (loc) loc.list.splice(loc.index, 1); }
      var it;
      if (opts.blob) {
        var w = (app.brushWidth || 8);
        var ring = ribbon(dp, w);
        it = Model.newPath([{ closed: true, pts: ring.map(function (p) { return { x: p.x, y: p.y }; }) }]);
        it.name = '물방울 브러시';
        it.fill = U.deepCopy(app.fill && app.fill.type !== 'none' ? app.fill : Col.solid('#000000'));
        it.stroke = Model.defaultStroke();
      } else {
        var anchors = final ? G.fitCurve(dp, opts.pencil ? (app.pencilFidelity == null ? 2.5 : app.pencilFidelity) : 1.6) : dp.map(function (p) { return { x: p.x, y: p.y }; });
        it = Model.newPath([{ closed: e && e.alt ? true : false, pts: anchors }]);
        it.name = name;
        T.applyCurrentStyle(app, it, true);
        if (opts.pencil || opts.brush) {
          it.fill = Col.none();
          if (it.stroke.type === 'none') { it.stroke.type = 'solid'; it.stroke.color = '#000000'; }
          if (opts.brush) { it.stroke.width = app.brushWidth || 3; it.stroke.cap = 'round'; it.stroke.join = 'round'; }
        }
      }
      Model.activeLayer(app.doc).children.push(it);
      AI.sel.set(app, [it]);
      st.item = it;
      app.invalidate();
    }
  }

  strokeTool('brush', '페인트브러시 도구', 'b', { brush: true });
  strokeTool('pencil', '연필 도구', 'n', { pencil: true });
  strokeTool('blob', '물방울 브러시 도구', null, { blob: true });

  /* ---------------- 지우개 ---------------- */
  T.mk({
    id: 'eraser', name: '지우개 도구', key: null, cursor: 'crosshair',
    onDown: function (app, e) {
      app.history.begin('지우기', app.doc);
      st = { pts: [{ x: e.x, y: e.y }] };
      app.eraserPath = st.pts;
      app.invalidate();
    },
    onMove: function (app, e) {
      if (!st || !e.down) return;
      var last = st.pts[st.pts.length - 1];
      if (U.dist(last.x, last.y, e.x, e.y) < 2) return;
      st.pts.push({ x: e.x, y: e.y });
      app.invalidate();
    },
    onUp: function (app) {
      if (!st) return;
      var w = (app.eraserWidth || 20);
      var dp = docPts(app, st.pts);
      var ring = ribbon(dp, w);
      var eraserRings = AI.pathfinder.normalize([ring]);
      var bb = R.empty();
      ring.forEach(function (p) { R.add(bb, p.x, p.y); });

      var targets = app.sel.length ? app.sel.slice() : [];
      if (!targets.length) {
        Model.walk(app.doc, function (it) {
          if (it.type !== 'path' || Model.effLocked(app.doc, it)) return;
          var b = AI.render.worldBounds(app.doc, it);
          if (!R.isEmpty(b) && R.hit(b, bb)) targets.push(it);
        });
      }
      var changed = false;
      targets.forEach(function (it) {
        if (it.type !== 'path') return;
        var rings = E.itemRings(app, it);
        if (!rings.length) return;
        var res = AI.pathfinder.boolean(rings, eraserRings, 'minus');
        var loc = Model.locate(app.doc, it);
        if (!loc) return;
        changed = true;
        if (!res.length) { loc.list.splice(loc.index, 1); return; }
        var ni = E.ringsToItem(app, res, { fill: it.fill, stroke: it.stroke, opacity: it.opacity });
        ni.name = it.name;
        loc.list.splice(loc.index, 1, ni);
      });
      app.eraserPath = null;
      st = null;
      if (changed) { AI.sel.clear(app); app.history.commit(); } else app.history.abort();
      app.invalidate();
    },
    drawUI: function (ctx, app) {
      if (!app.eraserPath || app.eraserPath.length < 2) return;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,.8)';
      ctx.lineWidth = (app.eraserWidth || 20) * app.view.scale;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(app.eraserPath[0].x, app.eraserPath[0].y);
      app.eraserPath.forEach(function (p) { ctx.lineTo(p.x, p.y); });
      ctx.stroke();
      ctx.restore();
    }
  });

  /* ---------------- 매끄럽게 ---------------- */
  T.mk({
    id: 'smooth', name: '매끄럽게 도구', key: null, cursor: 'crosshair',
    onDown: function (app) { app.history.begin('매끄럽게', app.doc); st = { on: true }; },
    onMove: function (app, e) {
      if (!st || !e.down) return;
      app.sel.forEach(function (it) {
        if (it.type !== 'path') return;
        Model.expandShape(it);
        var wm = Model.worldMatrix(app.doc, it), inv = M.invert(wm);
        var d = AI.viewT.toDoc(app, e.x, e.y);
        var lp = M.apply(inv, d.x, d.y);
        var rad = 30 / app.view.scale;
        it.subs.forEach(function (sub) {
          var pts = sub.pts, n = pts.length;
          for (var i = 0; i < n; i++) {
            var p = pts[i];
            if (U.dist(p.x, p.y, lp.x, lp.y) > rad) continue;
            var a = pts[i - 1] || (sub.closed ? pts[n - 1] : p);
            var b = pts[i + 1] || (sub.closed ? pts[0] : p);
            p.x = p.x * 0.7 + (a.x + b.x) / 2 * 0.3;
            p.y = p.y * 0.7 + (a.y + b.y) / 2 * 0.3;
          }
        });
      });
      app.invalidate();
    },
    onUp: function (app) { if (st) { app.history.commit(); st = null; } }
  });
})(window.AI);
