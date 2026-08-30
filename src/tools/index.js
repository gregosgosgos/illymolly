/* =========================================================================
   tools/index.js — 도구 패널 구성 / 아이콘 / 플라이아웃
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, T = AI.tools;

  T.icons = {
    select: '<path d="M4 2 L4 14.5 L7.4 11 L9.6 15.4 L11.4 14.6 L9.3 10.4 L14 10 Z"/>',
    directselect: '<path d="M4.5 2.5 L4.5 13.5 L7.4 10.6 L9.4 14.6 L10.8 14 L8.9 10.1 L12.8 9.7 Z" fill="none"/>',
    groupselect: '<path d="M4 2 L4 13 L7 10 L9 14 L10.4 13.4 L8.5 9.6 L12.4 9.2 Z"/><circle cx="12.5" cy="13" r="1.6" fill="none"/>',
    magicwand: '<path d="M3 14 L11 6"/><path d="M12 2 l1 2.2 2.2 1 -2.2 1 -1 2.2 -1-2.2 -2.2-1 2.2-1z"/>',
    pen: '<path d="M8 1.5 L12.5 9 L8 14.5 L3.5 9 Z"/><path d="M8 9 L8 14.5"/>',
    addanchor: '<path d="M8 1.5 L12.5 9 L8 14.5 L3.5 9 Z"/><path d="M11.5 12.5h3M13 11v3"/>',
    delanchor: '<path d="M8 1.5 L12.5 9 L8 14.5 L3.5 9 Z"/><path d="M11.5 12.5h3"/>',
    convert: '<path d="M2 12 C6 12 6 4 10 4"/><circle cx="2" cy="12" r="1.4"/><circle cx="10" cy="4" r="1.4"/>',
    type: '<path d="M3 3.5 H13 M8 3.5 V14"/>',
    typearea: '<rect x="2.5" y="2.5" width="11" height="11"/><path d="M5 6h6M8 6v5"/>',
    line: '<path d="M3 13 L13 3"/>',
    rect: '<rect x="2.5" y="4.5" width="11" height="8"/>',
    roundrect: '<rect x="2.5" y="4.5" width="11" height="8" rx="2.5"/>',
    ellipse: '<ellipse cx="8" cy="8.5" rx="5.5" ry="4.5"/>',
    polygon: '<path d="M8 2.5 L13.5 6.5 L11.5 13 L4.5 13 L2.5 6.5 Z"/>',
    star: '<path d="M8 2 l1.8 4.1 4.4 .4 -3.3 2.9 1 4.3 -3.9-2.3 -3.9 2.3 1-4.3 -3.3-2.9 4.4-.4z"/>',
    brush: '<path d="M3 13.5 c3 0 3.5-2.5 5-4 M9.5 8 l4-4.5 -1.5-1.5 -4.5 4"/>',
    pencil: '<path d="M2.5 13.5 l1-3 8-8 2 2 -8 8z"/><path d="M10 4l2 2"/>',
    blob: '<path d="M4 13 c-2-2 0-5 3-6 c3-1 6 1 6 3 c0 2-2 3-4 3z"/>',
    eraser: '<path d="M6 13.5 L2.5 10 L9.5 3 L13 6.5 Z"/><path d="M6 13.5 H13.5"/>',
    scissors: '<circle cx="4" cy="12.5" r="1.8"/><circle cx="11" cy="12.5" r="1.8"/><path d="M5.2 11 L12 2.5M9.8 11 L3 2.5"/>',
    rotate: '<path d="M12.5 8 A4.5 4.5 0 1 1 8 3.5"/><path d="M8 1 L8 6 L11.5 3.5 Z"/>',
    reflect: '<path d="M8 1.5 V14.5"/><path d="M6.5 4 L2.5 8 L6.5 12z"/><path d="M9.5 4 L13.5 8 L9.5 12z" fill="none"/>',
    scale: '<path d="M3 13 L13 3"/><rect x="1.5" y="11.5" width="3" height="3"/><rect x="11.5" y="1.5" width="3" height="3"/>',
    shear: '<path d="M4 12 H14 L12 4 H2 Z"/>',
    freetransform: '<rect x="3.5" y="3.5" width="9" height="9"/><rect x="2" y="2" width="3" height="3"/><rect x="11" y="11" width="3" height="3"/>',
    smooth: '<path d="M2 12 C5 4 11 12 14 4"/>',
    gradient: '<rect x="2.5" y="4.5" width="11" height="7"/><path d="M2.5 11.5 L13.5 4.5"/>',
    eyedropper: '<path d="M3 13 L8.5 7.5"/><path d="M9 6 L12 3 L13.5 4.5 L10.5 7.5z"/>',
    artboard: '<rect x="2.5" y="3.5" width="11" height="9" stroke-dasharray="2 1.6"/>',
    zoom: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 L14 14"/>',
    hand: '<path d="M5 13 V6.5 a1 1 0 0 1 2 0 V4 a1 1 0 0 1 2 0 v2.5 a1 1 0 0 1 2 0 V8 a1 1 0 0 1 2 0 v3 c0 2-2 3.5-4 3.5H8z"/>'
  };

  /* 슬롯: 첫 번째가 기본, 나머지는 플라이아웃 */
  T.SLOTS = [
    ['select'], ['directselect', 'groupselect'],
    ['magicwand'], ['pen', 'addanchor', 'delanchor', 'convert'],
    ['type', 'typearea'], ['line'],
    ['rect', 'roundrect', 'ellipse', 'polygon', 'star'],
    ['brush', 'blob'], ['pencil', 'smooth'],
    ['eraser', 'scissors'],
    ['rotate', 'reflect'], ['scale', 'shear'],
    ['freetransform'],
    ['gradient', 'eyedropper'],
    ['artboard'],
    ['zoom', 'hand']
  ];

  T.buildToolbar = function (app) {
    var bar = document.getElementById('toolbar');
    bar.innerHTML = '';
    T.SLOTS.forEach(function (slot, si) {
      var current = app.slotChoice && app.slotChoice[si] ? app.slotChoice[si] : slot[0];
      var t = T.get(current);
      if (!t) return;
      var el = U.el('div', 'tool');
      el.dataset.tool = current;
      el.dataset.slot = si;
      el.title = t.name + (t.key ? '  (' + t.key.toUpperCase() + ')' : '');
      el.innerHTML = '<svg viewBox="0 0 16 16">' + (T.icons[current] || '<rect x="3" y="3" width="10" height="10"/>') + '</svg>' +
        (slot.length > 1 ? '<span class="flyarrow"></span>' : '');
      if (app.tool === current) el.classList.add('active');

      var pressTimer = null;
      U.on(el, 'mousedown', function (ev) {
        if (ev.button === 2) return;
        pressTimer = setTimeout(function () { showFly(app, si, slot, el); }, 380);
      });
      U.on(el, 'mouseup mouseleave', function () { clearTimeout(pressTimer); });
      U.on(el, 'click', function () { clearTimeout(pressTimer); T.setTool(app, current); });
      U.on(el, 'contextmenu', function (ev) { ev.preventDefault(); if (slot.length > 1) showFly(app, si, slot, el); });
      bar.appendChild(el);
      if (si === 2 || si === 6 || si === 9 || si === 12 || si === 14) bar.appendChild(U.el('div', 'tool-div'));
    });

    /* 칠 / 획 */
    var fs = U.el('div', 'fillstroke');
    fs.innerHTML =
      '<div class="fs-box">' +
      '<div class="fs-fill" id="fs-fill" title="칠 (X 로 전환)"></div>' +
      '<div class="fs-stroke" id="fs-stroke" title="획"></div>' +
      '<div class="fs-swap" id="fs-swap" title="칠/획 교체 (Shift+X)">⇄</div>' +
      '<div class="fs-def" id="fs-def" title="기본값 (D)">◧</div>' +
      '</div>';
    bar.appendChild(fs);

    U.on(U.q('#fs-fill', fs), 'click', function () { app.fillFocus = true; AI.ui.syncStyle(app); AI.ui.openColorPicker(app, this); });
    U.on(U.q('#fs-stroke', fs), 'click', function () { app.fillFocus = false; AI.ui.syncStyle(app); AI.ui.openColorPicker(app, this); });
    U.on(U.q('#fs-swap', fs), 'click', function () { AI.commands.run('swapFillStroke'); });
    U.on(U.q('#fs-def', fs), 'click', function () { AI.commands.run('defaultFillStroke'); });

    /* 기타 도구 (숨김 도구 접근용) */
    var extra = U.el('div', 'tool-div'); bar.appendChild(extra);
  };

  function showFly(app, si, slot, anchor) {
    var pop = document.getElementById('contextmenu');
    pop.innerHTML = '';
    pop.className = 'menu-pop';
    slot.forEach(function (id) {
      var t = T.get(id);
      if (!t) return;
      var mi = U.el('div', 'mi');
      mi.innerHTML = '<span style="display:inline-flex;width:18px"><svg viewBox="0 0 16 16" width="14" height="14" style="stroke:#ddd;fill:none;stroke-width:1.2">' + (T.icons[id] || '') + '</svg></span>' +
        '<span>' + t.name + '</span>' + (t.key ? '<span class="k">' + t.key.toUpperCase() + '</span>' : '');
      U.on(mi, 'click', function () {
        app.slotChoice = app.slotChoice || {};
        app.slotChoice[si] = id;
        pop.hidden = true;
        T.buildToolbar(app);
        T.setTool(app, id);
      });
      pop.appendChild(mi);
    });
    var r = anchor.getBoundingClientRect();
    pop.style.left = (r.right + 2) + 'px';
    pop.style.top = r.top + 'px';
    pop.hidden = false;
  }

  /* 도구 단축키 -> 슬롯 반영 */
  T.syncSlotFor = function (app, id) {
    T.SLOTS.forEach(function (slot, si) {
      if (slot.indexOf(id) >= 0) { app.slotChoice = app.slotChoice || {}; app.slotChoice[si] = id; }
    });
  };
})(window.AI);
