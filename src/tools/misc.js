/* =========================================================================
   tools/misc.js — 확대(Z) / 손(H) / 스포이드(I) / 그레이디언트(G)
                    / 가위(C) / 대지(Shift+O) / 자동 선택(Y)
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, M = AI.mat, R = AI.rect, Model = AI.model, T = AI.tools, H = AI.hit, G = AI.geom, Col = AI.color, E = AI.edit, Rn = AI.render;

  var st = null;

  /* ---------------- 확대 / 축소 ---------------- */
  T.mk({
    id: 'zoom', name: '확대 도구', key: 'z', cursor: 'zoom-in',
    onDown: function (app, e) { st = { x: e.x, y: e.y, moved: false }; },
    onMove: function (app, e) {
      if (!st || !e.down) { AI.cursors.set(app, e.alt ? AI.cursors.zoomOut() : AI.cursors.zoomIn()); return; }
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
    onDown: function (app, e) { st = { x: e.x, y: e.y }; AI.cursors.set(app, AI.cursors.hand(true)); },
    onMove: function (app, e) {
      if (!st || !e.down) return;
      AI.viewT.pan(app, e.x - st.x, e.y - st.y);
      st.x = e.x; st.y = e.y;
    },
    onUp: function (app) { st = null; AI.cursors.set(app, AI.cursors.hand(false)); }
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

  /* ---------------- 그레이디언트 (주석자 포함) ---------------- */
  /* 일러스트레이터처럼 캔버스 위에 막대를 띄우고, 시작점 · 끝점 · 정지점을
     직접 끌어 각도 · 길이 · 위치를 정한다. 기하는 paint.p0 / paint.p1 (로컬 좌표). */
  function gradTarget(app) {
    for (var i = 0; i < app.sel.length; i++) {
      var it = app.sel[i];
      if (it.type !== 'group' && it.fill && (it.fill.type === 'linear' || it.fill.type === 'radial')) return it;
    }
    return null;
  }
  function gradEnds(app, it) {
    var g = it.fill;
    var b = Rn.localBounds(it);
    var p0, p1;
    if (g.p0 && g.p1) { p0 = g.p0; p1 = g.p1; }
    else {
      var cx = (b.x + b.x2) / 2, cy = (b.y + b.y2) / 2;
      var a = U.rad(g.angle || 0);
      var len = (Math.abs(Math.cos(a)) * (b.x2 - b.x) + Math.abs(Math.sin(a)) * (b.y2 - b.y)) / 2;
      if (g.type === 'radial') { p0 = { x: cx, y: cy }; p1 = { x: cx + len, y: cy }; }
      else { p0 = { x: cx - Math.cos(a) * len, y: cy - Math.sin(a) * len }; p1 = { x: cx + Math.cos(a) * len, y: cy + Math.sin(a) * len }; }
    }
    var wm = M.mul(AI.viewT.matrix(app), Model.worldMatrix(app.doc, it));
    return { p0: p0, p1: p1, s0: M.apply(wm, p0.x, p0.y), s1: M.apply(wm, p1.x, p1.y), wm: wm };
  }
  function setEnds(it, p0, p1) {
    it.fill.p0 = { x: p0.x, y: p0.y };
    it.fill.p1 = { x: p1.x, y: p1.y };
    it.fill.angle = U.deg(Math.atan2(p1.y - p0.y, p1.x - p0.x));
    AI.appearance.pushDown(it);
  }

  T.mk({
    id: 'gradient', name: '그레이디언트 도구', key: 'g', cursor: 'crosshair',
    onDown: function (app, e) {
      if (!app.sel.length) { U.toast('오브젝트를 선택하세요'); return; }
      var it = gradTarget(app);
      /* 주석자 손잡이를 잡았는지 먼저 확인한다 */
      if (it) {
        var g = gradEnds(app, it);
        if (U.dist(e.x, e.y, g.s0.x, g.s0.y) < 8) {
          app.history.begin('그레이디언트', app.doc);
          st = { mode: 'p0', it: it, g: g }; return;
        }
        if (U.dist(e.x, e.y, g.s1.x, g.s1.y) < 8) {
          app.history.begin('그레이디언트', app.doc);
          st = { mode: 'p1', it: it, g: g }; return;
        }
        var si = stopAt(app, it, g, e.x, e.y);
        if (si >= 0) {
          app.history.begin('그레이디언트 정지점', app.doc);
          st = { mode: 'stop', it: it, g: g, si: si }; return;
        }
      }
      app.history.begin('그레이디언트', app.doc);
      st = { mode: 'draw', start: AI.viewT.toDoc(app, e.x, e.y), moved: false };
      app.sel.forEach(function (o) {
        if (o.type === 'group') return;
        if (!o.fill || o.fill.type === 'none' || o.fill.type === 'solid') {
          var base = (o.fill && o.fill.type === 'solid') ? o.fill.color : '#ffffff';
          o.fill = Col.gradient('linear', base, '#000000');
          AI.appearance.pushDown(o);
        }
      });
      app.invalidate();
    },
    onMove: function (app, e) {
      if (!st || !e.down) return;
      if (st.mode === 'draw') {
        var d = AI.viewT.toDoc(app, e.x, e.y);
        var ang = Math.atan2(d.y - st.start.y, d.x - st.start.x);
        if (e.shift) ang = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
        var dist = U.dist(st.start.x, st.start.y, d.x, d.y);
        st.moved = true;
        st.end = { x: st.start.x + Math.cos(ang) * dist, y: st.start.y + Math.sin(ang) * dist };
        app.sel.forEach(function (it) {
          if (!it.fill || (it.fill.type !== 'linear' && it.fill.type !== 'radial')) return;
          var inv = M.invert(Model.worldMatrix(app.doc, it));
          setEnds(it, M.apply(inv, st.start.x, st.start.y), M.apply(inv, st.end.x, st.end.y));
        });
      } else if (st.mode === 'p0' || st.mode === 'p1') {
        var inv2 = M.invert(st.g.wm);
        var lp = M.apply(inv2, e.x, e.y);
        if (st.mode === 'p0') setEnds(st.it, lp, st.g.p1);
        else {
          var p1 = lp;
          if (e.shift) {
            var a2 = Math.round(Math.atan2(lp.y - st.g.p0.y, lp.x - st.g.p0.x) / (Math.PI / 4)) * (Math.PI / 4);
            var L = U.dist(st.g.p0.x, st.g.p0.y, lp.x, lp.y);
            p1 = { x: st.g.p0.x + Math.cos(a2) * L, y: st.g.p0.y + Math.sin(a2) * L };
          }
          setEnds(st.it, st.g.p0, p1);
        }
      } else if (st.mode === 'stop') {
        var t = projectT(st.g, e.x, e.y);
        st.it.fill.stops[st.si].t = U.clamp(t, 0, 1);
        st.it.fill.stops.sort(function (a, b) { return a.t - b.t; });
        AI.appearance.pushDown(st.it);
      }
      app.invalidate();
      AI.ui && AI.ui.syncStyle && AI.ui.syncStyle(app);
    },
    onUp: function (app) {
      if (!st) return;
      app.history.commit();
      st = null;
      app.invalidate();
      AI.ui && AI.ui.syncAll && AI.ui.syncAll(app);
    },
    onDblClick: function (app, e) {
      /* 막대를 더블클릭하면 그 위치에 정지점을 추가한다 */
      var it = gradTarget(app);
      if (!it) return;
      var g = gradEnds(app, it);
      var t = projectT(g, e.x, e.y);
      if (t < -0.02 || t > 1.02) return;
      app.history.begin('정지점 추가', app.doc);
      it.fill.stops.push({ t: U.clamp(t, 0, 1), color: Col.sampleGradient ? Col.sampleGradient(it.fill, t) : '#888888', alpha: 1 });
      it.fill.stops.sort(function (a, b) { return a.t - b.t; });
      AI.appearance.pushDown(it);
      app.history.commit();
      app.invalidate();
      AI.ui.syncAll(app);
    },
    drawUI: function (ctx, app) {
      var it = gradTarget(app);
      if (!it) return;
      var g = gradEnds(app, it);
      ctx.save();
      ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(g.s0.x, g.s0.y); ctx.lineTo(g.s1.x, g.s1.y); ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(g.s0.x, g.s0.y); ctx.lineTo(g.s1.x, g.s1.y); ctx.stroke();
      /* 시작점(원) · 끝점(사각) */
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(g.s0.x, g.s0.y, 5, 0, 6.2832); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.rect(g.s1.x - 5, g.s1.y - 5, 10, 10); ctx.fill(); ctx.stroke();
      /* 정지점 */
      it.fill.stops.forEach(function (sp) {
        var p = lerpPt(g.s0, g.s1, sp.t);
        ctx.fillStyle = Col.toCss(sp.color, sp.alpha);
        ctx.beginPath(); ctx.arc(p.x, p.y, 4.5, 0, 6.2832); ctx.fill();
        ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, 5.8, 0, 6.2832); ctx.stroke();
      });
      ctx.restore();
    }
  });

  function lerpPt(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
  function projectT(g, x, y) {
    var dx = g.s1.x - g.s0.x, dy = g.s1.y - g.s0.y, l2 = dx * dx + dy * dy;
    if (l2 < 1e-9) return 0;
    return ((x - g.s0.x) * dx + (y - g.s0.y) * dy) / l2;
  }
  function stopAt(app, it, g, x, y) {
    for (var i = 0; i < it.fill.stops.length; i++) {
      var p = lerpPt(g.s0, g.s1, it.fill.stops[i].t);
      if (U.dist(x, y, p.x, p.y) < 7) return i;
    }
    return -1;
  }

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
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
