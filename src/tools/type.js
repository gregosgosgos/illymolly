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
    var lines = String(t.content).split('\n');
    el.style.width = Math.max(m.w + 24, 40) + 'px';
    el.style.height = (lines.length * L + 6) + 'px';
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

  /* 세로 문자 도구 (간단 버전: 줄바꿈 세로 배치는 미지원, 자리표시) */
  T.mk({
    id: 'typearea', name: '영역 문자 도구', key: null, cursor: 'text',
    onDown: function (app, e) { T.get('type').onDown(app, e); }
  });
})(window.AI);
