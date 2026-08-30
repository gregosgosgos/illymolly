/* =========================================================================
   tools/type.js — 문자 도구 (T)
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, M = AI.mat, Model = AI.model, H = AI.hit, T = AI.tools, Rn = AI.render, Col = AI.color;

  var editing = null;   /* {it, app} */
  var ta = null;

  function textarea() {
    if (!ta) ta = document.getElementById('text-editor');
    return ta;
  }

  function syncBox(app) {
    if (!editing) return;
    var it = editing.it, t = it.text;
    var el = textarea();
    var wm = M.mul(AI.viewT.matrix(app), Model.worldMatrix(app.doc, it));
    var L = t.size * (t.leading || 1.2);
    var offY = -((L - t.size) / 2 + t.size * 0.8);
    var offX = 0;
    var m = Rn.measureText(it);
    if (t.align === 'center') offX = -m.w / 2 - 10;
    else if (t.align === 'right') offX = -m.w - 20;
    var full = M.mul(wm, M.translate(offX, offY));
    el.style.transform = M.toCSS(full);
    el.style.font = Rn.fontCss(t);
    el.style.lineHeight = L + 'px';
    el.style.letterSpacing = (t.tracking || 0) + 'px';
    el.style.textAlign = t.align || 'left';
    el.style.color = (it.fill && it.fill.type === 'solid') ? Col.toCss(it.fill.color, it.fill.alpha) : '#000';
    el.style.caretColor = el.style.color;
    if (t.area) {
      /* 영역 문자는 상자 자체가 편집 영역 — 정렬 보정 없이 좌상단에 맞춘다 */
      el.style.transform = M.toCSS(M.mul(wm, M.translate(0, (L - t.size) / 2 - (L - t.size) / 2)));
      el.style.width = t.area.w + 'px';
      el.style.height = t.area.h + 'px';
      el.style.whiteSpace = 'pre-wrap';
    } else {
      var lines = String(t.content).split('\n');
      el.style.width = Math.max(m.w + 24, 40) + 'px';
      el.style.height = (lines.length * L + 6) + 'px';
      el.style.whiteSpace = 'pre';
    }
    el.style.display = 'block';
  }
  T.syncTextBox = syncBox;

  function startEdit(app, it, caretAll) {
    commitEdit(app);
    editing = { it: it, app: app };
    it.__editing = true;
    var el = textarea();
    el.value = it.text.content;
    syncBox(app);
    app.editingText = it;
    app.invalidate();
    setTimeout(function () {
      el.focus();
      if (caretAll) el.select(); else el.setSelectionRange(el.value.length, el.value.length);
    }, 0);
  }

  function commitEdit(app) {
    if (!editing) return;
    var it = editing.it, el = textarea();
    it.text.content = el.value;
    delete it.__editing;
    el.style.display = 'none';
    el.value = '';
    var a = editing.app;
    editing = null;
    a.editingText = null;
    if (!it.text.content.length) {
      var loc = Model.locate(a.doc, it);
      if (loc) loc.list.splice(loc.index, 1);
      AI.sel.clear(a);
    }
    a.history.commit();
    a.invalidate();
    AI.ui && AI.ui.syncSelection && AI.ui.syncSelection(a);
  }
  T.commitText = commitEdit;
  T.isEditingText = function () { return !!editing; };

  function bindTextarea(app) {
    var el = textarea();
    if (el.__bound) return;
    el.__bound = true;
    el.addEventListener('input', function () {
      if (!editing) return;
      editing.it.text.content = el.value;
      syncBox(editing.app);
      editing.app.invalidate();
    });
    el.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { ev.preventDefault(); commitEdit(editing && editing.app); AI.tools.setTool(app, 'select', true); }
      ev.stopPropagation();
    });
    el.addEventListener('blur', function () { commitEdit(editing && editing.app); });
  }

  T.mk({
    id: 'type', name: '문자 도구', key: 't', cursor: 'text',

    activate: function (app) { bindTextarea(app); },
    deactivate: function (app) { commitEdit(app); },

    editItem: function (app, it) {
      app.history.begin('텍스트 편집', app.doc);
      AI.sel.set(app, [it]);
      bindTextarea(app);
      startEdit(app, it, false);
    },

    onDown: function (app, e) {
      var hit = H.itemAt(app, e.x, e.y, true);
      if (editing && hit === editing.it) return;
      commitEdit(app);
      if (hit && hit.type === 'text') {
        app.history.begin('텍스트 편집', app.doc);
        AI.sel.set(app, [hit]);
        startEdit(app, hit, false);
        return;
      }
      /* 새 텍스트 */
      app.history.begin('텍스트 만들기', app.doc);
      var d = AI.viewT.toDoc(app, e.x, e.y);
      var it = Model.newText(d.x, d.y, '');
      it.text.size = app.typeOpts ? app.typeOpts.size : 24;
      it.text.family = app.typeOpts ? app.typeOpts.family : it.text.family;
      it.fill = U.deepCopy(app.textFill || Col.solid('#000000'));
      it.stroke = Model.defaultStroke();
      Model.activeLayer(app.doc).children.push(it);
      AI.sel.set(app, [it]);
      startEdit(app, it, false);
      app.invalidate();
    },

    onUp: function () { },
    onKey: function () { return false; }
  });

  /* ---------------- 영역 문자 도구 ----------------
     · 닫힌 패스를 클릭하면 그 도형 안으로 글이 흘러 들어간다
     · 빈 곳을 드래그하면 그 크기의 사각 상자를 만든다
     · 상자를 클릭하면 편집                                          */
  var areaSt = null;

  function makeAreaText(app, x, y, w, h, shapeSubs) {
    var it = Model.newText(x, y, '');
    it.name = '영역 문자';
    it.text.size = app.typeOpts ? app.typeOpts.size : 24;
    it.text.family = app.typeOpts ? app.typeOpts.family : it.text.family;
    it.text.area = { w: Math.max(20, w), h: Math.max(it.text.size, h) };
    if (shapeSubs) it.text.areaShape = shapeSubs;
    it.fill = U.deepCopy(app.textFill || Col.solid('#000000'));
    it.stroke = Model.defaultStroke();
    Model.activeLayer(app.doc).children.push(it);
    return it;
  }

  T.mk({
    id: 'typearea', name: '영역 문자 도구', key: null, cursor: 'text',
    activate: function (app) { bindTextarea(app); },
    deactivate: function (app) { commitEdit(app); areaSt = null; },

    onDown: function (app, e) {
      var hit = H.itemAt(app, e.x, e.y, true);
      if (editing && hit === editing.it) return;
      commitEdit(app);

      if (hit && hit.type === 'text') {
        app.history.begin('텍스트 편집', app.doc);
        AI.sel.set(app, [hit]);
        startEdit(app, hit, false);
        return;
      }
      /* 닫힌 패스를 클릭 → 그 도형 안으로 글을 흘린다 */
      if (hit && hit.type === 'path' && hit.subs.some(function (sb) { return sb.closed; })) {
        app.history.begin('영역 문자', app.doc);
        var wm = Model.worldMatrix(app.doc, hit);
        var b = Rn.worldBounds(app.doc, hit, true);
        /* 도형을 텍스트 로컬 좌표(좌상단 원점)로 옮겨 담는다 */
        var rel = M.mul(M.translate(-b.x, -b.y), wm);
        var subs = hit.subs.filter(function (sb) { return sb.closed; }).map(function (sb) {
          return {
            closed: true, pts: sb.pts.map(function (pt) {
              var q = M.apply(rel, pt.x, pt.y), o = { x: q.x, y: q.y };
              if (pt.ix != null) { var i2 = M.apply(rel, pt.ix, pt.iy); o.ix = i2.x; o.iy = i2.y; }
              if (pt.ox != null) { var o2 = M.apply(rel, pt.ox, pt.oy); o.ox = o2.x; o.oy = o2.y; }
              return o;
            })
          };
        });
        var it = makeAreaText(app, b.x, b.y, b.x2 - b.x, b.y2 - b.y, subs);
        /* 원본 도형은 일러스트레이터처럼 문자 영역이 되면서 사라진다 */
        var loc = Model.locate(app.doc, hit);
        if (loc) loc.list.splice(loc.index, 1);
        AI.sel.set(app, [it]);
        startEdit(app, it, false);
        app.invalidate();
        return;
      }
      /* 빈 곳 → 드래그로 상자 만들기 */
      areaSt = { start: AI.viewT.toDoc(app, e.x, e.y), sx: e.x, sy: e.y };
    },

    onMove: function (app, e) {
      if (!areaSt || !e.down) return;
      areaSt.cur = AI.viewT.toDoc(app, e.x, e.y);
      app.marquee = AI.rect.fromPts(areaSt.sx, areaSt.sy, e.x, e.y);
      app.invalidate();
    },

    onUp: function (app, e) {
      if (!areaSt) return;
      var st0 = areaSt;
      areaSt = null;
      app.marquee = null;
      var d = AI.viewT.toDoc(app, e.x, e.y);
      var w = Math.abs(d.x - st0.start.x), h = Math.abs(d.y - st0.start.y);
      app.history.begin('영역 문자', app.doc);
      if (w < 6 || h < 6) { w = 240; h = 120; }     /* 클릭만 하면 기본 크기 */
      var it = makeAreaText(app, Math.min(st0.start.x, d.x), Math.min(st0.start.y, d.y), w, h, null);
      AI.sel.set(app, [it]);
      startEdit(app, it, false);
      app.invalidate();
    },

    onKey: function () { return false; }
  });
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
