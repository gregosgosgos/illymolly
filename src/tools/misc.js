/* =========================================================================
   tools/misc.js — 확대(Z) / 손(H) / 스포이드(I) / 그레이디언트(G)
                    / 가위(C) / 대지(Shift+O) / 자동 선택(Y)
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, M = AI.mat, R = AI.rect, Model = AI.model, T = AI.tools, H = AI.hit, G = AI.geom, Col = AI.color, E = AI.edit;

  var st = null;

  /* ---------------- 확대 / 축소 ---------------- */
  T.mk({
    id: 'zoom', name: '확대 도구', key: 'z', cursor: 'zoom-in',
    onDown: function (app, e) { st = { x: e.x, y: e.y, moved: false }; },
    onMove: function (app, e) {
      if (!st || !e.down) { app.canvas.style.cursor = e.alt ? 'zoom-out' : 'zoom-in'; return; }
      if (Math.hypot(e.x - st.x, e.y - st.y) > 3) { st.moved = true; app.marquee = R.fromPts(st.x, st.y, e.x, e.y); app.invalidate(); }
    },
    onUp: function (app, e) {
      if (!st) return;
      if (st.moved && app.marquee) {
        var p1 = AI.viewT.toDoc(app, app.marquee.x, app.marquee.y);
        var p2 = AI.viewT.toDoc(app, app.marquee.x2, app.marquee.y2);
        AI.viewT.fitRect(app, R.fromPts(p1.x, p1.y, p2.x, p2.y), 10);
      } else {
        AI.viewT.zoomStep(app, e.alt ? -1 : 1, e.x, e.y);
      }
      app.marquee = null; st = null; app.invalidate();
    }
  });

  /* ---------------- 손 ---------------- */
  T.mk({
    id: 'hand', name: '손 도구', key: 'h', cursor: 'grab',
    onDown: function (app, e) { st = { x: e.x, y: e.y }; app.canvas.style.cursor = 'grabbing'; },
    onMove: function (app, e) {
      if (!st || !e.down) return;
      AI.viewT.pan(app, e.x - st.x, e.y - st.y);
      st.x = e.x; st.y = e.y;
    },
    onUp: function (app) { st = null; app.canvas.style.cursor = 'grab'; }
  });

  /* ---------------- 스포이드 ---------------- */
  T.mk({
    id: 'eyedropper', name: '스포이드 도구', key: 'i', cursor: 'crosshair',
    onDown: function (app, e) {
      var hit = H.itemAt(app, e.x, e.y, true);
      if (!hit) return;
      var src = hit;
      if (src.type === 'group') return;
      if (e.alt) {
        /* Alt = 현재 스타일을 대상에 적용 */
        app.history.begin('스타일 적용', app.doc);
        src.fill = U.deepCopy(app.fill);
        E.applyStrokeProp(app, 'noop', 0);
        app.history.commit();
      } else {
        app.fill = U.deepCopy(src.fill || Col.none());
        app.stroke = src.stroke && src.stroke.type !== 'none'
          ? Col.solid(src.stroke.color, src.stroke.alpha) : Col.none();
        app.strokeWidth = src.stroke ? src.stroke.width : 1;
        if (app.sel.length) {
          app.history.begin('스타일 적용', app.doc);
          app.sel.forEach(function (it) {
            it.fill = U.deepCopy(src.fill);
            it.stroke = U.deepCopy(src.stroke);
          });
          app.history.commit();
        }
        AI.ui && AI.ui.syncStyle && AI.ui.syncStyle(app);
      }
      app.invalidate();
    }
  });

  /* ---------------- 그레이디언트 ---------------- */
  T.mk({
    id: 'gradient', name: '그레이디언트 도구', key: 'g', cursor: 'crosshair',
    onDown: function (app, e) {
      if (!app.sel.length) { U.toast('오브젝트를 선택하세요'); return; }
      app.history.begin('그레이디언트', app.doc);
      st = { start: AI.viewT.toDoc(app, e.x, e.y), moved: false };
      app.sel.forEach(function (it) {
        if (it.type === 'group') return;
        if (!it.fill || it.fill.type === 'none' || it.fill.type === 'solid') {
          var base = (it.fill && it.fill.type === 'solid') ? it.fill.color : '#ffffff';
          it.fill = Col.gradient('linear', base, '#000000');
        }
      });
      app.invalidate();
    },
    onMove: function (app, e) {
      if (!st || !e.down) return;
      var d = AI.viewT.toDoc(app, e.x, e.y);
      var ang = Math.atan2(d.y - st.start.y, d.x - st.start.x);
      if (e.shift) ang = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
      st.moved = true;
      st.end = d; st.angle = ang;
      app.sel.forEach(function (it) {
        if (it.fill && (it.fill.type === 'linear' || it.fill.type === 'radial')) it.fill.angle = U.deg(ang);
      });
      app.invalidate();
      AI.ui && AI.ui.syncStyle && AI.ui.syncStyle(app);
    },
    onUp: function (app) { if (st) { app.history.commit(); st = null; app.invalidate(); } },
    drawUI: function (ctx, app) {
      if (!st || !st.end) return;
      var a = AI.viewT.toScreen(app, st.start.x, st.start.y);
      var b = AI.viewT.toScreen(app, st.end.x, st.end.y);
      ctx.save();
      ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000';
      ctx.beginPath(); ctx.arc(a.x, a.y, 5, 0, 6.2832); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.rect(b.x - 5, b.y - 5, 10, 10); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  });

  /* ---------------- 가위 ---------------- */
  T.mk({
    id: 'scissors', name: '가위 도구', key: 'c', cursor: 'crosshair',
    onDown: function (app, e) {
      var seg = H.segmentAt(app, e.x, e.y);
      var an = H.anchorAt(app, e.x, e.y);
      if (!seg && !an) return;
      app.history.begin('패스 자르기', app.doc);
      var it, si, pi;
      if (an) { it = an.it; si = an.si; pi = an.pi; }
      else {
        it = seg.it; si = seg.sub;
        Model.expandShape(it);
        var np = G.insertAnchor(it.subs[si], seg.seg, seg.t);
        pi = it.subs[si].pts.indexOf(np);
      }
      Model.expandShape(it);
      var sub = it.subs[si];
      if (sub.closed) {
        sub.closed = false;
        var rotated = sub.pts.slice(pi).concat(sub.pts.slice(0, pi));
        rotated.push(U.deepCopy(rotated[0]));
        sub.pts = rotated;
      } else if (pi > 0 && pi < sub.pts.length - 1) {
        var a = sub.pts.slice(0, pi + 1);
        var b = sub.pts.slice(pi);
        it.subs.splice(si, 1, { closed: false, pts: a }, { closed: false, pts: U.deepCopy(b) });
      }
      AI.sel.set(app, [it]);
      AI.sel.clearPts(app);
      app.history.commit();
      app.invalidate();
    }
  });

  /* ---------------- 자동 선택 ---------------- */
  T.mk({
    id: 'magicwand', name: '자동 선택 도구', key: 'y', cursor: 'crosshair',
    onDown: function (app, e) {
      var hit = H.itemAt(app, e.x, e.y, true);
      if (!hit) { AI.sel.clear(app); app.invalidate(); return; }
      var key = hit.fill ? (hit.fill.type + ':' + (hit.fill.color || '')) : 'none';
      var found = [];
      Model.walk(app.doc, function (it) {
        if (it.type === 'group') return;
        var k = it.fill ? (it.fill.type + ':' + (it.fill.color || '')) : 'none';
        if (k === key) found.push(it);
      });
      AI.sel.set(app, e.shift ? app.sel.concat(found.filter(function (f) { return app.sel.indexOf(f) < 0; })) : found);
      app.invalidate();
      U.toast(found.length + '개 선택됨');
    }
  });

  /* ---------------- 대지 ---------------- */
  T.mk({
    id: 'artboard', name: '대지 도구', key: null, cursor: 'crosshair',
    activate: function (app) { app.artboardMode = true; },
    deactivate: function (app) { app.artboardMode = false; },
    onDown: function (app, e) {
      var d = AI.viewT.toDoc(app, e.x, e.y);
      /* 기존 대지 클릭 */
      for (var i = app.doc.artboards.length - 1; i >= 0; i--) {
        var ab = app.doc.artboards[i];
        if (R.has({ x: ab.x, y: ab.y, x2: ab.x + ab.w, y2: ab.y + ab.h }, d.x, d.y)) {
          app.doc.activeArtboard = i;
          st = { move: true, ab: ab, start: d, ox: ab.x, oy: ab.y };
          app.history.begin('대지 이동', app.doc);
          app.invalidate();
          return;
        }
      }
      app.history.begin('대지 만들기', app.doc);
      st = { create: true, start: d, ab: null };
    },
    onMove: function (app, e) {
      if (!st || !e.down) return;
      var d = AI.viewT.toDoc(app, e.x, e.y);
      if (st.move) {
        st.ab.x = st.ox + (d.x - st.start.x);
        st.ab.y = st.oy + (d.y - st.start.y);
      } else {
        var r = R.fromPts(st.start.x, st.start.y, d.x, d.y);
        if (R.w(r) < 2 || R.h(r) < 2) return;
        if (!st.ab) {
          st.ab = { id: U.uid('AB'), name: '대지 ' + (app.doc.artboards.length + 1), x: r.x, y: r.y, w: R.w(r), h: R.h(r) };
          app.doc.artboards.push(st.ab);
          app.doc.activeArtboard = app.doc.artboards.length - 1;
        }
        st.ab.x = r.x; st.ab.y = r.y; st.ab.w = R.w(r); st.ab.h = R.h(r);
      }
      app.invalidate();
    },
    onUp: function (app) {
      if (!st) return;
      if (st.ab) app.history.commit(); else app.history.abort();
      st = null;
      AI.ui && AI.ui.syncStatus && AI.ui.syncStatus(app);
      app.invalidate();
    }
  });
})(window.AI);
