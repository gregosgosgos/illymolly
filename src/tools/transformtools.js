/* =========================================================================
   tools/transformtools.js — 회전(R) / 크기조절(S) / 반사(O) / 기울이기 / 자유 변형(E)
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, M = AI.mat, R = AI.rect, T = AI.tools, E = AI.edit, Rn = AI.render;

  var st = null;

  function origin(app) {
    if (app.transformOrigin) return app.transformOrigin;
    var b = Rn.selectionBounds(app, true);
    if (R.isEmpty(b)) return { x: 0, y: 0 };
    return { x: R.cx(b), y: R.cy(b) };
  }

  function baseTool(id, name, key, kind) {
    T.mk({
      id: id, name: name, key: key, cursor: 'crosshair', transformTool: true,
      activate: function (app) { app.transformOrigin = null; },
      onDown: function (app, e) {
        if (!app.sel.length) { U.toast('오브젝트를 먼저 선택하세요'); return; }
        var o = origin(app);
        var d = AI.viewT.toDoc(app, e.x, e.y);
        st = {
          kind: kind, o: o, start: d, moved: false,
          orig: app.sel.map(function (it) { return it.m.slice(); }),
          sel: app.sel.slice(),
          startAngle: Math.atan2(d.y - o.y, d.x - o.x),
          startDist: Math.max(U.dist(o.x, o.y, d.x, d.y), 1e-6),
          alt: e.alt
        };
        app.history.begin(name, app.doc);
      },
      onMove: function (app, e) {
        if (!st || !e.down) return;
        var d = AI.viewT.toDoc(app, e.x, e.y);
        if (U.dist(d.x, d.y, st.start.x, st.start.y) * app.view.scale < 2) return;
        st.moved = true;

        /* Alt 드래그 = 원본을 두고 사본을 변형한다 (일러스트레이터의 회전·반사 복사).
           끌기 시작한 뒤에 Alt 를 눌러도 되도록 여기서 한 번만 복제한다. */
        if (e.alt && !st.duped) {
          for (var k = 0; k < st.sel.length; k++) st.sel[k].m = st.orig[k].slice();
          AI.sel.set(app, st.sel);
          var copies = E.duplicate(app, 0, 0);
          st.duped = true;
          st.sel = copies;
          st.orig = copies.map(function (it) { return it.m.slice(); });
        }

        for (var i = 0; i < st.sel.length; i++) st.sel[i].m = st.orig[i].slice();
        var W;
        if (kind === 'rotate') {
          var a = Math.atan2(d.y - st.o.y, d.x - st.o.x) - st.startAngle;
          if (e.shift) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
          W = M.around(M.rotate(a), st.o.x, st.o.y);
          app.hudText = U.round(U.deg(a), 1) + '°';
        } else if (kind === 'scale') {
          var dist = U.dist(st.o.x, st.o.y, d.x, d.y);
          var k = dist / st.startDist;
          var sx = k, sy = k;
          if (!e.shift) {
            var ddx = Math.abs(st.start.x - st.o.x), ddy = Math.abs(st.start.y - st.o.y);
            sx = ddx > 1e-6 ? (d.x - st.o.x) / (st.start.x - st.o.x) : k;
            sy = ddy > 1e-6 ? (d.y - st.o.y) / (st.start.y - st.o.y) : k;
          }
          W = M.around(M.scale(sx, sy), st.o.x, st.o.y);
          app.hudText = Math.round(sx * 100) + '% , ' + Math.round(sy * 100) + '%';
        } else if (kind === 'reflect') {
          var ang = Math.atan2(d.y - st.o.y, d.x - st.o.x);
          if (e.shift) ang = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
          W = M.mulAll(
            M.translate(st.o.x, st.o.y), M.rotate(ang), M.scale(1, -1), M.rotate(-ang), M.translate(-st.o.x, -st.o.y)
          );
          app.hudText = '반사 ' + U.round(U.deg(ang), 1) + '°';
        } else { /* shear */
          var sh = (d.x - st.start.x) / 100;
          W = M.around(M.skew(Math.atan(sh), 0), st.o.x, st.o.y);
          app.hudText = '기울이기 ' + U.round(U.deg(Math.atan(sh)), 1) + '°';
        }
        app.lastTransformCandidate = W;
        E.transformSelection(app, W);      /* app.sel — 복제했다면 사본이 들어 있다 */
        app.invalidate();
        AI.ui && AI.ui.syncSelection && AI.ui.syncSelection(app);
      },
      onUp: function (app, e) {
        if (!st) return;
        if (!st.moved) {
          /* 클릭 = 기준점 설정, Alt+클릭 = 기준점 + 옵션 대화상자 (Illustrator 동작) */
          app.transformOrigin = AI.viewT.toDoc(app, e.x, e.y);
          app.history.abort();
          if (st.alt && AI.dialogs[kind]) { st = null; app.invalidate(); AI.dialogs[kind](app); return; }
          U.toast('기준점 설정');
        } else {
          app.lastTransform = app.lastTransformCandidate;
          app.history.commit();
          if (st.duped) U.toast(st.sel.length + '개 복사 후 ' + name.replace(' 도구', ''));
        }
        app.hudText = null;
        st = null;
        app.invalidate();
      },
      /* Enter — 대화상자로 정확한 값을 넣는다 (일러스트레이터와 같다) */
      onKey: function (app, ev) {
        if (ev.key !== 'Enter' || st) return false;
        if (!app.sel.length || !AI.dialogs[kind]) return false;
        AI.dialogs[kind](app);
        return true;
      },

      drawUI: function (ctx, app) {
        if (!app.sel.length) return;
        var o = origin(app);
        var p = AI.viewT.toScreen(app, o.x, o.y);
        ctx.save();
        ctx.strokeStyle = '#2d8ceb'; ctx.fillStyle = '#fff'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, 6.2832); ctx.fill(); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(p.x - 7, p.y); ctx.lineTo(p.x + 7, p.y);
        ctx.moveTo(p.x, p.y - 7); ctx.lineTo(p.x, p.y + 7);
        ctx.stroke();
        if (app.hudText) {
          ctx.font = '11px sans-serif';
          var w = ctx.measureText(app.hudText).width + 10;
          ctx.fillStyle = 'rgba(0,0,0,.75)';
          ctx.fillRect(p.x + 12, p.y - 24, w, 16);
          ctx.fillStyle = '#fff';
          ctx.fillText(app.hudText, p.x + 17, p.y - 12);
        }
        ctx.restore();
      }
    });
  }

  baseTool('rotate', '회전 도구', 'r', 'rotate');
  baseTool('scale', '크기 조절 도구', 's', 'scale');
  baseTool('reflect', '반사 도구', 'o', 'reflect');
  baseTool('shear', '기울이기 도구', null, 'shear');

  /* 자유 변형 — 선택 도구의 바운딩 박스 조작을 재사용 */
  T.mk({
    id: 'freetransform', name: '자유 변형 도구', key: 'e', cursor: 'default',
    onDown: function (app, e) { T.selectHelpers.commonDown(app, e, false); },
    onMove: function (app, e) { T.selectHelpers.commonMove(app, e); },
    onUp: function (app, e) { T.selectHelpers.commonUp(app, e); }
  });
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
