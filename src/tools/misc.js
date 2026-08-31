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

    /* 일러스트레이터의 스포이드는 세 가지로 쓴다.
         그냥 클릭   대상의 모양(칠·획 전부)을 가져온다 — 선택이 있으면 거기 바로 입힌다
         Shift+클릭  색만 가져온다 (두께 · 점선 · 화살표는 건드리지 않는다)
         Alt+클릭    반대로, 지금 들고 있는 모양을 그 대상에 입힌다 */
    onDown: function (app, e) {
      var src = H.itemAt(app, e.x, e.y, true);
      if (!src || src.type === 'group') return;

      /* Alt — 지금 스타일을 대상에 입힌다 */
      if (e.alt) {
        app.history.begin('스타일 적용', app.doc);
        src.fill = U.deepCopy(app.fill || Col.none());
        var ns = Model.defaultStroke();
        ns.width = app.strokeWidth || 1;
        ns.cap = app.strokeCap || 'butt';
        ns.join = app.strokeJoin || 'miter';
        ns.align = app.strokeAlign || 'center';
        ns.dash = (app.strokeDash || []).slice();
        if (app.stroke && app.stroke.type !== 'none') {
          Object.keys(app.stroke).forEach(function (k) { ns[k] = U.deepCopy(app.stroke[k]); });
        }
        src.stroke = ns;
        app.history.commit();
        app.invalidate();
        AI.ui && AI.ui.syncAll && AI.ui.syncAll(app);
        U.toast('스타일 적용: ' + (src.name || src.type));
        return;
      }

      /* 가져오기 — Shift 면 색만 */
      var onlyColor = e.shift;
      app.fill = U.deepCopy(src.fill || Col.none());
      if (!onlyColor) {
        app.stroke = src.stroke && src.stroke.type !== 'none'
          ? U.deepCopy(src.stroke) : Col.none();
        if (src.stroke) {
          app.strokeWidth = src.stroke.width;
          app.strokeCap = src.stroke.cap;
          app.strokeJoin = src.stroke.join;
          app.strokeAlign = src.stroke.align;
          app.strokeDash = (src.stroke.dash || []).slice();
        }
      } else if (src.stroke && src.stroke.type !== 'none') {
        app.stroke = Col.solid(src.stroke.color, src.stroke.alpha);
      }

      if (app.sel.length) {
        app.history.begin(onlyColor ? '색 적용' : '스타일 적용', app.doc);
        app.sel.forEach(function (it) {
          if (it.type === 'group') return;
          it.fill = U.deepCopy(src.fill);
          if (onlyColor) {
            /* 색만 — 두께 · 점선 · 화살표는 그대로 둔다 */
            if (it.stroke && src.stroke && src.stroke.type !== 'none') {
              it.stroke.type = 'solid';
              it.stroke.color = src.stroke.color;
              it.stroke.alpha = src.stroke.alpha;
            }
          } else {
            it.stroke = U.deepCopy(src.stroke);
          }
        });
        app.history.commit();
      }
      AI.ui && AI.ui.syncStyle && AI.ui.syncStyle(app);
      AI.ui && AI.ui.syncAll && AI.ui.syncAll(app);
      app.invalidate();
      U.toast(onlyColor ? '색 가져오기' : '스타일 가져오기');
    },

    onMove: function (app, e) {
      AI.cursors.set(app, AI.cursors.eyedropper(e.alt));
    }
  });

  /* ---------------- 그레이디언트 (주석자 포함) ---------------- */
  /* 일러스트레이터처럼 캔버스 위에 막대를 띄우고, 시작점 · 끝점 · 정지점을
     직접 끌어 각도 · 길이 · 위치를 정한다. 기하는 paint.p0 / paint.p1 (로컬 좌표). */
  function gradTarget(app) {
    for (var i = 0; i < app.sel.length; i++) {
      var it = app.sel[i];
      if (it.type !== 'group' && Col.isGradient(it.fill)) return it;
    }
    return null;
  }
  /* 자유형 그레이디언트 — 색 점을 화면 좌표로 */
  function ffTarget(app) {
    var it = gradTarget(app);
    return (it && it.fill.type === 'freeform') ? it : null;
  }
  function ffPoints(app, it) {
    var wm = M.mul(AI.viewT.matrix(app), Model.worldMatrix(app.doc, it));
    return {
      wm: wm,
      pts: (it.fill.stops || []).map(function (sp, i) {
        var q = M.apply(wm, sp.x, sp.y);
        return { x: q.x, y: q.y, i: i, sp: sp };
      })
    };
  }
  function ffHit(app, it, x, y) {
    var g = ffPoints(app, it);
    for (var i = g.pts.length - 1; i >= 0; i--) {
      if (U.dist(g.pts[i].x, g.pts[i].y, x, y) <= 8) return { g: g, hit: g.pts[i] };
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
      /* 자유형 — 색 점을 잡아 끌거나, Alt 로 지운다 */
      var ffIt = ffTarget(app);
      if (ffIt) {
        var fh = ffHit(app, ffIt, e.x, e.y);
        if (fh) {
          if (e.alt) {
            if (ffIt.fill.stops.length <= 1) { U.toast('색 점은 최소 1개 필요합니다'); return; }
            app.history.begin('색 점 삭제', app.doc);
            ffIt.fill.stops.splice(fh.hit.i, 1);
            (ffIt.fill.lines || []).forEach(function (ln, li) {
              ffIt.fill.lines[li] = ln.filter(function (k) { return k !== fh.hit.i; })
                .map(function (k) { return k > fh.hit.i ? k - 1 : k; });
            });
            AI.appearance.pushDown(ffIt);
            app.history.commit();
            app.invalidate();
            AI.ui.syncAll(app);
            return;
          }
          app.history.begin('색 점 이동', app.doc);
          st = { mode: 'ffpt', it: ffIt, g: fh.g, si: fh.hit.i };
          return;
        }
        /* 빈 곳을 끌면 아무 일도 하지 않는다 (더블클릭으로 점 추가) */
        st = { mode: 'none' };
        return;
      }
      /* 주석자 손잡이를 잡았는지 먼저 확인한다.
         양 끝은 손잡이와 정지점이 겹쳐 있다 — 일러스트레이터처럼 정지점은
         막대 아래쪽에 그리므로, 아래를 누르면 정지점이 먼저 잡힌다. */
      if (it) {
        var g = gradEnds(app, it);
        var siEnd = stopAt(app, it, g, e.x, e.y);
        if (siEnd < 0 && U.dist(e.x, e.y, g.s0.x, g.s0.y) < 8) {
          app.history.begin('그레이디언트', app.doc);
          st = { mode: 'p0', it: it, g: g }; return;
        }
        if (siEnd < 0 && U.dist(e.x, e.y, g.s1.x, g.s1.y) < 8) {
          app.history.begin('그레이디언트', app.doc);
          st = { mode: 'p1', it: it, g: g }; return;
        }
        var si = siEnd >= 0 ? siEnd : stopAt(app, it, g, e.x, e.y);
        if (si >= 0) {
          /* Alt+드래그 = 정지점 복제 (일러스트레이터와 같다) */
          if (e.alt) {
            app.history.begin('정지점 복제', app.doc);
            var src = it.fill.stops[si];
            var dup = { t: src.t, color: src.color, alpha: src.alpha == null ? 1 : src.alpha };
            it.fill.stops.push(dup);
            it.fill.stops.sort(function (a, b) { return a.t - b.t; });
            si = it.fill.stops.indexOf(dup);
            AI.appearance.pushDown(it);
          } else {
            app.history.begin('그레이디언트 정지점', app.doc);
          }
          AI.ui && AI.ui.setGradientStopIndex && AI.ui.setGradientStopIndex(app, si);
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
      } else if (st.mode === 'ffpt') {
        var invF = M.invert(st.g.wm);
        var lpF = M.apply(invF, e.x, e.y);
        var sp = st.it.fill.stops[st.si];
        if (sp) { sp.x = lpF.x; sp.y = lpF.y; }
        AI.appearance.pushDown(st.it);
      } else if (st.mode === 'stop') {
        var t = projectT(st.g, e.x, e.y);
        /* 막대에서 멀리 끌어내면 지운다 — 놓기 전까지는 표시만 해 둔다 */
        st.drop = distToBar(st.g, e.x, e.y) > 34 && st.it.fill.stops.length > 2;
        app.hudText = st.drop ? '놓으면 정지점 삭제' : null;
        if (!st.drop) {
          st.it.fill.stops[st.si].t = U.clamp(t, 0, 1);
          st.it.fill.stops.sort(function (a, b) { return a.t - b.t; });
          AI.appearance.pushDown(st.it);
        }
      }
      app.invalidate();
      AI.ui && AI.ui.syncStyle && AI.ui.syncStyle(app);
    },
    onUp: function (app) {
      if (!st) return;
      if (st.mode === 'stop' && st.drop) {
        st.it.fill.stops.splice(st.si, 1);
        AI.appearance.pushDown(st.it);
        U.toast('정지점 삭제');
      }
      app.hudText = null;
      app.history.commit();
      st = null;
      app.invalidate();
      AI.ui && AI.ui.syncAll && AI.ui.syncAll(app);
    },
    onDblClick: function (app, e) {
      /* 자유형 — 도형 위 빈 곳을 두 번 누르면 그 자리에 색 점을 더한다 */
      var ffIt = ffTarget(app);
      if (ffIt) {
        if (ffHit(app, ffIt, e.x, e.y)) return;
        var wmF = M.mul(AI.viewT.matrix(app), Model.worldMatrix(app.doc, ffIt));
        var lp = M.apply(M.invert(wmF), e.x, e.y);
        app.history.begin('색 점 추가', app.doc);
        var last = ffIt.fill.stops[ffIt.fill.stops.length - 1] || { color: '#ffffff', spread: 60 };
        ffIt.fill.stops.push({
          x: lp.x, y: lp.y, color: last.color, alpha: 1,
          spread: last.spread == null ? 60 : last.spread
        });
        AI.appearance.pushDown(ffIt);
        app.history.commit();
        app.invalidate();
        AI.ui.syncAll(app);
        return;
      }
      var it = gradTarget(app);
      if (!it) return;
      var g = gradEnds(app, it);

      /* 정지점 위를 두 번 누르면 그 정지점의 색을 고른다 (일러스트레이터와 같다) */
      var onStop = stopAt(app, it, g, e.x, e.y);
      if (onStop >= 0) {
        AI.ui && AI.ui.setGradientStopIndex && AI.ui.setGradientStopIndex(app, onStop);
        app.gradStopEdit = true;
        var cr = app.canvas.getBoundingClientRect();
        AI.ui.openColorPicker(app, { left: cr.left + e.x - 110, bottom: cr.top + e.y + 12 });
        return;
      }

      /* 막대를 더블클릭하면 그 위치에 정지점을 추가한다 */
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
      /* 자유형 — 색 점을 동그라미로 띄운다 (선 모드면 이은 선도) */
      if (it.fill.type === 'freeform') {
        var f = ffPoints(app, it);
        ctx.save();
        if (it.fill.mode === 'lines') {
          (it.fill.lines || []).forEach(function (ln) {
            ctx.beginPath();
            ln.forEach(function (k, j) {
              var q = f.pts[k]; if (!q) return;
              if (j === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
            });
            ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 3; ctx.stroke();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
          });
        }
        f.pts.forEach(function (q) {
          ctx.fillStyle = Col.toCss(q.sp.color, q.sp.alpha);
          ctx.beginPath(); ctx.arc(q.x, q.y, 5, 0, 6.2832); ctx.fill();
          ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(q.x, q.y, 6.4, 0, 6.2832); ctx.stroke();
        });
        ctx.restore();
        return;
      }
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
        var on = lerpPt(g.s0, g.s1, sp.t);
        var p = stopPt(g, sp.t);
        /* 막대와 정지점을 잇는 짧은 선 — 어느 자리인지 눈에 보이게 */
        ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(on.x, on.y); ctx.lineTo(p.x, p.y); ctx.stroke();
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
  /* 정지점은 막대 위가 아니라 살짝 아래에 매달아 그린다 (일러스트레이터의 주석자).
     그래야 양 끝에서 끝점 손잡이와 정지점이 겹치지 않는다. */
  var STOP_OFF = 8;
  function stopPt(g, t) {
    var p = lerpPt(g.s0, g.s1, t);
    var dx = g.s1.x - g.s0.x, dy = g.s1.y - g.s0.y;
    var L = Math.hypot(dx, dy) || 1;
    return { x: p.x - dy / L * STOP_OFF, y: p.y + dx / L * STOP_OFF };
  }

  /* 막대(주석자)에서 얼마나 떨어져 있나 — 정지점을 끌어내 지울 때 쓴다 */
  function distToBar(g, x, y) {
    var t = U.clamp(projectT(g, x, y), 0, 1);
    var p = stopPt(g, t);
    return U.dist(x, y, p.x, p.y);
  }
  function stopAt(app, it, g, x, y) {
    for (var i = 0; i < it.fill.stops.length; i++) {
      var p = stopPt(g, it.fill.stops[i].t);
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
