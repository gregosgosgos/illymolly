/* =========================================================================
   tools/select.js — 선택 도구 (V) / 그룹 선택 도구
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, M = AI.mat, R = AI.rect, Model = AI.model, Rn = AI.render, H = AI.hit, E = AI.edit, T = AI.tools;

  var st = null;

  function beginState(app, kind) {
    st = { kind: kind, moved: false, dup: false };
    st.orig = app.sel.map(function (it) { return it.m.slice(); });
    st.origSel = app.sel.slice();
    return st;
  }

  function commonDown(app, e, groupMode) {
    app.smart = [];
    /* 0) 라이브 모퉁이 위젯 */
    var cwHit = H.cornerWidgetAt(app, e.x, e.y);
    if (cwHit) {
      app.history.begin('모퉁이 반경', app.doc);
      st = { kind: 'corner', it: cwHit.item, pt: cwHit.pt, moved: false, r0: cwHit.item.shape.r || 0 };
      return;
    }
    /* 1) 바운딩 박스 핸들 */
    if (app.sel.length) {
      var hh = H.bboxHandleAt(app, e.x, e.y);
      if (hh) {
        app.history.begin(hh.rotate ? '회전' : '크기 조절', app.doc);
        beginState(app, hh.rotate ? 'rotate' : 'scale');
        st.handle = hh.index; st.frame = hh.frame;
        st.center = { x: (hh.frame.pts[0].x + hh.frame.pts[4].x) / 2, y: (hh.frame.pts[0].y + hh.frame.pts[4].y) / 2 };
        st.startAngle = Math.atan2(e.y - st.center.y, e.x - st.center.x);
        st.worldBounds = Rn.selectionBounds(app, true);
        st.singleFrame = hh.frame.rotated ? hh.frame : null;
        return;
      }
    }

    /* 2) 오브젝트 히트 */
    var hit = groupMode ? H.itemAt(app, e.x, e.y, true) : H.selectTarget(app, e.x, e.y);
    if (hit && groupMode) {
      /* 그룹 선택 도구: 클릭할 때마다 한 단계씩 상위 그룹으로 */
      var chain = H.ancestors(app.doc, hit);
      if (app.groupClickTarget === hit && app.groupClickLevel > 0) {
        hit = chain[Math.max(0, chain.length - 1 - app.groupClickLevel)] || chain[0];
        app.groupClickLevel++;
      } else { app.groupClickTarget = hit; app.groupClickLevel = 1; }
    }

    if (hit) {
      if (e.shift) {
        AI.sel.toggle(app, hit);
        app.keyObject = hit;
      } else if (!AI.sel.has(app, hit)) {
        AI.sel.set(app, [hit]);
        app.keyObject = hit;
      } else {
        app.keyObject = hit;
      }
      AI.sel.clearPts(app);
      app.history.begin('이동', app.doc);
      beginState(app, 'move');
      st.targets = E.collectSnapTargets(app, app.sel);
      st.startBounds = Rn.selectionBounds(app, true);
    } else {
      if (!e.shift) AI.sel.clear(app);
      st = { kind: 'marquee', start: { x: e.x, y: e.y }, additive: e.shift, base: app.sel.slice() };
      app.marquee = { x: e.x, y: e.y, x2: e.x, y2: e.y };
    }
    app.invalidate();
  }

  function commonMove(app, e) {
    if (!st) { hoverFeedback(app, e); return; }
    if (st.kind === 'marquee') {
      app.marquee = R.fromPts(st.start.x, st.start.y, e.x, e.y);
      var p1 = AI.viewT.toDoc(app, app.marquee.x, app.marquee.y);
      var p2 = AI.viewT.toDoc(app, app.marquee.x2, app.marquee.y2);
      var docRect = R.fromPts(p1.x, p1.y, p2.x, p2.y);
      var found = H.itemsInRect(app, docRect, false);
      AI.sel.set(app, st.additive ? st.base.concat(found.filter(function (f) { return st.base.indexOf(f) < 0; })) : found);
      app.invalidate();
      return;
    }
    if (st.kind === 'move') {
      var d = AI.viewT.toDoc(app, e.x, e.y), s = AI.viewT.toDoc(app, e.sx, e.sy);
      var dx = d.x - s.x, dy = d.y - s.y;
      if (!st.moved && Math.hypot(e.x - e.sx, e.y - e.sy) < 2) return;
      st.moved = true;
      if (e.alt && !st.dup) {
        /* Alt 드래그 = 복제 */
        restore(app);
        var copies = E.duplicate(app, 0, 0);
        st.dup = true;
        st.orig = app.sel.map(function (it) { return it.m.slice(); });
        st.origSel = app.sel.slice();
      }
      if (e.shift) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0;
      }
      restore(app);
      /* 스냅 */
      app.smart = [];
      if (app.prefs.smart && st.startBounds && !R.isEmpty(st.startBounds)) {
        var b = { x: st.startBounds.x + dx, y: st.startBounds.y + dy, x2: st.startBounds.x2 + dx, y2: st.startBounds.y2 + dy };
        var snap = E.snapBounds(app, b, st.targets, 6 / app.view.scale);
        dx += snap.dx; dy += snap.dy;
        var moved = { x: b.x + snap.dx, y: b.y + snap.dy, x2: b.x2 + snap.dx, y2: b.y2 + snap.dy };
        app.smart = snap.guides.map(function (g) { g.moving = moved; return g; });
      }
      E.move(app, dx, dy);
      app.invalidate();
      AI.ui && AI.ui.syncSelection && AI.ui.syncSelection(app);
      return;
    }
    if (st.kind === 'corner') {
      st.moved = true;
      var it = st.it, sh = it.shape;
      var inv = M.invert(Model.worldMatrix(app.doc, it));
      var d0 = AI.viewT.toDoc(app, e.x, e.y);
      var lp = M.apply(inv, d0.x, d0.y);
      var lim = Math.min(Math.abs(sh.w), Math.abs(sh.h)) / 2;
      var r = Math.min(Math.abs(lp.x - st.pt.cx), Math.abs(lp.y - st.pt.cy));
      sh.r = U.clamp(r, 0, lim);
      Model.buildShape(it);
      app.hudText = '반경 ' + U.fmt(sh.r);
      app.invalidate();
      AI.ui && AI.ui.buildToolOptions && AI.ui.buildToolOptions(app);
      return;
    }
    if (st.kind === 'scale') { doScale(app, e); return; }
    if (st.kind === 'rotate') { doRotate(app, e); return; }
  }

  function restore(app) {
    for (var i = 0; i < st.origSel.length; i++) st.origSel[i].m = st.orig[i].slice();
  }

  var OPP = [4, 5, 6, 7, 0, 1, 2, 3];

  function doScale(app, e) {
    st.moved = true;
    restore(app);
    var f = st.frame, hi = st.handle;
    if (st.singleFrame && app.sel.length === 1) {
      var it = app.sel[0];
      var b = st.singleFrame.local;
      var lm = st.singleFrame.m;         /* local -> screen */
      var inv = M.invert(lm);
      var mouse = M.apply(inv, e.x, e.y);
      var corners = localHandlePts(b);
      var anchor = e.alt ? { x: (b.x + b.x2) / 2, y: (b.y + b.y2) / 2 } : corners[OPP[hi]];
      var hp = corners[hi];
      var sx = 1, sy = 1;
      var horiz = (hi === 3 || hi === 7 || hi === 0 || hi === 2 || hi === 4 || hi === 6);
      var vert = (hi === 1 || hi === 5 || hi === 0 || hi === 2 || hi === 4 || hi === 6);
      if (horiz && Math.abs(hp.x - anchor.x) > 1e-6) sx = (mouse.x - anchor.x) / (hp.x - anchor.x);
      if (vert && Math.abs(hp.y - anchor.y) > 1e-6) sy = (mouse.y - anchor.y) / (hp.y - anchor.y);
      if (e.shift) {
        if (horiz && vert) { var k = Math.max(Math.abs(sx), Math.abs(sy)); sx = U.sign(sx) * k; sy = U.sign(sy) * k; }
        else if (horiz) sy = sx; else if (vert) sx = sy;
      }
      it.m = M.mul(st.orig[0], M.around(M.scale(sx, sy), anchor.x, anchor.y));
    } else {
      var wb = st.worldBounds;
      var wpts = worldHandlePts(wb);
      var anc = e.alt ? { x: R.cx(wb), y: R.cy(wb) } : wpts[OPP[hi]];
      var hpt = wpts[hi];
      var mw = AI.viewT.toDoc(app, e.x, e.y);
      var sx2 = 1, sy2 = 1;
      var horiz2 = (hi === 3 || hi === 7 || hi === 0 || hi === 2 || hi === 4 || hi === 6);
      var vert2 = (hi === 1 || hi === 5 || hi === 0 || hi === 2 || hi === 4 || hi === 6);
      if (horiz2 && Math.abs(hpt.x - anc.x) > 1e-6) sx2 = (mw.x - anc.x) / (hpt.x - anc.x);
      if (vert2 && Math.abs(hpt.y - anc.y) > 1e-6) sy2 = (mw.y - anc.y) / (hpt.y - anc.y);
      if (e.shift) {
        if (horiz2 && vert2) { var k2 = Math.max(Math.abs(sx2), Math.abs(sy2)); sx2 = U.sign(sx2) * k2; sy2 = U.sign(sy2) * k2; }
        else if (horiz2) sy2 = sx2; else if (vert2) sx2 = sy2;
      }
      E.transformSelection(app, M.around(M.scale(sx2, sy2), anc.x, anc.y));
    }
    app.invalidate();
    AI.ui && AI.ui.syncSelection && AI.ui.syncSelection(app);
  }

  function localHandlePts(b) {
    var cx = (b.x + b.x2) / 2, cy = (b.y + b.y2) / 2;
    return [{ x: b.x, y: b.y }, { x: cx, y: b.y }, { x: b.x2, y: b.y }, { x: b.x2, y: cy },
    { x: b.x2, y: b.y2 }, { x: cx, y: b.y2 }, { x: b.x, y: b.y2 }, { x: b.x, y: cy }];
  }
  function worldHandlePts(b) { return localHandlePts(b); }

  function doRotate(app, e) {
    st.moved = true;
    restore(app);
    var a = Math.atan2(e.y - st.center.y, e.x - st.center.x);
    var da = a - st.startAngle;
    if (e.shift) da = Math.round(da / (Math.PI / 12)) * (Math.PI / 12);
    var cw = AI.viewT.toDoc(app, st.center.x, st.center.y);
    E.transformSelection(app, M.around(M.rotate(da), cw.x, cw.y));
    app.rotateFeedback = U.round(U.deg(da), 1);
    app.invalidate();
    AI.ui && AI.ui.syncSelection && AI.ui.syncSelection(app);
  }

  function commonUp(app, e) {
    if (!st) return;
    if (st.kind === 'marquee') { app.marquee = null; app.history.abort(); }
    else if (st.moved) app.history.commit();
    else app.history.abort();
    app.smart = [];
    app.hudText = null;
    app.rotateFeedback = null;
    app.hoverItem = null;
    st = null;
    app.invalidate();
    AI.ui && AI.ui.syncSelection && AI.ui.syncSelection(app);
  }

  function hoverFeedback(app, e) {
    var C = AI.cursors;
    if (app.sel.length) {
      var hh = H.bboxHandleAt(app, e.x, e.y);
      if (hh) {
        var f = hh.frame;
        var cx = (f.pts[0].x + f.pts[4].x) / 2, cy = (f.pts[0].y + f.pts[4].y) / 2;
        var p = f.pts[hh.index];
        var ang = U.deg(Math.atan2(p.y - cy, p.x - cx));
        C.set(app, hh.rotate ? C.rotateAt(ang) : C.resizeAt(ang));
        return;
      }
    }
    if (H.cornerWidgetAt(app, e.x, e.y)) { C.set(app, 'pointer'); return; }
    var hit = H.itemAt(app, e.x, e.y, false);
    if (app.prefs.smart) {
      if (app.hoverItem !== hit) { app.hoverItem = hit; app.invalidate(); }
    } else if (app.hoverItem) { app.hoverItem = null; app.invalidate(); }
    if (e.shift && hit) C.set(app, C.arrowPlus());
    else C.set(app, C.forTool(app.tool) || C.arrow());
  }

  T.mk({
    id: 'select', name: '선택 도구', key: 'v', cursor: 'default',
    onDown: function (app, e) { commonDown(app, e, false); },
    onMove: function (app, e) { commonMove(app, e); },
    onUp: function (app, e) { commonUp(app, e); },
    onDblClick: function (app, e) {
      var deep = H.itemAt(app, e.x, e.y, true);
      if (!deep) { AI.commands.run('exitIsolation'); return; }
      if (deep.type === 'text') { AI.tools.setTool(app, 'type', true); AI.tools.get('type').editItem(app, deep); return; }
      var top = H.selectTarget(app, e.x, e.y);
      if (top && top.type === 'group') {
        app.isolation = (app.isolation || []).concat([top]);
        var inner = H.itemAt(app, e.x, e.y, true);
        var chain = H.ancestors(app.doc, inner);
        var i = chain.indexOf(top);
        AI.sel.set(app, [chain[i + 1] || inner]);
        U.toast('격리 모드: ' + top.name);
        app.invalidate();
        AI.ui.syncAll(app);
      }
    },
    drawUI: function (ctx, app) {
      if (app.hudText && st && st.kind === 'corner') {
        ctx.save();
        ctx.font = '11px sans-serif';
        var w = ctx.measureText(app.hudText).width + 10;
        ctx.fillStyle = 'rgba(0,0,0,.78)';
        ctx.fillRect(st.pt.x + 10, st.pt.y - 22, w, 16);
        ctx.fillStyle = '#fff';
        ctx.fillText(app.hudText, st.pt.x + 15, st.pt.y - 10);
        ctx.restore();
      }
      if (app.rotateFeedback != null && st && st.kind === 'rotate') {
        ctx.save();
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000';
        ctx.font = '11px sans-serif';
        var tx = st.center.x + 14, ty = st.center.y - 14;
        var s = app.rotateFeedback + '°';
        ctx.fillStyle = 'rgba(0,0,0,.75)';
        ctx.fillRect(tx - 3, ty - 12, ctx.measureText(s).width + 8, 16);
        ctx.fillStyle = '#fff'; ctx.fillText(s, tx + 1, ty);
        ctx.restore();
      }
    }
  });

  T.mk({
    id: 'groupselect', name: '그룹 선택 도구', key: null, cursor: 'default',
    onDown: function (app, e) { commonDown(app, e, true); },
    onMove: function (app, e) { commonMove(app, e); },
    onUp: function (app, e) { commonUp(app, e); },
    deactivate: function (app) { app.groupClickTarget = null; app.groupClickLevel = 0; }
  });

  /* 다른 도구에서 재사용 */
  T.selectHelpers = { commonDown: commonDown, commonMove: commonMove, commonUp: commonUp };
})(window.AI);
