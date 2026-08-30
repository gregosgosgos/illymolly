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
    s.cap = app.strokeCap || 'butt'; s.join = app.strokeJoin || 'miter';
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
    else if (kind === 'ellipse') it = Model.newEllipse(x, y, w, h);
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
        st = { kind: kind, start: d, item: null, n: (app.shapeOpts && app.shapeOpts[kind] && app.shapeOpts[kind].n) || (defaults && defaults.n) || 6, moved: false };
      },
      onMove: function (app, e) {
        if (!st || !e.down) return;
        var d = AI.viewT.toDoc(app, e.x, e.y);
        var sx = st.start.x, sy = st.start.y;
        var dx = d.x - sx, dy = d.y - sy;
        if (Math.hypot(e.x - e.sx, e.y - e.sy) < 2 && !st.item) return;
        st.moved = true;
        if (e.shift) {
          if (kind === 'line') { var c = T.constrainAngle(sx, sy, d.x, d.y, 45); dx = c.x - sx; dy = c.y - sy; }
          else { var m = Math.max(Math.abs(dx), Math.abs(dy)); dx = U.sign(dx) * m; dy = U.sign(dy) * m; }
        }
        var x = sx, y = sy, w = dx, h = dy;
        if (e.alt && kind !== 'line') { x = sx - dx; y = sy - dy; w = dx * 2; h = dy * 2; }
        if (st.item) { var loc = Model.locate(app.doc, st.item); if (loc) loc.list.splice(loc.index, 1); }
        var it;
        if (kind === 'polygon' || kind === 'star') {
          var rr = Math.hypot(dx, dy);
          var ang = Math.atan2(dy, dx) + Math.PI / 2;
          it = makeShape(app, kind, sx, sy, rr, rr, { n: st.n, ratio: 0.5 });
          it.m = M.mulAll(M.translate(sx, sy), M.rotate(e.shift ? 0 : ang), M.translate(-rr, -rr));
        } else if (w < 0 || h < 0) {
          it = makeShape(app, kind, Math.min(x, x + w), Math.min(y, y + h), Math.abs(w), Math.abs(h), { r: st.r });
        } else {
          it = makeShape(app, kind, x, y, w, h, { r: st.r });
        }
        place(app, it);
        st.item = it;
        app.invalidate();
        AI.ui && AI.ui.syncSelection && AI.ui.syncSelection(app);
      },
      onUp: function (app, e) {
        if (!st) return;
        if (!st.moved) {
          /* 클릭만 = 기본 크기 */
          var d = st.start;
          var it = (kind === 'polygon' || kind === 'star')
            ? makeShape(app, kind, d.x, d.y, 50, 50, { n: st.n, ratio: 0.5 })
            : makeShape(app, kind, d.x, d.y, 100, kind === 'line' ? 0 : 100, { r: st.r });
          if (kind === 'line') { it = makeShape(app, kind, d.x, d.y, 100, 0, {}); }
          place(app, it);
          app.history.commit();
        } else app.history.commit();
        st = null;
        app.invalidate();
        AI.ui && AI.ui.syncSelection && AI.ui.syncSelection(app);
      },
      onKey: function (app, ev) {
        if (!st || !st.item) return false;
        if (kind !== 'polygon' && kind !== 'star') return false;
        if (ev.key === 'ArrowUp') { st.n++; }
        else if (ev.key === 'ArrowDown') { st.n = Math.max(3, st.n - 1); }
        else return false;
        st.item.shape.n = st.n;
        Model.buildShape(st.item);
        app.shapeOpts = app.shapeOpts || {}; app.shapeOpts[kind] = { n: st.n };
        app.invalidate();
        return true;
      }
    });
  }

  shapeTool('rect', '사각형 도구', 'm', 'rect');
  shapeTool('roundrect', '둥근 사각형 도구', null, 'roundrect');
  shapeTool('ellipse', '원형 도구', 'l', 'ellipse');
  shapeTool('polygon', '다각형 도구', null, 'polygon', { n: 6 });
  shapeTool('star', '별모양 도구', null, 'star', { n: 5 });
  shapeTool('line', '선분 도구', '\\', 'line');
})(window.AI);
