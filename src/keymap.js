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
    'Shift+E': 'eraser', 'C': 'scissors', 'Shift+M': 'shapebuilder',
    'R': 'rotate', 'O': 'reflect', 'S': 'scale', 'E': 'freetransform',
    'G': 'gradient', 'I': 'eyedropper', 'Shift+W': 'width',
    'Shift+O': 'artboard', 'Z': 'zoom', 'H': 'hand'
  };

  /* ---------------- 브라우저가 가져가는 키 ----------------
     탭·창을 다루는 키는 preventDefault 로도 막히지 않는다. 페이지가 아예
     이벤트를 받지 못하기 때문이다. 전체 화면 + 키보드 잠금을 켜면 이것들까지
     들어오지만, 그 전에도 쓸 수 있도록 충돌하는 것마다 대체 키를 함께 건다.  */
  K.BROWSER_RESERVED = {
    'Ctrl+1': '탭 1 로 이동', 'Ctrl+2': '탭 2 로 이동', 'Ctrl+3': '탭 3 으로 이동',
    'Ctrl+4': '탭 4 로 이동', 'Ctrl+5': '탭 5 로 이동', 'Ctrl+6': '탭 6 으로 이동',
    'Ctrl+7': '탭 7 로 이동', 'Ctrl+8': '탭 8 로 이동', 'Ctrl+9': '마지막 탭으로 이동',
    'Ctrl+N': '새 창', 'Ctrl+T': '새 탭', 'Ctrl+W': '탭 닫기',
    'Ctrl+Shift+N': '시크릿 창', 'Ctrl+Shift+T': '닫은 탭 다시 열기', 'Ctrl+Shift+W': '창 닫기',
    'Ctrl+Tab': '다음 탭', 'Ctrl+Shift+Tab': '이전 탭'
  };

  /* 충돌하는 단축키의 대체 키 — Alt 계열은 브라우저가 건드리지 않는다 */
  K.ALTERNATES = {
    'Ctrl+0': 'Alt+0', 'Ctrl+1': 'Alt+1', 'Ctrl+2': 'Alt+2', 'Ctrl+3': 'Alt+3',
    'Ctrl+5': 'Alt+5', 'Ctrl+6': 'Alt+6', 'Ctrl+7': 'Alt+7', 'Ctrl+8': 'Alt+8',
    'Ctrl+N': 'Alt+N', 'Ctrl+W': 'Alt+W',
    'Ctrl+Tab': 'Ctrl+Alt+ArrowRight', 'Ctrl+Shift+Tab': 'Ctrl+Alt+ArrowLeft'
  };

  /* 이 단축키를 지금 이 환경에서 실제로 쓸 수 있는가 */
  K.isReserved = function (sig) {
    if (K.locked) return false;               /* 키보드 잠금 중이면 전부 들어온다 */
    if (K.standalone()) {
      /* 앱 창(PWA)에는 탭이 없다 — 탭을 다루던 키가 통째로 풀린다.
         창을 다루는 Ctrl+N · Ctrl+T · Ctrl+W 는 앱 창에서도 브라우저 몫이다. */
      var n = normalize(sig);
      if (/^Ctrl\+[0-9]$/.test(n)) return false;
      if (n === 'Ctrl+Tab' || n === 'Ctrl+Shift+Tab') return false;
    }
    return !!K.BROWSER_RESERVED[normalize(sig)];
  };

  K.standalone = function () {
    return !!(U.hasDOM && window.matchMedia &&
      (window.matchMedia('(display-mode: standalone)').matches ||
        window.matchMedia('(display-mode: window-controls-overlay)').matches ||
        window.navigator.standalone));
  };

  /* ---------------- 전체 화면 + 키보드 잠금 ----------------
     Keyboard Lock API 는 전체 화면일 때만 동작하고, 크롬 계열에서만 있다.
     켜지면 Ctrl+W · Ctrl+T · Ctrl+1~9 까지 페이지로 들어온다. */
  K.canLock = function () {
    return !!(U.hasDOM && navigator.keyboard && navigator.keyboard.lock &&
      document.documentElement.requestFullscreen);
  };
  K.locked = false;

  K.lockKeys = function (app) {
    if (!K.canLock()) {
      U.toast('이 브라우저는 키보드 잠금을 지원하지 않습니다 (크롬 · 엣지에서 사용 가능)');
      return Promise.resolve(false);
    }
    var el = document.documentElement;
    var enter = document.fullscreenElement ? Promise.resolve() : el.requestFullscreen();
    return enter.then(function () {
      return navigator.keyboard.lock();
    }).then(function () {
      K.locked = true;
      U.toast('단축키 완전 사용 — Ctrl+W · Ctrl+1~8 까지 앱이 받습니다 (나가려면 Esc 길게)');
      AI.ui && AI.ui.syncAll && AI.ui.syncAll(app);
      return true;
    }).catch(function (e) {
      U.toast('전체 화면으로 전환하지 못했습니다' + (e && e.message ? ' — ' + e.message : ''));
      return false;
    });
  };

  K.unlockKeys = function (app) {
    if (navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock();
    K.locked = false;
    var out = document.fullscreenElement ? document.exitFullscreen() : Promise.resolve();
    return out.catch(function () { }).then(function () {
      AI.ui && AI.ui.syncAll && AI.ui.syncAll(app);
    });
  };

  K.toggleLock = function (app) {
    return K.locked ? K.unlockKeys(app) : K.lockKeys(app);
  };

  /* 명령 단축키 색인 */
  var cmdIndex = null;
  function buildIndex() {
    cmdIndex = {};
    Object.keys(C.defs).forEach(function (id) {
      var d = C.defs[id];
      if (d.key) cmdIndex[normalize(d.key)] = id;
    });
    /* 브라우저에 막히는 것들의 대체 키를 함께 걸어 둔다 */
    Object.keys(K.ALTERNATES).forEach(function (sig) {
      var id = cmdIndex[normalize(sig)];
      if (id && !cmdIndex[normalize(K.ALTERNATES[sig])]) {
        cmdIndex[normalize(K.ALTERNATES[sig])] = id;
      }
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

    /* Esc 길게 등으로 전체 화면이 풀리면 키보드 잠금도 함께 풀린다 */
    U.on(document, 'fullscreenchange', function () {
      if (!document.fullscreenElement && K.locked) {
        K.locked = false;
        if (navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock();
        AI.ui && AI.ui.syncAll && AI.ui.syncAll(app);
      }
    });
  };

  /* 표시용 문자열 — 브라우저가 가져가는 키는 대체 키를 대신 보여 준다.
     메뉴에 적힌 키가 실제로 안 먹히는 것만큼 헷갈리는 게 없다. */
  K.display = function (k) {
    if (!k) return '';
    var sig = normalize(k);
    if (K.isReserved(sig) && K.ALTERNATES[sig]) k = K.ALTERNATES[sig];
    return K.pretty(k);
  };
  K.pretty = function (k) {
    if (!k) return '';
    if (U.isMac) return k.replace(/Ctrl/g, '⌘').replace(/Alt/g, '⌥').replace(/Shift/g, '⇧').replace(/\+/g, '');
    return k.replace(/ArrowRight/g, '→').replace(/ArrowLeft/g, '←')
      .replace(/ArrowUp/g, '↑').replace(/ArrowDown/g, '↓');
  };

  /* 단축키 한 줄 정보 — 대화상자와 진단에서 쓴다 */
  K.audit = function () {
    if (!cmdIndex) buildIndex();
    var out = [];
    Object.keys(C.defs).forEach(function (id) {
      var d = C.defs[id];
      if (!d.key) return;
      var sig = normalize(d.key);
      out.push({
        id: id, label: d.label, key: sig,
        reserved: K.isReserved(sig) ? K.BROWSER_RESERVED[sig] : null,
        alternate: K.ALTERNATES[sig] || null
      });
    });
    return out.sort(function (a, b) { return a.label.localeCompare(b.label, 'ko'); });
  };
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
