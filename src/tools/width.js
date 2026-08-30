/* =========================================================================
   tools/width.js — 폭 도구 (Width Tool, Shift+W)
   -------------------------------------------------------------------------
   패스 위의 한 지점을 잡아 바깥으로 끌면 그 자리의 획 두께가 굵어지고,
   안쪽으로 끌면 가늘어진다. 결과는 stroke.widthProfile 에 저장된다.

     stroke.widthProfile = [ {t:0..1, w:배율}, … ]   // t 는 서브패스 길이 비율

   렌더러(render.js)와 SVG 출력(io.js)이 같은 프로파일을 읽는다.
   Alt 를 누른 채 폭 지점을 클릭하면 그 지점을 지운다.
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, M = AI.mat, Model = AI.model, T = AI.tools, G = AI.geom, Rn = AI.render;

  var st = null;
  var HIT = 8;

  /* 서브패스를 평탄화하고 누적 길이를 붙인다 (로컬 좌표) */
  function sampled(it, si) {
    var sub = it.subs[si];
    if (!sub || sub.pts.length < 2) return null;
    var pts = G.flattenSub(sub, 0.3);
    if (pts.length < 2) return null;
    var acc = [0], total = 0;
    for (var i = 1; i < pts.length; i++) {
      total += U.dist(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
      acc.push(total);
    }
    if (total < 1e-6) return null;
    return { pts: pts, acc: acc, total: total };
  }

  function pointAt(s, t) {
    var target = U.clamp(t, 0, 1) * s.total;
    for (var i = 1; i < s.acc.length; i++) {
      if (s.acc[i] >= target) {
        var a = s.pts[i - 1], b = s.pts[i];
        var seg = s.acc[i] - s.acc[i - 1];
        var k = seg < 1e-9 ? 0 : (target - s.acc[i - 1]) / seg;
        var dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
        return { x: a.x + dx * k, y: a.y + dy * k, nx: -dy / l, ny: dx / l };
      }
    }
    var last = s.pts[s.pts.length - 1], prev = s.pts[s.pts.length - 2];
    var ddx = last.x - prev.x, ddy = last.y - prev.y, ll = Math.hypot(ddx, ddy) || 1;
    return { x: last.x, y: last.y, nx: -ddy / ll, ny: ddx / ll };
  }

  /* 화면 좌표에서 가장 가까운 (아이템, 서브패스, t) */
  function nearest(app, sx, sy) {
    var best = null;
    app.sel.forEach(function (it) {
      if (it.type !== 'path' || !it.stroke || it.stroke.type === 'none') return;
      var wm = M.mul(AI.viewT.matrix(app), Model.worldMatrix(app.doc, it));
      it.subs.forEach(function (sub, si) {
        var s = sampled(it, si);
        if (!s) return;
        for (var i = 0; i < s.pts.length; i++) {
          var p = M.apply(wm, s.pts[i].x, s.pts[i].y);
          var d = U.dist(sx, sy, p.x, p.y);
          if (!best || d < best.d) best = { d: d, it: it, si: si, t: s.acc[i] / s.total, s: s, wm: wm };
        }
      });
    });
    return (best && best.d <= HIT * 3) ? best : null;
  }

  function profileOf(it) {
    var s = it.stroke;
    if (!s.widthProfile || !s.widthProfile.length) s.widthProfile = [{ t: 0, w: 1 }, { t: 1, w: 1 }];
    return s.widthProfile;
  }

  function setPoint(it, t, w) {
    var prof = profileOf(it);
    t = U.clamp(t, 0, 1);
    for (var i = 0; i < prof.length; i++) {
      if (Math.abs(prof[i].t - t) < 0.02) { prof[i].w = w; return i; }
    }
    prof.push({ t: t, w: w });
    prof.sort(function (a, b) { return a.t - b.t; });
    for (var j = 0; j < prof.length; j++) if (prof[j].t === t) return j;
    return 0;
  }

  T.mk({
    id: 'width', name: '폭 도구', key: null, cursor: 'crosshair',

    onDown: function (app, e) {
      var n = nearest(app, e.x, e.y);
      if (!n) { U.toast('획이 있는 패스를 선택하고 그 위에서 끄세요'); return; }
      if (e.alt) {
        /* Alt 클릭 = 그 자리의 폭 지점 삭제 */
        var prof = n.it.stroke.widthProfile;
        if (prof && prof.length > 2) {
          app.history.begin('폭 지점 삭제', app.doc);
          for (var i = prof.length - 1; i >= 0; i--) if (Math.abs(prof[i].t - n.t) < 0.05) prof.splice(i, 1);
          if (prof.length < 2) delete n.it.stroke.widthProfile;
          app.history.commit();
          app.invalidate();
        }
        return;
      }
      app.history.begin('폭 조절', app.doc);
      var base = Rn.profileAt(n.it.stroke.widthProfile, n.t);
      st = { n: n, base: base, start: { x: e.x, y: e.y }, idx: setPoint(n.it, n.t, base) };
      app.invalidate();
    },

    onMove: function (app, e) {
      if (!st || !e.down) {
        app.widthHint = nearest(app, e.x, e.y) ? { x: e.x, y: e.y } : null;
        return;
      }
      var n = st.n;
      var p = pointAt(n.s, n.t);
      var sp = M.apply(n.wm, p.x, p.y);
      /* 법선 방향으로 끈 거리를 두께 배율로 (양쪽 합이 두께이므로 2배) */
      var nrm = { x: n.wm[0] * p.nx + n.wm[2] * p.ny, y: n.wm[1] * p.nx + n.wm[3] * p.ny };
      var nl = Math.hypot(nrm.x, nrm.y) || 1;
      var d = ((e.x - sp.x) * nrm.x + (e.y - sp.y) * nrm.y) / nl;
      var sw = Math.max(n.it.stroke.width * app.view.scale, 0.5);
      /* 끌어낸 거리는 반쪽 두께이므로 2배가 전체 두께 */
      var w = Math.max(0.02, (Math.abs(d) * 2) / sw);
      n.it.stroke.widthProfile[st.idx].w = w;
      AI.appearance.pushDown(n.it);
      app.invalidate();
    },

    onUp: function (app) {
      if (!st) return;
      app.history.commit();
      st = null;
      app.invalidate();
      AI.ui.syncAll(app);
    },

    drawUI: function (ctx, app) {
      /* 선택한 패스의 폭 지점을 마름모로 표시한다 */
      app.sel.forEach(function (it) {
        if (it.type !== 'path' || !it.stroke || !it.stroke.widthProfile) return;
        var wm = M.mul(AI.viewT.matrix(app), Model.worldMatrix(app.doc, it));
        it.subs.forEach(function (sub, si) {
          var s = sampled(it, si);
          if (!s) return;
          it.stroke.widthProfile.forEach(function (wp) {
            var p = pointAt(s, wp.t);
            var c = M.apply(wm, p.x, p.y);
            ctx.save();
            ctx.translate(c.x, c.y);
            ctx.rotate(Math.PI / 4);
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#2d8ceb';
            ctx.lineWidth = 1;
            ctx.fillRect(-3.5, -3.5, 7, 7);
            ctx.strokeRect(-3.5, -3.5, 7, 7);
            ctx.restore();
          });
        });
      });
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
