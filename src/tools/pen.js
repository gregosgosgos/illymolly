/* =========================================================================
   tools/pen.js — 펜 도구 (P) / 앵커 추가(+) / 앵커 삭제(-) / 기준점 변환(Shift+C)
   -------------------------------------------------------------------------
   일러스트레이터의 펜은 "점을 찍는 도구" 가 아니라 상태 기계에 가깝다.
   커서가 어디에 있느냐에 따라 같은 클릭이 전혀 다른 일을 한다.

     · 빈 곳          새 앵커 (끌면 대칭 방향선, Alt 로 끌면 꺾인 점)
     · 방금 찍은 점   방향선을 떼어 각진 점으로 (Alt+끌기 = 나가는 선만 다시)
     · 첫 점          패스 닫기 (끌면 닫히는 쪽 방향선을 다듬는다)
     · 다른 열린 끝점 두 패스 잇기
     · 패스 위        앵커 추가        · 앵커 위   앵커 삭제

   그리는 중에는 Backspace 로 방금 찍은 점을 물릴 수 있고, Space 로 아직
   놓지 않은 점을 옮길 수 있으며, Shift 는 45° 로 묶는다.
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
  /* 그리는 중인가 — 렌더러가 앵커를 보일지 정할 때 쓴다 */
  T.penActive = function () { return !!pen; };

  function activeSub() { return pen && pen.it.subs[pen.si]; }

  function startNewPath(app) {
    var it = Model.newPath([{ closed: false, pts: [] }]);
    T.applyCurrentStyle(app, it, true);
    Model.activeLayer(app.doc).children.push(it);
    AI.sel.set(app, [it]);
    pen = { it: it, si: 0 };
    return it;
  }

  /* 화면 좌표가 이 앵커 위인가 */
  function nearPt(app, it, p, sx, sy, tol) {
    var q = M.apply(M.mul(AI.viewT.matrix(app), Model.worldMatrix(app.doc, it)), p.x, p.y);
    return U.dist(q.x, q.y, sx, sy) <= (tol || 7);
  }

  /* 열린 서브패스의 끝점인가 — 이어 그리기 · 잇기의 대상 */
  function endpointAt(app, sx, sy, skip) {
    var an = H.anchorAt(app, sx, sy, null);
    if (!an) return null;
    var sub = an.it.subs[an.si];
    if (sub.closed) return null;
    if (an.pi !== 0 && an.pi !== sub.pts.length - 1) return null;
    if (skip && an.it === skip.it && an.si === skip.si && an.pi === skip.pi) return null;
    return an;
  }

  /* 방향선을 놓는다 — Alt 면 나가는 쪽만(꺾임), 아니면 대칭 */
  function setHandle(app, p, lp, e, breakIt) {
    if (e.shift) lp = T.constrainAngle(p.x, p.y, lp.x, lp.y, 45);
    p.ox = lp.x; p.oy = lp.y;
    if (breakIt) return;
    p.ix = 2 * p.x - lp.x; p.iy = 2 * p.y - lp.y;
  }

  /* 그리는 중인 서브패스의 작업 끝점 */
  function workEnd(sub) { return sub.pts[sub.pts.length - 1]; }

  /* 다른 패스를 지금 그리는 패스에 이어 붙인다 (일러스트레이터의 [연결]) */
  function joinTo(app, an) {
    var sub = pen.it.subs[pen.si];
    var osub = an.it.subs[an.si];
    Model.expandShape(an.it);
    var wmA = Model.worldMatrix(app.doc, pen.it);
    var wmB = Model.worldMatrix(app.doc, an.it);
    var toA = M.mul(M.invert(wmA), wmB);          /* 상대 좌표계를 맞춘다 */
    var moved = G.xformSubs([osub], toA)[0].pts;
    if (an.pi === osub.pts.length - 1) moved.reverse();
    /* 두 끝점이 겹쳐 있으면 하나로 합치고, 떨어져 있으면 새 구간으로 잇는다
       (일러스트레이터의 [연결] 과 같은 규칙) */
    var end = workEnd(sub);
    if (moved.length && U.dist(end.x, end.y, moved[0].x, moved[0].y) < 0.5) {
      var first = moved.shift();
      if (first.ox != null) { end.ox = first.ox; end.oy = first.oy; }
    }
    sub.pts = sub.pts.concat(moved);
    /* 넘겨준 쪽은 그 서브패스를 잃는다 — 비면 오브젝트째 사라진다 */
    an.it.subs.splice(an.si, 1);
    if (!an.it.subs.length) {
      var loc = Model.locate(app.doc, an.it);
      if (loc) loc.list.splice(loc.index, 1);
    }
    AI.sel.set(app, [pen.it]);
    app.invalidate();
  }

  T.mk({
    id: 'pen', name: '펜 도구', key: 'p', cursor: 'crosshair',

    deactivate: function (app) { endPath(app); },

    onDown: function (app, e) {
      var lp, sub, p;

      /* ---------- 그리는 중 ---------- */
      if (pen) {
        sub = pen.it.subs[pen.si];
        app.history.begin('패스 그리기', app.doc);

        /* 1) 첫 점 -> 닫기. 끌면 닫히는 쪽(들어오는) 방향선을 다듬는다 */
        if (sub.pts.length > 1 && nearPt(app, pen.it, sub.pts[0], e.x, e.y)) {
          sub.closed = true;
          drag = { pt: sub.pts[0], closing: true };
          app.invalidate();
          return;
        }

        /* 2) 방금 찍은 점 -> 방향선을 떼어 각진 점으로.
              Alt 로 끌면 나가는 방향선만 새로 잡는다 (꺾인 점 만들기) */
        var end = workEnd(sub);
        if (end && nearPt(app, pen.it, end, e.x, e.y)) {
          if (!e.alt) { delete end.ox; delete end.oy; }
          drag = { pt: end, redo: true, broke: true };
          app.invalidate();
          return;
        }

        /* 3) 다른 열린 끝점 -> 두 패스 잇기 */
        var join = endpointAt(app, e.x, e.y, { it: pen.it, si: pen.si, pi: sub.pts.length - 1 });
        if (join && !(join.it === pen.it && join.si === pen.si)) {
          joinTo(app, join);
          app.history.commit();
          return;
        }

        /* 4) 그 밖 -> 새 앵커 */
        lp = localPt(app, pen.it, e.x, e.y);
        if (e.shift && sub.pts.length) {
          var last = workEnd(sub);
          lp = T.constrainAngle(last.x, last.y, lp.x, lp.y, 45);
        }
        p = { x: lp.x, y: lp.y };
        sub.pts.push(p);
        drag = { pt: p, created: true };
        app.invalidate();
        return;
      }

      /* ---------- 그리기 전 ---------- */
      app.history.begin('패스 그리기', app.doc);

      /* 열린 끝점 -> 그 패스를 이어 그린다 */
      var cont = endpointAt(app, e.x, e.y);
      if (cont && !e.alt) {
        Model.expandShape(cont.it);
        var csub = cont.it.subs[cont.si];
        if (cont.pi === 0) csub.pts.reverse();
        pen = { it: cont.it, si: cont.si };
        AI.sel.set(app, [cont.it]);
        drag = { pt: workEnd(csub), redo: true, broke: true };
        app.invalidate();
        return;
      }

      /* 앵커 위 -> 삭제 (일러스트레이터의 펜이 − 커서를 보여 주는 자리) */
      var an = H.anchorAt(app, e.x, e.y, app.sel.length ? app.sel : null);
      if (an && !e.alt) {
        Model.expandShape(an.it);
        G.removeAnchor(an.it.subs[an.si], an.pi);
        if (!an.it.subs[an.si].pts.length) an.it.subs.splice(an.si, 1);
        if (!an.it.subs.length) {
          var loc2 = Model.locate(app.doc, an.it);
          if (loc2) loc2.list.splice(loc2.index, 1);
          AI.sel.clear(app);
        }
        AI.sel.clearPts(app);
        app.history.commit();
        app.invalidate();
        return;
      }

      /* 패스 위 -> 앵커 추가 */
      var seg = H.segmentAt(app, e.x, e.y, app.sel.length ? app.sel : null);
      if (seg && !e.alt) {
        Model.expandShape(seg.it);
        var np = G.insertAnchor(seg.it.subs[seg.sub], seg.seg, seg.t);
        AI.sel.set(app, [seg.it]);
        if (np) AI.sel.addPt(app, seg.it, seg.sub, seg.it.subs[seg.sub].pts.indexOf(np));
        app.history.commit();
        app.invalidate();
        return;
      }

      /* 빈 곳 -> 새 패스 */
      var it = startNewPath(app);
      lp = localPt(app, it, e.x, e.y);
      p = { x: lp.x, y: lp.y };
      it.subs[0].pts.push(p);
      drag = { pt: p, created: true };
      app.invalidate();
    },

    onMove: function (app, e) {
      cursorDoc = AI.viewT.toDoc(app, e.x, e.y);

      if (drag && drag.pt && e.down) {
        var it = pen.it, p = drag.pt;
        var lp = localPt(app, it, e.x, e.y);

        /* Space — 아직 놓지 않은 앵커를 통째로 옮긴다 (일러스트레이터와 같다) */
        if (e.space) {
          if (drag.created) {
            var d = drag.moveBase || (drag.moveBase = { x: p.x, y: p.y, mx: lp.x, my: lp.y });
            p.x = d.x + (lp.x - d.mx); p.y = d.y + (lp.y - d.my);
            if (p.ox != null) { p.ox = p.x; p.oy = p.y; delete p.ox; delete p.oy; }
            app.invalidate();
          }
          return;
        }
        drag.moveBase = null;

        if (drag.closing) {
          /* 닫는 중 — 첫 점의 "들어오는" 방향선만 다듬는다.
             나가는 쪽은 이미 두 번째 앵커로 향하고 있으므로 건드리지 않는다. */
          var q = e.shift ? T.constrainAngle(p.x, p.y, lp.x, lp.y, 45) : lp;
          p.ix = q.x; p.iy = q.y;
          app.invalidate();
          return;
        }
        setHandle(app, p, lp, e, e.alt || drag.broke);
        drag.dragged = true;
        app.invalidate();
        return;
      }

      /* Illustrator 방식 펜 커서 상태 (× + − ○ / ^) */
      var C = AI.cursors, state = 'new';
      if (pen) {
        state = '';
        var sub = pen.it.subs[pen.si];
        if (sub && !sub.closed && sub.pts.length) {
          if (sub.pts.length > 1 && nearPt(app, pen.it, sub.pts[0], e.x, e.y)) state = 'close';
          else if (nearPt(app, pen.it, workEnd(sub), e.x, e.y)) state = 'corner';
          else if (endpointAt(app, e.x, e.y, { it: pen.it, si: pen.si, pi: sub.pts.length - 1 })) state = 'join';
        }
      } else {
        if (endpointAt(app, e.x, e.y)) state = 'join';
        else if (H.anchorAt(app, e.x, e.y, app.sel.length ? app.sel : null)) state = 'del';
        else if (H.segmentAt(app, e.x, e.y, app.sel.length ? app.sel : null)) state = 'add';
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
      /* Backspace — 방금 찍은 점을 물린다 */
      if (pen && (ev.key === 'Backspace' || ev.key === 'Delete')) {
        var sub = pen.it.subs[pen.si];
        if (sub.pts.length) {
          app.history.begin('앵커 되돌리기', app.doc);
          sub.pts.pop();
          if (sub.pts.length) {
            var end = workEnd(sub);
            delete end.ox; delete end.oy;       /* 다음 구간은 다시 직선부터 */
            app.history.commit();
            app.invalidate();
          } else {
            app.history.commit();
            endPath(app);
          }
        }
        return true;
      }
      return false;
    },

    drawUI: function (ctx, app) {
      if (!pen || !cursorDoc) return;
      var sub = pen.it.subs[pen.si];
      if (!sub || !sub.pts.length || sub.closed) return;
      var wm = M.mul(AI.viewT.matrix(app), Model.worldMatrix(app.doc, pen.it));
      var last = workEnd(sub);
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

      /* 방금 놓은 점의 방향선 — 일러스트레이터는 그리는 동안 이걸 보여 준다.
         (아직 아무것도 선택되지 않았으므로 앵커 렌더러가 그려 주지 않는다) */
      drawHandles(ctx, wm, last);
      if (drag && drag.pt && drag.pt !== last) drawHandles(ctx, wm, drag.pt);
      ctx.restore();
    }
  });

  function drawHandles(ctx, wm, p) {
    if (p.ix == null && p.ox == null) return;
    var a = M.apply(wm, p.x, p.y);
    ctx.save();
    ctx.strokeStyle = 'rgba(45,140,235,.9)';
    ctx.fillStyle = 'rgba(45,140,235,.9)';
    ctx.lineWidth = 1;
    ['i', 'o'].forEach(function (k) {
      var hx = k === 'i' ? p.ix : p.ox, hy = k === 'i' ? p.iy : p.oy;
      if (hx == null) return;
      var h = M.apply(wm, hx, hy);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(h.x, h.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(h.x, h.y, 2.6, 0, 6.2832);
      ctx.fill();
    });
    ctx.restore();
  }

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

  /* ---------------- 기준점 변환 (Shift+C) ----------------
     일러스트레이터의 고정점 도구는 두 가지 일을 한다.

       앵커를 누르면        방향선을 떼어 각진 점으로
       앵커를 눌러 끌면     대칭 방향선을 새로 만들어 부드러운 점으로
       방향선을 끌면        그쪽만 움직여 꺾인 점으로 (짝을 끊는다)

     세 번째가 이 도구의 핵심이다. 짝을 따라 움직이면 직접 선택 도구와
     다를 게 없다. */
  var conv = null;
  T.mk({
    id: 'convert', name: '고정점 도구', key: null, cursor: 'crosshair', direct: true,

    onDown: function (app, e) {
      /* 방향선이 앵커보다 먼저다 — 겹치면 방향선을 잡는 게 이 도구답다 */
      var hh = H.handleAt(app, e.x, e.y);
      if (hh) {
        Model.expandShape(hh.it);
        app.history.begin('방향선 분리', app.doc);
        var p2 = hh.it.subs[hh.si].pts[hh.pi];
        AI.sel.set(app, [hh.it]); AI.sel.clearPts(app); AI.sel.addPt(app, hh.it, hh.si, hh.pi);
        conv = { it: hh.it, p: p2, part: hh.part, si: hh.si, pi: hh.pi, single: true };
        app.invalidate();
        return;
      }
      var an = H.anchorAt(app, e.x, e.y);
      if (!an) return;
      Model.expandShape(an.it);
      app.history.begin('기준점 변환', app.doc);
      var p = an.it.subs[an.si].pts[an.pi];
      AI.sel.set(app, [an.it]); AI.sel.clearPts(app); AI.sel.addPt(app, an.it, an.si, an.pi);
      var had = p.ix != null || p.ox != null;
      if (had) { delete p.ix; delete p.iy; delete p.ox; delete p.oy; }
      conv = { it: an.it, p: p, si: an.si, pi: an.pi, wasSmooth: had, moved: false };
      app.invalidate();
    },

    onMove: function (app, e) {
      if (!conv) {
        var over = H.handleAt(app, e.x, e.y) || H.anchorAt(app, e.x, e.y);
        AI.cursors.set(app, over ? 'pointer' : 'crosshair');
        return;
      }
      if (!e.down) return;
      var d = AI.viewT.toDoc(app, e.x, e.y);
      var lp = M.apply(M.invert(Model.worldMatrix(app.doc, conv.it)), d.x, d.y);
      var p = conv.p;
      conv.moved = true;
      if (e.shift) lp = T.constrainAngle(p.x, p.y, lp.x, lp.y, 45);
      if (conv.single) {
        /* 잡은 쪽만 움직인다 — 반대쪽은 그대로 두어 꺾인 점이 된다 */
        if (conv.part === 'i') { p.ix = lp.x; p.iy = lp.y; }
        else { p.ox = lp.x; p.oy = lp.y; }
      } else {
        p.ox = lp.x; p.oy = lp.y;
        p.ix = 2 * p.x - lp.x; p.iy = 2 * p.y - lp.y;
      }
      app.invalidate();
      AI.ui && AI.ui.syncSelection && AI.ui.syncSelection(app);
    },

    onUp: function (app) {
      if (!conv) { app.history.abort(); return; }
      /* 누르기만 하고 안 끌었는데 원래 각진 점이었다면 바뀐 게 없다 */
      if (!conv.moved && !conv.single && !conv.wasSmooth) app.history.abort();
      else app.history.commit();
      conv = null;
      app.invalidate();
      AI.ui && AI.ui.syncAll && AI.ui.syncAll(app);
    }
  });

})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
