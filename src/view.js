/* =========================================================================
   view.js — 화면 <-> 문서 좌표, 확대/축소, 스크롤, 눈금자
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, M = AI.mat, R = AI.rect;
  var V = AI.viewT = {};

  V.ZOOMS = [0.0313, 0.0625, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];

  V.matrix = function (app) {
    var v = app.view;
    return [v.scale, 0, 0, v.scale, v.tx, v.ty];
  };
  V.toScreen = function (app, x, y) {
    var v = app.view;
    return { x: x * v.scale + v.tx, y: y * v.scale + v.ty };
  };
  V.toDoc = function (app, x, y) {
    var v = app.view;
    return { x: (x - v.tx) / v.scale, y: (y - v.ty) / v.scale };
  };

  V.setZoom = function (app, scale, cx, cy) {
    scale = U.clamp(scale, 0.01, 64);
    var el = app.canvas;
    if (cx == null) { cx = el.clientWidth / 2; cy = el.clientHeight / 2; }
    var before = V.toDoc(app, cx, cy);
    app.view.scale = scale;
    var after = V.toScreen(app, before.x, before.y);
    app.view.tx += cx - after.x;
    app.view.ty += cy - after.y;
    app.invalidate();
    AI.ui && AI.ui.updateZoom && AI.ui.updateZoom(app);
  };

  V.zoomStep = function (app, dir, cx, cy) {
    var s = app.view.scale, i, z = V.ZOOMS;
    if (dir > 0) { for (i = 0; i < z.length; i++) if (z[i] > s + 1e-6) { V.setZoom(app, z[i], cx, cy); return; } V.setZoom(app, 64, cx, cy); }
    else { for (i = z.length - 1; i >= 0; i--) if (z[i] < s - 1e-6) { V.setZoom(app, z[i], cx, cy); return; } V.setZoom(app, z[0], cx, cy); }
  };

  V.pan = function (app, dx, dy) {
    app.view.tx += dx; app.view.ty += dy;
    app.invalidate();
  };

  V.fitRect = function (app, r, pad) {
    pad = pad == null ? 40 : pad;
    var el = app.canvas, w = el.clientWidth - pad * 2, h = el.clientHeight - pad * 2;
    var rw = Math.max(R.w(r), 1), rh = Math.max(R.h(r), 1);
    var s = U.clamp(Math.min(w / rw, h / rh), 0.01, 64);
    app.view.scale = s;
    app.view.tx = el.clientWidth / 2 - R.cx(r) * s;
    app.view.ty = el.clientHeight / 2 - R.cy(r) * s;
    app.invalidate();
    AI.ui && AI.ui.updateZoom && AI.ui.updateZoom(app);
  };

  V.fitArtboard = function (app) {
    var ab = app.doc.artboards[app.doc.activeArtboard] || app.doc.artboards[0];
    V.fitRect(app, { x: ab.x, y: ab.y, x2: ab.x + ab.w, y2: ab.y + ab.h });
  };
  V.fitAll = function (app) {
    var r = R.empty();
    app.doc.artboards.forEach(function (ab) { r = R.union(r, { x: ab.x, y: ab.y, x2: ab.x + ab.w, y2: ab.y + ab.h }); });
    AI.model.walk(app.doc, function (it) { r = R.union(r, AI.render.worldBounds(app.doc, it)); });
    if (R.isEmpty(r)) return V.fitArtboard(app);
    V.fitRect(app, r);
  };

  /* ---------------- 눈금자 ---------------- */
  V.drawRulers = function (app) {
    var rh = document.getElementById('ruler-h'), rv = document.getElementById('ruler-v');
    if (!rh || !rv || document.body.classList.contains('no-rulers')) return;
    var dpr = app.dpr;
    [rh, rv].forEach(function (c) {
      var w = c.clientWidth, h = c.clientHeight;
      if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
    });
    var s = app.view.scale;
    var unit = app.prefs.unit || 'pt';
    var uf = U.unitFactor(unit);
    /* 눈금 간격은 문서 단위 기준으로 고른 뒤 pt 로 환산 */
    var cand = [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
    var stepU = cand[cand.length - 1];
    for (var i = 0; i < cand.length; i++) { if (cand[i] * uf * s >= 60) { stepU = cand[i]; break; } }
    var step = stepU * uf;
    var sub = step / 5;

    function ruler(c, horiz) {
      var ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, c.clientWidth, c.clientHeight);
      ctx.fillStyle = '#2b2b2b'; ctx.fillRect(0, 0, c.clientWidth, c.clientHeight);
      ctx.strokeStyle = '#666'; ctx.fillStyle = '#c0c0c0';
      ctx.font = '9px sans-serif'; ctx.textBaseline = 'top';
      var len = horiz ? c.clientWidth : c.clientHeight;
      var origin = horiz ? app.view.tx : app.view.ty;
      var start = Math.floor((-origin / s) / sub) * sub;
      var end = start + (len / s) + sub;
      ctx.beginPath();
      for (var v = start; v <= end; v += sub) {
        var p = Math.round(v * s + origin) + .5;
        var major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
        var t = major ? 0 : 13;
        if (horiz) { ctx.moveTo(p, t); ctx.lineTo(p, 20); }
        else { ctx.moveTo(t, p); ctx.lineTo(20, p); }
        if (major) {
          var label = String(U.round(v / uf, 2));
          if (horiz) ctx.fillText(label, p + 2, 1);
          else {
            ctx.save(); ctx.translate(2, p - 2); ctx.rotate(-Math.PI / 2);
            ctx.textAlign = 'right'; ctx.fillText(label, 0, 0); ctx.restore();
          }
        }
      }
      ctx.stroke();
    }
    ruler(rh, true); ruler(rv, false);
  };
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
