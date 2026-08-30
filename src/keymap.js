/* =========================================================================
   keymap.js — Illustrator 호환 키보드 단축키
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, T = AI.tools, C = AI.commands;
  var K = AI.keymap = {};

  var CODE = {
    BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.',
    Slash: '/', Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`',
    Space: 'Space', Escape: 'Escape', Enter: 'Enter', NumpadEnter: 'Enter', Tab: 'Tab',
    Backspace: 'Backspace', Delete: 'Delete',
    ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
    NumpadAdd: '=', NumpadSubtract: '-'
  };

  K.baseKey = function (ev) {
    var c = ev.code || '';
    if (/^Key[A-Z]$/.test(c)) return c.slice(3);
    if (/^Digit[0-9]$/.test(c)) return c.slice(5);
    if (/^Numpad[0-9]$/.test(c)) return c.slice(6);
    if (CODE[c]) return CODE[c];
    var k = ev.key;
    if (!k) return '';
    if (k === ' ') return 'Space';
    return k.length === 1 ? k.toUpperCase() : k;
  };

  K.sig = function (ev) {
    var parts = [];
    var ctrl = U.isMac ? ev.metaKey : ev.ctrlKey;
    if (ctrl) parts.push('Ctrl');
    if (ev.altKey) parts.push('Alt');
    if (ev.shiftKey) parts.push('Shift');
    parts.push(K.baseKey(ev));
    return parts.join('+');
  };

  /* 도구 단축키 (Illustrator 기본) */
  K.TOOLKEYS = {
    'V': 'select', 'A': 'directselect', 'Y': 'magicwand',
    'P': 'pen', '=': 'addanchor', 'Shift+=': 'addanchor', '-': 'delanchor', 'Shift+C': 'convert',
    'T': 'type', '\\': 'line',
    'M': 'rect', 'L': 'ellipse',
    'B': 'brush', 'Shift+B': 'blob', 'N': 'pencil',
    'Shift+E': 'eraser', 'C': 'scissors',
    'R': 'rotate', 'O': 'reflect', 'S': 'scale', 'E': 'freetransform',
    'G': 'gradient', 'I': 'eyedropper',
    'Shift+O': 'artboard', 'Z': 'zoom', 'H': 'hand'
  };

  /* 명령 단축키 색인 */
  var cmdIndex = null;
  function buildIndex() {
    cmdIndex = {};
    Object.keys(C.defs).forEach(function (id) {
      var d = C.defs[id];
      if (d.key) cmdIndex[normalize(d.key)] = id;
    });
    /* 대체 표기 */
    cmdIndex['Ctrl++'] = 'zoomIn';
    cmdIndex['Ctrl+Shift+='] = 'zoomIn';
    cmdIndex['Backspace'] = 'clear';
    cmdIndex['Ctrl+Y'] = 'outlineMode';
  }
  function normalize(k) {
    return k.split('+').map(function (p) { return p.length === 1 ? p.toUpperCase() : p; }).join('+');
  }
  K.cmdFor = function (s) { if (!cmdIndex) buildIndex(); return cmdIndex[s]; };

  K.install = function (app) {
    buildIndex();

    U.on(window, 'keydown', function (ev) {
      if (AI.dialog && AI.dialog.isOpen()) return;      /* 모달이 열려 있으면 도구 단축키 차단 */
      var tag = (ev.target && ev.target.tagName || '').toLowerCase();
      var editable = tag === 'input' || tag === 'textarea' || tag === 'select' || (ev.target && ev.target.isContentEditable);
      if (editable) {
        if (ev.key === 'Escape' && tag !== 'textarea') ev.target.blur();
        return;
      }
      if (T.isEditingText && T.isEditingText()) return;

      var s = K.sig(ev);
      var base = K.baseKey(ev);

      /* --- Space = 임시 손 도구, Ctrl+Space = 임시 확대 도구 (Illustrator) --- */
      var ctrlDown = U.isMac ? ev.metaKey : ev.ctrlKey;
      if (base === 'Space' && !app.spacePan) {
        ev.preventDefault();
        app.spacePan = true;
        app.spacePrevTool = app.tool;
        T.setTool(app, ctrlDown ? 'zoom' : 'hand', true);
        return;
      }
      /* Space 를 누른 상태에서 Ctrl 을 추가하면 손 -> 확대 로 전환 */
      if (app.spacePan && (base === 'Control' || base === 'Meta') && app.tool === 'hand') {
        T.setTool(app, 'zoom', true);
        return;
      }

      /* --- 도구 전용 키 처리 --- */
      var tool = T.current(app);
      if (tool && tool.onKey && tool.onKey(app, ev)) { ev.preventDefault(); return; }

      /* --- 화살표 넛지 --- */
      if (base.indexOf('Arrow') === 0 && !ev.ctrlKey && !ev.metaKey) {
        var inc = (app.prefs.keyIncrement || 1) * (ev.shiftKey ? 10 : 1);
        var dx = base === 'ArrowLeft' ? -inc : base === 'ArrowRight' ? inc : 0;
        var dy = base === 'ArrowUp' ? -inc : base === 'ArrowDown' ? inc : 0;
        if (ev.altKey && app.sel.length) {
          app.history.begin('복제', app.doc);
          AI.edit.duplicate(app, dx, dy);
          app.history.commit();
          app.invalidate();
        } else C.nudge(app, dx, dy);
        ev.preventDefault();
        return;
      }

      /* --- Escape --- */
      if (base === 'Escape') {
        if (T.endPen) T.endPen(app);
        if (app.isolation && app.isolation.length) C.run('exitIsolation');
        else AI.sel.clear(app);
        app.invalidate();
        ev.preventDefault();
        return;
      }

      /* --- 명령 --- */
      var id = cmdIndex[s];
      if (id) {
        ev.preventDefault();
        C.run(id);
        return;
      }

      /* --- 도구 --- */
      var mods = (U.isMac ? ev.metaKey : ev.ctrlKey) || ev.altKey;
      if (!mods) {
        var tid = K.TOOLKEYS[s];
        if (tid && T.get(tid)) {
          ev.preventDefault();
          T.setTool(app, tid);
          return;
        }
      }
    }, true);

    U.on(window, 'keyup', function (ev) {
      var bk = K.baseKey(ev);
      if (app.spacePan && (bk === 'Control' || bk === 'Meta') && app.tool === 'zoom') {
        T.setTool(app, 'hand', true);
        return;
      }
      if (bk === 'Space' && app.spacePan) {
        app.spacePan = false;
        var prev = app.spacePrevTool || 'select';
        app.spacePrevTool = null;
        T.setTool(app, prev, true);
      }
    }, true);

    /* 창을 벗어났다 돌아올 때 Space 상태 초기화 */
    U.on(window, 'blur', function () {
      if (app.spacePan) { app.spacePan = false; T.setTool(app, app.spacePrevTool || 'select', true); }
    });
  };

  /* 표시용 문자열 */
  K.display = function (k) {
    if (!k) return '';
    if (U.isMac) return k.replace(/Ctrl/g, '⌘').replace(/Alt/g, '⌥').replace(/Shift/g, '⇧').replace(/\+/g, '');
    return k;
  };
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
