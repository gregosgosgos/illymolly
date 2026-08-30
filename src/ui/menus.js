/* =========================================================================
   ui/menus.js — 메뉴 바 + 컨텍스트 메뉴
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, C = AI.commands, K = AI.keymap;
  var UI = AI.ui = AI.ui || {};

  var openMenu = null;

  function buildPop(app, items) {
    var pop = U.el('div', 'menu-pop menubar-pop');
    items.forEach(function (id) {
      if (id === '-') { pop.appendChild(U.el('div', 'sep')); return; }
      var d = C.defs[id];
      if (!d) return;
      var mi = U.el('div', 'mi');
      var enabled = !d.enabled || d.enabled(app);
      if (!enabled) mi.classList.add('disabled');
      var chk = d.checked ? (d.checked(app) ? '✓' : '') : '';
      var text = d.label2 ? d.label2(app) : d.label;
      mi.innerHTML = '<span class="chk">' + chk + '</span><span>' + text + '</span>' +
        (d.key ? '<span class="k">' + K.display(d.key) + '</span>' : '');
      U.on(mi, 'mousedown', function (ev) { ev.preventDefault(); });
      U.on(mi, 'click', function () {
        if (!enabled) return;
        close();
        C.run(id);
      });
      pop.appendChild(mi);
    });
    return pop;
  }

  function close() {
    if (openMenu) { openMenu.pop.remove(); openMenu.el.classList.remove('open'); openMenu = null; }
  }
  UI.closeMenus = close;

  UI.buildMenus = function (app) {
    var nav = document.getElementById('menus');
    nav.innerHTML = '';
    C.MENUS.forEach(function (m) {
      var el = U.el('div', 'menu-title', m.title);
      U.on(el, 'mousedown', function (ev) {
        ev.preventDefault();
        if (openMenu && openMenu.el === el) { close(); return; }
        close();
        var pop = buildPop(app, m.items);
        document.body.appendChild(pop);
        var r = el.getBoundingClientRect();
        pop.style.left = r.left + 'px';
        pop.style.top = r.bottom + 'px';
        el.classList.add('open');
        openMenu = { el: el, pop: pop };
      });
      U.on(el, 'mouseenter', function () {
        if (openMenu && openMenu.el !== el) {
          close();
          el.dispatchEvent(new MouseEvent('mousedown'));
        }
      });
      nav.appendChild(el);
    });
    U.on(document, 'mousedown', function (ev) {
      if (openMenu && !openMenu.pop.contains(ev.target) && !openMenu.el.contains(ev.target)) close();
      var cm = document.getElementById('contextmenu');
      if (!cm.hidden && !cm.contains(ev.target)) cm.hidden = true;
    });
  };

  /* ---------------- 컨텍스트 메뉴 ---------------- */
  UI.showContext = function (app, x, y) {
    var cm = document.getElementById('contextmenu');
    cm.innerHTML = '';
    cm.className = 'menu-pop';
    var items = app.sel.length
      ? ['undo', 'redo', '-', 'transformAgain', '-', 'bringToFront', 'sendToBack', '-', 'group', 'ungroup', '-',
        'clipMake', 'compoundMake', '-', 'lock', 'hide', '-', 'cut', 'copy', 'paste']
      : ['undo', 'redo', '-', 'paste', 'pasteInPlace', '-', 'selectAll', 'showAll', 'unlockAll', '-', 'showRulers', 'showGrid', 'smartGuides'];
    items.forEach(function (id) {
      if (id === '-') { cm.appendChild(U.el('div', 'sep')); return; }
      var d = C.defs[id];
      if (!d) return;
      var mi = U.el('div', 'mi');
      var enabled = !d.enabled || d.enabled(app);
      if (!enabled) mi.classList.add('disabled');
      mi.innerHTML = '<span class="chk"></span><span>' + (d.label2 ? d.label2(app) : d.label) + '</span>' +
        (d.key ? '<span class="k">' + K.display(d.key) + '</span>' : '');
      U.on(mi, 'click', function () { cm.hidden = true; if (enabled) C.run(id); });
      cm.appendChild(mi);
    });
    cm.style.left = x + 'px';
    cm.style.top = y + 'px';
    cm.hidden = false;
    var r = cm.getBoundingClientRect();
    if (r.bottom > innerHeight) cm.style.top = Math.max(0, innerHeight - r.height - 4) + 'px';
    if (r.right > innerWidth) cm.style.left = Math.max(0, innerWidth - r.width - 4) + 'px';
  };
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
