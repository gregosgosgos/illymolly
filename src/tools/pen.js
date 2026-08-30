/* =========================================================================
   tools/pen.js — 펜 도구 (P) / 앵커 추가(+) / 앵커 삭제(-) / 기준점 변환(Shift+C)
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, M = AI.mat, Model = AI.model, H = AI.hit, T = AI.tools, G = AI.geom, Col = AI.color;

  var pen = null;   /* {it, si, dir} 작성 중인 패스 */
  var drag = null;
  var cursorDoc = null;

  function localPt(app, it, sx, sy) {
    var d = AI.viewT.toDoc(app, sx, sy);
    var inv = M.invert(Model.worldMatrix(app.doc, it));
    return M.apply(inv, d.x, d.y);
  }

  function endPath(app) {
    if (pen && pen.it && Model.countPts(pen.it) < 2) {
      var loc = Model.locate(app.doc, pen.it);
      if (loc) loc.list.splice(loc.index, 1);
      AI.sel.clear(app);
    }
    pen = null; drag = null;
    app.invalidate();
  }
  T.endPen = endPath;

  function activeSub() { return pen && pen.it.subs[pen.si]; }

  function startNewPath(app, x, y) {
    var it = Model.newPath([{ closed: false, pts: [] }]);
    T.applyCurrentStyle(app, it, true);
    Model.activeLayer(app.doc).children.push(it);
    AI.sel.set(app, [it]);
    pen = { it: it, si: 0, dir: 'end' };
    return it;
  }

  T.mk({
    id: 'pen', name: '펜 도구', key: 'p', cursor: 'crosshair',

    deactivate: function (app) { endPath(app); },

    onDown: function (app, e) {
      app.history.begin('패스 그리기', app.doc);

      /* 기존 패스 위 클릭 -> 앵커 추가 */
      if (!pen) {
        var seg = H.segmentAt(app, e.x, e.y, app.sel.length ? app.sel : null);
        var an0 = H.anchorAt(app, e.x, e.y, app.sel.length ? app.sel : null);
        if (an0 && !e.alt) {
          var sub0 = an0.it.subs[an0.si];
          var isEnd = (an0.pi === 0 || an0.pi === sub0.pts.length - 1) && !sub0.closed;
          if (isEnd) {
            /* 열린 패스 이어 그리기 */
            Model.expandShape(an0.it);
            if (an0.pi === 0) sub0.pts.reverse();
            pen = { it: an0.it, si: an0.si, dir: 'end' };
            AI.sel.set(app, [an0.it]);
            drag = { pt: sub0.pts[sub0.pts.length - 1], created: false };
            app.invalidate();
            return;
          }
        }
        if (seg && !e.alt) {
          Model.expandShape(seg.it);
          var np = G.insertAnchor(seg.it.subs[seg.sub], seg.seg, seg.t);
          AI.sel.set(app, [seg.it]);
          if (np) AI.sel.addPt(app, seg.it, seg.sub, seg.it.subs[seg.sub].pts.indexOf(np));
          app.history.commit();
          app.invalidate();
          return;
        }
      }

      var it = pen ? pen.it : startNewPath(app, e.x, e.y);
      var sub = it.subs[pen.si];
      var lp = localPt(app, it, e.x, e.y);

      /* 첫 점 클릭 -> 닫기 */
      if (sub.pts.length > 1) {
        var first = sub.pts[0];
        var fs = M.apply(M.mul(AI.viewT.matrix(app), Model.worldMatrix(app.doc, it)), first.x, first.y);
        if (U.dist(fs.x, fs.y, e.x, e.y) <= 7) {
          sub.closed = true;
          drag = { pt: first, closing: true };
          app.history.commit();
          app.invalidate();
          return;
        }
      }
      if (e.shift && sub.pts.length) {
        var last = sub.pts[sub.pts.length - 1];
        var c = T.constrainAngle(last.x, last.y, lp.x, lp.y, 45);
        lp = c;
      }
      var p = { x: lp.x, y: lp.y };
      sub.pts.push(p);
      drag = { pt: p, created: true };
      app.invalidate();
    },

    onMove: function (app, e) {
      cursorDoc = AI.viewT.toDoc(app, e.x, e.y);
      if (drag && drag.pt && e.down) {
        var it = pen.it, p = drag.pt;
        var lp = localPt(app, it, e.x, e.y);
        p.ox = lp.x; p.oy = lp.y;
        if (!e.alt) { p.ix = 2 * p.x - lp.x; p.iy = 2 * p.y - lp.y; }
        if (drag.closing) { p.ix = 2 * p.x - lp.x; p.iy = 2 * p.y - lp.y; }
        app.invalidate();
        return;
      }
      /* Illustrator 방식 펜 커서 상태 (× + − ○ /) */
      var C = AI.cursors, state = 'new';
      if (pen) {
        state = '';
        var sub = pen.it.subs[pen.si];
        if (sub && sub.pts.length > 1 && !sub.closed) {
          var first = sub.pts[0];
          var fs = M.apply(M.mul(AI.viewT.matrix(app), Model.worldMatrix(app.doc, pen.it)), first.x, first.y);
          if (U.dist(fs.x, fs.y, e.x, e.y) <= 7) state = 'close';
        }
      } else {
        var an = H.anchorAt(app, e.x, e.y, app.sel.length ? app.sel : null);
        if (an) {
          var sb = an.it.subs[an.si];
          var isEnd = !sb.closed && (an.pi === 0 || an.pi === sb.pts.length - 1);
          state = isEnd ? 'join' : 'del';
        } else if (H.segmentAt(app, e.x, e.y, app.sel.length ? app.sel : null)) state = 'add';
      }
      C.set(app, C.pen(state));
      if (pen) app.invalidate();
    },

    onUp: function (app) {
      if (drag && drag.closing) { endPath(app); }
      drag = null;
      app.history.commit();
      app.invalidate();
    },

    onKey: function (app, ev) {
      if (ev.key === 'Escape' || ev.key === 'Enter') { endPath(app); return true; }
      return false;
    },

    drawUI: function (ctx, app) {
      if (!pen || !cursorDoc) return;
      var sub = pen.it.subs[pen.si];
      if (!sub || !sub.pts.length || sub.closed) return;
      var wm = M.mul(AI.viewT.matrix(app), Model.worldMatrix(app.doc, pen.it));
      var last = sub.pts[sub.pts.length - 1];
      var a = M.apply(wm, last.x, last.y);
      var cur = AI.viewT.toScreen(app, cursorDoc.x, cursorDoc.y);
      ctx.save();
      ctx.strokeStyle = 'rgba(45,140,235,.85)'; ctx.lineWidth = 1; ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      if (last.ox != null) {
        var c1 = M.apply(wm, last.ox, last.oy);
        ctx.bezierCurveTo(c1.x, c1.y, cur.x, cur.y, cur.x, cur.y);
      } else ctx.lineTo(cur.x, cur.y);
      ctx.stroke();
      ctx.restore();
    }
  });

  /* ---------------- 앵커 추가 / 삭제 ---------------- */
  T.mk({
    id: 'addanchor', name: '고정점 추가 도구', key: '+', cursor: 'copy', direct: true,
    onDown: function (app, e) {
      var seg = H.segmentAt(app, e.x, e.y);
      if (!seg) return;
      app.history.begin('고정점 추가', app.doc);
      Model.expandShape(seg.it);
      var np = G.insertAnchor(seg.it.subs[seg.sub], seg.seg, seg.t);
      AI.sel.set(app, [seg.it]);
      if (np) AI.sel.addPt(app, seg.it, seg.sub, seg.it.subs[seg.sub].pts.indexOf(np));
      app.history.commit();
      app.invalidate();
    }
  });

  T.mk({
    id: 'delanchor', name: '고정점 삭제 도구', key: '-', cursor: 'not-allowed', direct: true,
    onDown: function (app, e) {
      var an = H.anchorAt(app, e.x, e.y);
      if (!an) return;
      app.history.begin('고정점 삭제', app.doc);
      Model.expandShape(an.it);
      G.removeAnchor(an.it.subs[an.si], an.pi);
      if (!an.it.subs[an.si].pts.length) an.it.subs.splice(an.si, 1);
      if (!an.it.subs.length) { var loc = Model.locate(app.doc, an.it); if (loc) loc.list.splice(loc.index, 1); AI.sel.clear(app); }
      AI.sel.clearPts(app);
      app.history.commit();
      app.invalidate();
    }
  });

  /* ---------------- 기준점 변환 ---------------- */
  var conv = null;
  T.mk({
    id: 'convert', name: '고정점 도구', key: null, cursor: 'crosshair', direct: true,
    onDown: function (app, e) {
      var hh = H.handleAt(app, e.x, e.y);
      var an = H.anchorAt(app, e.x, e.y);
      app.history.begin('기준점 변환', app.doc);
      if (an) {
        var p = an.it.subs[an.si].pts[an.pi];
        Model.expandShape(an.it);
        AI.sel.set(app, [an.it]); AI.sel.clearPts(app); AI.sel.addPt(app, an.it, an.si, an.pi);
        if (p.ix != null || p.ox != null) { delete p.ix; delete p.iy; delete p.ox; delete p.oy; }
        conv = { it: an.it, p: p, si: an.si, pi: an.pi };
        app.invalidate();
        return;
      }
      if (hh) {
        var p2 = hh.it.subs[hh.si].pts[hh.pi];
        conv = { it: hh.it, p: p2, part: hh.part, si: hh.si, pi: hh.pi, single: true };
      }
    },
    onMove: function (app, e) {
      if (!conv || !e.down) return;
      var lp = M.apply(M.invert(Model.worldMatrix(app.doc, conv.it)), AI.viewT.toDoc(app, e.x, e.y).x, AI.viewT.toDoc(app, e.x, e.y).y);
      var p = conv.p;
      if (conv.single && conv.part === 'i') { p.ix = lp.x; p.iy = lp.y; }
      else {
        p.ox = lp.x; p.oy = lp.y;
        p.ix = 2 * p.x - lp.x; p.iy = 2 * p.y - lp.y;
      }
      app.invalidate();
    },
    onUp: function (app) { if (conv) { app.history.commit(); conv = null; } else app.history.abort(); }
  });

})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
