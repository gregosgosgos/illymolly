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
    var subPop = null;
    function closeSub() { if (subPop) { subPop.remove(); subPop = null; } }
    pop.__closeSub = closeSub;

    items.forEach(function (id) {
      if (id === '-') { pop.appendChild(U.el('div', 'sep')); return; }
      /* 서브메뉴 — { label, items:[…] } (일러스트레이터의 [선택 > 동일 ▸] 같은 것) */
      if (id && typeof id === 'object' && id.items) {
        var sm = U.el('div', 'mi has-sub');
        sm.innerHTML = '<span class="chk"></span><span>' + id.label + '</span><span class="k">›</span>';
        U.on(sm, 'mousedown', function (ev) { ev.preventDefault(); });
        U.on(sm, 'mouseenter', function () {
          closeSub();
          U.qa('.mi.has-sub', pop).forEach(function (x) { x.classList.remove('open'); });
          subPop = buildPop(app, id.items);
          document.body.appendChild(subPop);
          var r = sm.getBoundingClientRect();
          subPop.style.left = (r.right - 3) + 'px';
          subPop.style.top = (r.top - 4) + 'px';
          /* 화면 밖으로 나가면 왼쪽으로 편다 */
          var w = subPop.getBoundingClientRect().width;
          if (r.right + w > window.innerWidth) subPop.style.left = Math.max(0, r.left - w + 3) + 'px';
          sm.classList.add('open');
        });
        pop.appendChild(sm);
        return;
      }
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
      /* 다른 항목으로 넘어가면 열려 있던 서브메뉴를 닫는다 */
      U.on(mi, 'mouseenter', function () {
        closeSub();
        U.qa('.mi.has-sub', pop).forEach(function (x) { x.classList.remove('open'); });
      });
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
    if (openMenu) {
      if (openMenu.pop.__closeSub) openMenu.pop.__closeSub();
      openMenu.pop.remove();
      openMenu.el.classList.remove('open');
      openMenu = null;
    }
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
      var inSub = ev.target.closest && ev.target.closest('.menu-pop');
      if (openMenu && !openMenu.pop.contains(ev.target) && !openMenu.el.contains(ev.target) && !inSub) close();
      var cm = document.getElementById('contextmenu');
      if (!cm.hidden && !cm.contains(ev.target)) cm.hidden = true;
    });
  };

  /* ---------------- 컨텍스트 메뉴 ---------------- */
  UI.showContext = function (app, x, y) {
    var cm = document.getElementById('contextmenu');
    cm.innerHTML = '';
    cm.className = 'menu-pop';
    var items;
    if (app.sel.length) {
      items = ['undo', 'redo', '-', 'transformAgain', 'transformEach', '-',
        'bringToFront', 'sendToBack', '-', 'group', 'ungroup', '-',
        'clipMake', 'compoundMake', '-'];
      /* 일러스트레이터처럼 선택 내용에 맞는 항목을 끼워 넣는다 */
      if (app.sel.some(function (it) { return it.type === 'path' && it.shape && it.shape.kind === 'rect'; })) {
        items = items.concat(['corners', '-']);
      }
      if (app.sel.some(function (it) { return it.type === 'image'; })) {
        items = items.concat(['imageTrace', 'cropImage', '-']);
      }
      if (app.sel.some(function (it) { return AI.effects.hasAny(it); })) {
        items = items.concat(['fxClear', '-']);
      }
      items = items.concat(['lock', 'hide', '-', 'cut', 'copy', 'paste']);
    } else {
      items = ['undo', 'redo', '-', 'paste', 'pasteInPlace', '-', 'selectAll', 'showAll', 'unlockAll', '-',
        'showRulers', 'showGrid', 'smartGuides', '-', 'showGuides', 'lockGuides'];
    }
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
