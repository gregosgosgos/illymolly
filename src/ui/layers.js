/* =========================================================================
   ui/layers.js — 레이어 패널
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, Model = AI.model, C = AI.commands;
  var UI = AI.ui = AI.ui || {};

  var dragSrc = null;

  UI.buildLayers = function (app) {
    var p = document.getElementById('p-layers');
    if (!p) return;
    p.innerHTML = '';
    var wrap = U.el('div', 'lyr-list');

    for (var i = app.doc.layers.length - 1; i >= 0; i--) {
      (function (ly, li) {
        wrap.appendChild(layerRow(app, ly, li));
        if (!ly.collapsed) {
          for (var j = ly.children.length - 1; j >= 0; j--) {
            appendItemRows(app, wrap, ly.children[j], ly, 1);
          }
        }
      })(app.doc.layers[i], i);
    }
    p.appendChild(wrap);

    var tools = U.el('div', 'lyr-tools');
    tools.innerHTML =
      '<button class="mini-btn" id="ly-new" title="새 레이어">' + UI.icon('newLayer', 13) + '</button>' +
      '<button class="mini-btn" id="ly-sub" title="새 하위 레이어">' + UI.icon('newSublayer', 13) + '</button>' +
      '<button class="mini-btn" id="ly-merge" title="선택한 레이어 병합">' + UI.icon('merge', 13) + '</button>' +
      '<button class="mini-btn" id="ly-dup" title="선택 항목 복제">' + UI.icon('duplicate', 13) + '</button>' +
      '<button class="mini-btn danger" id="ly-del" title="삭제">' + UI.icon('trash', 13) + '</button>';
    p.appendChild(tools);

    U.on(U.q('#ly-sub', tools), 'click', function () {
      app.history.begin('새 하위 레이어', app.doc);
      var host = Model.activeLayer(app.doc);
      var g = Model.newGroup([]);
      g.isLayer = true;
      var pal = Model.LAYER_COLORS;
      g.color = pal[(app.doc.layers.length + host.children.length) % pal.length];
      g.name = '하위 레이어 ' + (host.children.filter(function (c) { return c.isLayer; }).length + 1);
      host.children.push(g);
      app.history.commit();
      UI.buildLayers(app);
    });
    U.on(U.q('#ly-merge', tools), 'click', function () { C.run('mergeLayers'); });

    U.on(U.q('#ly-new', tools), 'click', function () {
      app.history.begin('새 레이어', app.doc);
      app.doc.layers.push(Model.newLayer('레이어 ' + (app.doc.layers.length + 1), app.doc.layers.length));
      app.doc.activeLayer = app.doc.layers.length - 1;
      app.history.commit();
      UI.buildLayers(app);
    });
    U.on(U.q('#ly-dup', tools), 'click', function () { C.run('duplicate'); });
    U.on(U.q('#ly-del', tools), 'click', function () {
      if (app.sel.length) { C.run('clear'); return; }
      if (app.doc.layers.length < 2) return;
      app.history.begin('레이어 삭제', app.doc);
      app.doc.layers.splice(app.doc.activeLayer, 1);
      app.doc.activeLayer = Math.max(0, app.doc.activeLayer - 1);
      app.history.commit();
      UI.buildLayers(app);
      app.invalidate();
    });
  };

  function layerRow(app, ly, li) {
    var multi = (app.selLayers || []).indexOf(li) >= 0;
    var row = U.el('div', 'lyr' + (app.doc.activeLayer === li ? ' sel' : '') + (multi ? ' multi' : ''));
    row.draggable = true;
    var anySel = app.sel.some(function (it) { var l = Model.locate(app.doc, it); return l && l.layer === ly; });
    row.innerHTML =
      '<span class="eye' + (ly.visible ? '' : ' off') + '" title="표시 / 숨기기">' +
      UI.icon(ly.visible ? 'eye' : 'eyeOff', 13) + '</span>' +
      '<span class="lock' + (ly.locked ? '' : ' off') + '" title="잠금 / 잠금 해제">' +
      UI.icon(ly.locked ? 'lock' : 'unlock', 13) + '</span>' +
      '<span class="tw" title="펼치기 / 접기">' + UI.icon(ly.collapsed ? 'caretRight' : 'caretDown', 11) + '</span>' +
      '<span class="lyr-color" style="background:' + ly.color + '"></span>' +
      '<span class="nm">' + esc(ly.name) + '</span>' +
      '<span class="target" title="레이어 전체 선택">' + UI.icon(anySel ? 'targetOn' : 'target', 12) + '</span>' +
      '<span class="selsq" style="' + (anySel ? 'background:' + ly.color + ';border-color:' + ly.color : '') + '"></span>';
    U.on(U.q('.eye', row), 'click', function (e) { e.stopPropagation(); ly.visible = !ly.visible; app.invalidate(); UI.buildLayers(app); });
    U.on(U.q('.lock', row), 'click', function (e) { e.stopPropagation(); ly.locked = !ly.locked; UI.buildLayers(app); });
    U.on(U.q('.tw', row), 'click', function (e) { e.stopPropagation(); ly.collapsed = !ly.collapsed; UI.buildLayers(app); });
    U.on(row, 'click', function (e) {
      /* Ctrl/Shift 클릭으로 여러 레이어를 골라 병합할 수 있다 */
      app.selLayers = app.selLayers || [];
      var ctrl = U.isMac ? e.metaKey : e.ctrlKey;
      if (ctrl) {
        var k = app.selLayers.indexOf(li);
        if (k >= 0) app.selLayers.splice(k, 1); else app.selLayers.push(li);
      } else if (e.shiftKey && app.selLayers.length) {
        var lo = Math.min(app.selLayers[0], li), hi = Math.max(app.selLayers[0], li);
        app.selLayers = [];
        for (var q = lo; q <= hi; q++) app.selLayers.push(q);
      } else {
        app.selLayers = [li];
      }
      app.doc.activeLayer = li;
      UI.buildLayers(app);
    });
    U.on(U.q('.target', row), 'click', function (e) {
      e.stopPropagation();
      app.doc.activeLayer = li;
      AI.sel.set(app, ly.children.filter(function (c) { return c.visible && !c.locked; }));
      app.invalidate();
      UI.syncSelection(app);
      UI.buildLayers(app);
    });
    bindRename(app, U.q('.nm', row), ly);
    bindDrag(app, row, { kind: 'layer', index: li });
    return row;
  }

  function appendItemRows(app, wrap, it, layer, depth) {
    var row = U.el('div', 'lyr' + (AI.sel.has(app, it) ? ' sel' : ''));
    row.draggable = true;
    var pad = 4 + depth * 12;
    row.style.paddingLeft = pad + 'px';
    var isGroup = it.type === 'group';
    var selected = AI.sel.has(app, it);
    var col = it.isLayer ? (it.color || '#2d8ceb') : ((layer && layer.color) || '#2d8ceb');
    row.innerHTML =
      '<span class="eye' + (it.visible ? '' : ' off') + '" title="표시 / 숨기기">' +
      UI.icon(it.visible ? 'eye' : 'eyeOff', 13) + '</span>' +
      '<span class="lock' + (it.locked ? '' : ' off') + '" title="잠금 / 잠금 해제">' +
      UI.icon(it.locked ? 'lock' : 'unlock', 13) + '</span>' +
      (isGroup ? '<span class="tw" title="펼치기 / 접기">' + UI.icon(it.collapsed ? 'caretRight' : 'caretDown', 11) + '</span>'
        : '<span class="tw"></span>') +
      (it.isLayer ? '<span class="lyr-color" style="background:' + col + '"></span>' : '') +
      '<span class="nm">' + esc(itemLabel(it)) + '</span>' +
      '<span class="target" title="이 항목을 타겟으로 선택">' + UI.icon(selected ? 'targetOn' : 'target', 12) + '</span>' +
      '<span class="selsq" style="' + (selected ? 'background:' + col + ';border-color:' + col : '') + '"></span>';
    U.on(U.q('.eye', row), 'click', function (e) { e.stopPropagation(); it.visible = !it.visible; app.invalidate(); UI.buildLayers(app); });
    U.on(U.q('.lock', row), 'click', function (e) { e.stopPropagation(); it.locked = !it.locked; UI.buildLayers(app); });
    if (isGroup) U.on(U.q('.tw', row), 'click', function (e) { e.stopPropagation(); it.collapsed = !it.collapsed; UI.buildLayers(app); });
    U.on(row, 'click', function (e) {
      if (e.shiftKey) AI.sel.toggle(app, it); else AI.sel.set(app, [it]);
      app.invalidate();
      UI.syncSelection(app);
      UI.buildLayers(app);
    });
    U.on(U.q('.target', row), 'click', function (e) {
      e.stopPropagation();
      AI.sel.set(app, [it]);
      app.invalidate();
      UI.syncSelection(app);
      UI.buildLayers(app);
    });
    bindRename(app, U.q('.nm', row), it);
    bindDrag(app, row, { kind: 'item', item: it });
    wrap.appendChild(row);
    if (isGroup && !it.collapsed) {
      for (var i = it.children.length - 1; i >= 0; i--) appendItemRows(app, wrap, it.children[i], layer, depth + 1);
    }
  }

  function itemLabel(it) {
    if (it.type === 'text') return '<' + (it.text.content.split('\n')[0].slice(0, 14) || '텍스트') + '>';
    if (it.type === 'group') return it.isLayer ? (it.name || '하위 레이어') : (it.clip ? '클립 그룹' : '그룹');
    if (it.type === 'image') return it.name || '이미지';
    return it.name || '패스';
  }

  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  function bindRename(app, el, target) {
    U.on(el, 'dblclick', function (e) {
      e.stopPropagation();
      el.contentEditable = 'true';
      el.focus();
      document.execCommand && document.execCommand('selectAll', false, null);
    });
    U.on(el, 'keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    });
    U.on(el, 'blur', function () {
      if (el.contentEditable !== 'true') return;
      el.contentEditable = 'false';
      var v = el.textContent.trim();
      if (v) { target.name = v; }
      UI.buildLayers(app);
    });
  }

  function bindDrag(app, row, ref) {
    U.on(row, 'dragstart', function (e) {
      dragSrc = ref;
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', 'x'); } catch (err) { }
    });
    U.on(row, 'dragover', function (e) {
      if (!dragSrc) return;
      e.preventDefault();
      row.style.borderTop = '1px solid #2d8ceb';
    });
    U.on(row, 'dragleave', function () { row.style.borderTop = ''; });
    U.on(row, 'drop', function (e) {
      e.preventDefault();
      row.style.borderTop = '';
      if (!dragSrc) return;
      app.history.begin('순서 변경', app.doc);
      applyDrop(app, dragSrc, ref);
      app.history.commit();
      dragSrc = null;
      app.invalidate();
      UI.buildLayers(app);
    });
  }

  function contains(parent, it) {
    if (parent === it) return true;
    if (parent.type !== 'group') return false;
    return parent.children.some(function (c) { return contains(c, it); });
  }

  function applyDrop(app, src, dst) {
    if (src.kind === 'layer' && dst.kind === 'layer') {
      var l = app.doc.layers.splice(src.index, 1)[0];
      app.doc.layers.splice(dst.index, 0, l);
      return;
    }
    if (src.kind === 'item') {
      var sl = Model.locate(app.doc, src.item);
      if (!sl) return;
      sl.list.splice(sl.index, 1);
      if (dst.kind === 'layer') {
        app.doc.layers[dst.index].children.push(src.item);
      } else if (dst.item === src.item) {
        /* 자기 자신 위에 놓으면 아무것도 하지 않는다 */
        var back = Model.locate(app.doc, src.item);
        if (!back) Model.activeLayer(app.doc).children.push(src.item);
      } else if (dst.item.type === 'group' && !contains(dst.item, src.item)) {
        /* 그룹(하위 레이어) 위에 놓으면 그 안으로 넣는다 */
        dst.item.children.push(src.item);
      } else {
        var dl = Model.locate(app.doc, dst.item);
        if (!dl) { Model.activeLayer(app.doc).children.push(src.item); return; }
        dl.list.splice(dl.index + 1, 0, src.item);
      }
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
