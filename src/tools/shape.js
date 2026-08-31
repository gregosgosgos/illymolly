/* =========================================================================
   tools/shape.js — 사각형(M) / 둥근 사각형 / 원(L) / 다각형 / 별 / 선(\)
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, M = AI.mat, R = AI.rect, Model = AI.model, T = AI.tools, Col = AI.color;

  var st = null;

  /* 현재 칠/획 적용 */
  T.applyCurrentStyle = function (app, it, forceStroke) {
    it.fill = U.deepCopy(app.fill || Col.solid('#cccccc'));
    var s = Model.defaultStroke();
    s.width = app.strokeWidth || 1;
    s.cap = app.strokeCap || 'butt'; s.join = app.strokeJoin || 'miter'; s.align = app.strokeAlign || 'center';
    s.dash = (app.strokeDash || []).slice();
    if (app.stroke && app.stroke.type !== 'none') {
      if (app.stroke.type === 'solid') { s.type = 'solid'; s.color = app.stroke.color; s.alpha = app.stroke.alpha; }
      else { Object.keys(app.stroke).forEach(function (k) { s[k] = U.deepCopy(app.stroke[k]); }); }
    } else if (forceStroke) { s.type = 'solid'; s.color = '#000000'; }
    it.stroke = s;
    return it;
  };

  function place(app, it) {
    Model.activeLayer(app.doc).children.push(it);
    AI.sel.set(app, [it]);
    return it;
  }

  function makeShape(app, kind, x, y, w, h, extra) {
    var it;
    if (kind === 'rect') it = Model.newRect(x, y, w, h, extra && extra.r);
    else if (kind === 'roundrect') it = Model.newRect(x, y, w, h, (extra && extra.r != null) ? extra.r : Math.min(Math.abs(w), Math.abs(h)) * 0.2);
    else if (kind === 'ellipse') {
      it = Model.newEllipse(x, y, w, h);
      /* 도구가 기억하고 있는 파이 각도를 새 타원에도 적용한다 (일러스트레이터와 같다) */
      if (extra && Math.abs((((extra.pieEnd - extra.pieStart) % 360) + 360) % 360) > 0.001) {
        it.shape.pie = { start: extra.pieStart, end: extra.pieEnd };
        it.name = '파이';
        Model.buildShape(it);
      }
    }
    else if (kind === 'polygon') it = Model.newPolygon(x, y, Math.max(Math.abs(w), 1), extra.n);
    else if (kind === 'star') it = Model.newStar(x, y, Math.max(Math.abs(w), 1), Math.max(Math.abs(w), 1) * (extra.ratio || 0.5), extra.n);
    else it = Model.newLine(x, y, x + w, y + h);
    T.applyCurrentStyle(app, it, kind === 'line');
    if (kind === 'line') it.fill = Col.none();
    return it;
  }

  function shapeTool(id, name, key, kind, defaults) {
    T.mk({
      id: id, name: name, key: key, cursor: 'crosshair', shapeKind: kind,
      onDown: function (app, e) {
        app.history.begin(name, app.doc);
        var d = AI.viewT.toDoc(app, e.x, e.y);
        var o = (app.shapeOpts && app.shapeOpts[kind]) || {};
        st = {
          kind: kind, start: d, item: null, moved: false,
          n: o.n || (defaults && defaults.n) || 6,
          r: kind === 'roundrect' ? (o.r == null ? null : o.r) : (o.r || 0),
          ratio: o.ratio == null ? 0.5 : o.ratio,
          pieStart: o.pieStart || 0,
          pieEnd: o.pieEnd == null ? 360 : o.pieEnd,
          inner: null,          /* 별에서 Ctrl 로 안쪽 반지름을 붙잡아 둘 때 */
          shift: { x: 0, y: 0 } /* Space 로 옮긴 만큼 */
        };
      },
      onMove: function (app, e) {
        if (!st || !e.down) return;
        var d = AI.viewT.toDoc(app, e.x, e.y);

        /* Space — 그리는 중에 도형을 통째로 옮긴다 (일러스트레이터에서 늘 쓰는 손버릇).
           시작점을 커서와 같은 만큼 밀어 크기는 그대로 두고 자리만 바꾼다.
           Space 를 누른 순간에는 이동 이벤트가 오지 않으므로, 직전 위치를
           기준으로 삼아야 첫 걸음에서 크기가 흔들리지 않는다. */
        if (e.space) {
          var from = st.spaceFrom || st.lastDoc;
          if (from) {
            st.start.x += d.x - from.x;
            st.start.y += d.y - from.y;
          }
          st.spaceFrom = { x: d.x, y: d.y };
        } else if (st.spaceFrom) {
          st.spaceFrom = null;
        }
        st.lastDoc = { x: d.x, y: d.y };

        var sx = st.start.x, sy = st.start.y;
        var dx = d.x - sx, dy = d.y - sy;
        if (Math.hypot(e.x - e.sx, e.y - e.sy) < 2 && !st.item) return;
        st.moved = true;
        var round = kind === 'polygon' || kind === 'star';
        if (e.shift) {
          if (kind === 'line') { var c = T.constrainAngle(sx, sy, d.x, d.y, 45); dx = c.x - sx; dy = c.y - sy; }
          else if (!round) { var m = Math.max(Math.abs(dx), Math.abs(dy)); dx = U.sign(dx) * m; dy = U.sign(dy) * m; }
        }
        var x = sx, y = sy, w = dx, h = dy;
        /* Alt = 중심에서 그리기. 다각형·별은 원래 중심에서 자라므로 해당 없다
           (거기서 Alt 는 어깨를 곧게 펴는 데 쓴다 — 아래) */
        if (e.alt && kind !== 'line' && !round) { x = sx - dx; y = sy - dy; w = dx * 2; h = dy * 2; }
        if (st.item) { var loc = Model.locate(app.doc, st.item); if (loc) loc.list.splice(loc.index, 1); }
        var it;
        if (round) {
          var rr = Math.hypot(dx, dy);
          var ang = Math.atan2(dy, dx) + Math.PI / 2;
          var ratio = st.ratio;
          if (kind === 'star') {
            /* Ctrl — 안쪽 반지름을 붙잡아 둔다 (끌수록 뾰족해진다) */
            if (e.ctrl) {
              if (st.inner == null) st.inner = rr * st.ratio;
              ratio = rr > 1e-6 ? U.clamp(st.inner / rr, 0.02, 1) : st.ratio;
            } else {
              st.inner = null;
              /* Alt — 어깨를 곧게. 안쪽 점이 바깥 두 점을 잇는 현 위에 놓인다 */
              if (e.alt) ratio = Math.cos(Math.PI / Math.max(3, st.n));
            }
          }
          it = makeShape(app, kind, sx, sy, rr, rr, { n: st.n, ratio: ratio });
          it.m = M.mulAll(M.translate(sx, sy), M.rotate(e.shift ? 0 : ang), M.translate(-rr, -rr));
        } else if (w < 0 || h < 0) {
          it = makeShape(app, kind, Math.min(x, x + w), Math.min(y, y + h), Math.abs(w), Math.abs(h), { r: st.r, pieStart: st.pieStart, pieEnd: st.pieEnd });
        } else {
          it = makeShape(app, kind, x, y, w, h, { r: st.r, pieStart: st.pieStart, pieEnd: st.pieEnd });
        }
        place(app, it);
        st.item = it;
        app.invalidate();
        AI.ui && AI.ui.syncSelection && AI.ui.syncSelection(app);
      },
      onUp: function (app, e) {
        if (!st) return;
        if (!st.moved) {
          /* 클릭만 = Illustrator 처럼 크기 입력 대화상자 */
          var d = st.start;
          app.history.abort();
          st = null;
          AI.dialogs.shapeOptions(app, kind, d);
          return;
        }
        app.history.commit();
        st = null;
        app.invalidate();
        AI.ui && AI.ui.syncSelection && AI.ui.syncSelection(app);
      },
      onKey: function (app, ev) {
        if (!st || !st.item) return false;
        var opts = function (v) {
          app.shapeOpts = app.shapeOpts || {};
          app.shapeOpts[kind] = app.shapeOpts[kind] || {};
          Object.keys(v).forEach(function (k) { app.shapeOpts[kind][k] = v[k]; });
          AI.ui && AI.ui.buildToolOptions && AI.ui.buildToolOptions(app);
          app.invalidate();
        };

        /* 다각형 · 별 — ↑ ↓ 로 변(점) 개수 */
        if (kind === 'polygon' || kind === 'star') {
          if (ev.key === 'ArrowUp') st.n++;
          else if (ev.key === 'ArrowDown') st.n = Math.max(3, st.n - 1);
          else return false;
          st.item.shape.n = st.n;
          Model.buildShape(st.item);
          opts({ n: st.n });
          return true;
        }

        /* 사각형 — ↑ ↓ 로 모퉁이 반경, ← 은 0, → 은 최대 (일러스트레이터와 같다) */
        if (kind === 'rect' || kind === 'roundrect') {
          var sh = st.item.shape;
          var lim = Math.min(Math.abs(sh.w), Math.abs(sh.h)) / 2;
          var step = Math.max(1, lim / 20);
          var cur = AI.model.rectRadii(sh)[0];
          if (ev.key === 'ArrowUp') cur += step;
          else if (ev.key === 'ArrowDown') cur -= step;
          else if (ev.key === 'ArrowLeft') cur = 0;
          else if (ev.key === 'ArrowRight') cur = lim;
          else return false;
          st.r = U.clamp(cur, 0, lim);
          AI.edit.storeCornerRadii(sh, [st.r, st.r, st.r, st.r]);
          Model.buildShape(st.item);
          opts({ r: st.r });
          return true;
        }
        return false;
      }
    });
  }

  shapeTool('rect', '사각형 도구', 'm', 'rect');
  shapeTool('roundrect', '둥근 사각형 도구', null, 'roundrect');
  shapeTool('ellipse', '원형 도구', 'l', 'ellipse');
  shapeTool('polygon', '다각형 도구', null, 'polygon', { n: 6 });
  shapeTool('star', '별모양 도구', null, 'star', { n: 5 });
  shapeTool('line', '선분 도구', '\\', 'line');
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
