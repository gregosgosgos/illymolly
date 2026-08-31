/* =========================================================================
   tools/type.js — 문자 도구 (T)
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, M = AI.mat, Model = AI.model, H = AI.hit, T = AI.tools, Rn = AI.render, Col = AI.color;

  var editing = null;   /* {it, app} */
  var ta = null;
  var dragBox = null;   /* 문자 도구로 영역 상자를 끄는 중 */

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
    if (t.path) {
      /* 패스 상의 문자는 글이 휘어 있어 그 자리에서 편집할 수 없다.
         패스 옆에 가로로 펼친 편집 상자를 띄운다 (일러스트레이터도 편집 중에는 곧게 편다) */
      var bx = m.box || { x: 0, y: 0, x2: 120, y2: L };
      el.style.transform = M.toCSS(M.mul(wm, M.translate(bx.x, (bx.y + bx.y2) / 2 - L / 2)));
      el.style.width = Math.max((m.textLen || 0) + 24, 80) + 'px';
      el.style.height = (L + 6) + 'px';
      el.style.whiteSpace = 'pre';
      el.style.textAlign = 'left';
      el.style.display = 'block';
      return;
    }
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

  function startEdit(app, it, caretAll, caretAt) {
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
      if (caretAll) { el.select(); return; }
      var at = (caretAt == null) ? el.value.length : U.clamp(caretAt, 0, el.value.length);
      el.setSelectionRange(at, at);
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

  /* 패스를 텍스트 아이템의 로컬 좌표(바운딩 좌상단이 원점)로 옮겨 담는다 */
  function localSubs(app, it, b, filter) {
    var rel = M.mul(M.translate(-b.x, -b.y), Model.worldMatrix(app.doc, it));
    return AI.geom.xformSubs(filter ? it.subs.filter(filter) : it.subs, rel);
  }

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

  /* 닫힌 패스를 영역 문자로 — 원본 도형은 문자 오브젝트가 되면서 사라진다 */
  function shapeToAreaText(app, hit) {
    app.history.begin('영역 문자', app.doc);
    var b = Rn.worldBounds(app.doc, hit, true);
    var subs = localSubs(app, hit, b, function (sb) { return sb.closed; });
    var it = makeAreaText(app, b.x, b.y, b.x2 - b.x, b.y2 - b.y, subs);
    var loc = Model.locate(app.doc, hit);
    if (loc) loc.list.splice(loc.index, 1);
    AI.sel.set(app, [it]);
    startEdit(app, it, false);
    app.invalidate();
    return it;
  }

  function isClosedPath(hit) {
    return hit && hit.type === 'path' && hit.subs.some(function (sb) { return sb.closed; });
  }

  /* 누른 자리에 해당하는 글자 위치 — 일러스트레이터처럼 그 자리에 커서를 둔다 */
  function caretIndexAt(app, it, sx, sy) {
    var t = it.text;
    if (!t || !Rn.hasCanvas()) return null;
    var lines = Rn.textLines(it);
    if (!lines || !lines.length) return 0;
    var inv = M.invert(M.mul(AI.viewT.matrix(app), Model.worldMatrix(app.doc, it)));
    var lp = M.apply(inv, sx, sy);
    var lh = t.size * (t.leading || 1.2);
    /* 점 문자는 기준선이 y=0 이라 첫 줄이 위로 올라가 있다 */
    var top = t.area ? 0 : -t.size * 0.8;
    var row = U.clamp(Math.floor((lp.y - top) / lh), 0, lines.length - 1);
    var line = lines[row];
    var text = typeof line === 'string' ? line : (line.text || '');
    /* 정렬에 따라 줄의 왼쪽 끝이 달라진다 */
    var w = Rn.measureLine(text, t);
    var x0 = 0;
    if (t.align === 'center') x0 = -w / 2;
    else if (t.align === 'right') x0 = -w;
    if (t.area) x0 = (t.align === 'center') ? (t.area.w - w) / 2 : (t.align === 'right' ? t.area.w - w : 0);
    var col = text.length;
    for (var i = 0; i <= text.length; i++) {
      var wx = x0 + Rn.measureLine(text.slice(0, i), t);
      var nx = x0 + Rn.measureLine(text.slice(0, Math.min(i + 1, text.length)), t);
      if (lp.x < (wx + nx) / 2) { col = i; break; }
    }
    /* 줄 번호 + 열 -> 전체 문자열에서의 위치 */
    var idx = 0, all = String(t.content).split('\n');
    /* 자동 줄바꿈된 영역 문자는 줄 배열이 원문과 다르므로 원문에서 다시 찾는다 */
    var flat = lines.map(function (l) { return typeof l === 'string' ? l : (l.text || ''); });
    if (t.area) {
      for (var r = 0; r < row; r++) idx += flat[r].length;
      /* 자동 줄바꿈 자리의 공백을 되돌린다 (근사) */
      var joined = flat.slice(0, row).join('');
      var raw = String(t.content);
      var probe = raw.replace(/\s+/g, '');
      void probe; void joined;
      idx = Math.min(idx + col, raw.length);
      return idx;
    }
    for (var r2 = 0; r2 < row && r2 < all.length; r2++) idx += all[r2].length + 1;
    return Math.min(idx + col, String(t.content).length);
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

    /* 일러스트레이터의 문자 도구는 세 갈래다.
         글자 위 클릭     누른 자리에 커서를 두고 편집
         닫힌 도형 클릭   그 도형 안으로 글을 흘린다 (영역 문자)
         빈 곳 클릭/드래그  점 문자 / 그 크기의 영역 문자 상자 */
    onDown: function (app, e) {
      var hit = H.itemAt(app, e.x, e.y, true);
      if (editing && hit === editing.it) return;
      commitEdit(app);

      if (hit && hit.type === 'text') {
        app.history.begin('텍스트 편집', app.doc);
        AI.sel.set(app, [hit]);
        startEdit(app, hit, false, caretIndexAt(app, hit, e.x, e.y));
        return;
      }
      if (isClosedPath(hit)) { shapeToAreaText(app, hit); return; }

      /* 빈 곳 — 끌면 영역 문자, 그냥 누르면 점 문자. onUp 에서 가른다. */
      dragBox = { start: AI.viewT.toDoc(app, e.x, e.y), sx: e.x, sy: e.y, moved: false };
    },

    onMove: function (app, e) {
      if (!dragBox || !e.down) return;
      if (Math.hypot(e.x - dragBox.sx, e.y - dragBox.sy) < 3) return;
      dragBox.moved = true;
      app.marquee = AI.rect.fromPts(dragBox.sx, dragBox.sy, e.x, e.y);
      app.invalidate();
    },

    onUp: function (app, e) {
      if (!dragBox) return;
      var st0 = dragBox;
      dragBox = null;
      app.marquee = null;
      var d = AI.viewT.toDoc(app, e.x, e.y);
      var w = Math.abs(d.x - st0.start.x), h = Math.abs(d.y - st0.start.y);
      var it;
      if (st0.moved && w > 6 && h > 6) {
        app.history.begin('영역 문자', app.doc);
        it = makeAreaText(app, Math.min(st0.start.x, d.x), Math.min(st0.start.y, d.y), w, h, null);
      } else {
        app.history.begin('텍스트 만들기', app.doc);
        it = Model.newText(st0.start.x, st0.start.y, '');
        it.text.size = app.typeOpts ? app.typeOpts.size : 24;
        it.text.family = app.typeOpts ? app.typeOpts.family : it.text.family;
        it.fill = U.deepCopy(app.textFill || Col.solid('#000000'));
        it.stroke = Model.defaultStroke();
        Model.activeLayer(app.doc).children.push(it);
      }
      AI.sel.set(app, [it]);
      startEdit(app, it, false);
      app.invalidate();
    },

    onKey: function () { return false; }
  });

  /* ---------------- 영역 문자 도구 ----------------
     · 닫힌 패스를 클릭하면 그 도형 안으로 글이 흘러 들어간다
     · 빈 곳을 드래그하면 그 크기의 사각 상자를 만든다
     · 상자를 클릭하면 편집                                          */
  var areaSt = null;

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
      if (isClosedPath(hit)) { shapeToAreaText(app, hit); return; }
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
  /* ---------------- 패스 상 문자 도구 ----------------
     · 패스를 클릭하면 그 패스를 기준선 삼아 글이 흐른다 (일러스트레이터와 같이
       원본 패스는 문자 오브젝트가 되면서 사라진다)
     · 클릭 지점이 곧 글의 시작 위치가 된다                          */
  T.mk({
    id: 'typepath', name: '패스 상 문자 도구', key: null, cursor: 'text',
    activate: function (app) { bindTextarea(app); },
    deactivate: function (app) { commitEdit(app); },

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
      if (!hit || hit.type !== 'path') { U.toast('글을 흘릴 패스를 클릭하세요'); return; }

      app.history.begin('패스 상의 문자', app.doc);
      /* 클릭 지점까지의 호 길이를 시작 위치로 삼는다 */
      var d = AI.viewT.toDoc(app, e.x, e.y);
      var wm = Model.worldMatrix(app.doc, hit);
      var start = arcLengthNear(hit.subs, wm, d.x, d.y);
      var it = AI.edit.makePathText(app, hit, start);
      AI.sel.set(app, [it]);
      startEdit(app, it, false);
      app.invalidate();
    },

    onUp: function () { },
    onKey: function () { return false; }
  });

  /* 클릭 지점에 가장 가까운 패스 위치까지의 호 길이 */
  function arcLengthNear(subs, wm, x, y) {
    var walk = AI.geom.walker(subs, 0.3, wm);
    if (!walk || !walk.length) return 0;
    var best = 0, bd = Infinity;
    var steps = Math.max(24, Math.min(600, Math.round(walk.length / 2)));
    for (var i = 0; i <= steps; i++) {
      var s = walk.length * i / steps, q = walk.at(s);
      if (!q) continue;
      var dd = (q.x - x) * (q.x - x) + (q.y - y) * (q.y - y);
      if (dd < bd) { bd = dd; best = s; }
    }
    return best;
  }

})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
