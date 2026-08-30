/* =========================================================================
   mobile.js — 모바일 / 터치 셸
   -------------------------------------------------------------------------
   설계 근거
   · Hoober(2013, n=1,333) 49% 한 손 조작 → 주 컨트롤을 하단 엄지 영역에 배치.
     왼손잡이 전환 제공.
   · Parhi/Karlson/Bederson(MobileHCI 2006) 이산 탭 9.2mm ≈ 35 CSS px
     → 모든 타깃 44px 이상(WCAG 2.2 SC 2.5.8 의 24px 하한을 크게 상회).
   · Kurtenbach & Buxton(CHI '93/'94) 마킹 메뉴 → 도구 전환은 방사형 메뉴로.
     초보는 눌러서 메뉴를 보고, 숙련자는 같은 방향으로 그어 바로 고른다.
   · Vogel & Baudisch, Shift(CHI 2007) → 정밀 조작 시 루페(render.js).
   · Procreate 관례 → 2손가락 탭 실행 취소, 3손가락 탭 다시 실행(app.js).
   · Guiard(1987) 양손 비대칭 → 2손가락은 도구와 무관하게 항상 캔버스 조작.

   패널은 새로 만들지 않고 데스크톱 패널 DOM 을 시트로 옮겨 재사용한다.
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, T = AI.tools, C = AI.commands, Model = AI.model;
  var Mob = AI.mobile = {};
  var app = null, built = false;

  /* ---------------- 아이콘 ---------------- */
  function svg(id) {
    return '<svg viewBox="0 0 16 16">' + (T.icons[id] || '<rect x="3" y="3" width="10" height="10"/>') + '</svg>';
  }
  var ICON = {
    menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
    undo: '<path d="M4 10h9a5 5 0 1 1 0 10H8"/><path d="M8 6 4 10l4 4"/>',
    redo: '<path d="M20 10h-9a5 5 0 1 0 0 10h5"/><path d="M16 6l4 4-4 4"/>',
    more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'
  };
  function icon(name) { return '<svg viewBox="0 0 24 24">' + ICON[name] + '</svg>'; }

  /* ---------------- 도구 독 구성 ----------------
     5개 슬롯 + 더보기 + 칠/획. 각 슬롯은 길게 눌러 마킹 메뉴. */
  var SLOTS = [
    { id: 'select', label: '선택', alts: ['select', 'directselect', 'groupselect', 'magicwand'] },
    { id: 'pen', label: '펜', alts: ['pen', 'addanchor', 'delanchor', 'convert', 'scissors'] },
    { id: 'rect', label: '도형', alts: ['rect', 'roundrect', 'ellipse', 'polygon', 'star'] },
    { id: 'type', label: '문자', alts: ['type'] },
    { id: 'brush', label: '브러시', alts: ['brush', 'pencil', 'blob', 'eraser'] }
  ];
  var ALL_TOOLS = [
    ['select', '선택'], ['directselect', '직접 선택'], ['groupselect', '그룹 선택'], ['magicwand', '자동 선택'],
    ['pen', '펜'], ['addanchor', '고정점 추가'], ['delanchor', '고정점 삭제'], ['convert', '고정점 변환'],
    ['type', '문자'], ['line', '선분'], ['rect', '사각형'], ['roundrect', '둥근 사각형'],
    ['ellipse', '원'], ['polygon', '다각형'], ['star', '별'],
    ['brush', '브러시'], ['pencil', '연필'], ['blob', '물방울'], ['eraser', '지우개'], ['scissors', '가위'],
    ['rotate', '회전'], ['reflect', '반사'], ['scale', '크기 조절'], ['shear', '기울이기'], ['freetransform', '자유 변형'],
    ['gradient', '그레이디언트'], ['eyedropper', '스포이드'], ['artboard', '대지'], ['zoom', '확대'], ['hand', '손']
  ];

  /* 독에 들어갈 짧은 이름 (2~4자) — 도구 정식 명칭은 시트와 마킹 메뉴에서 보여 준다 */
  var SHORT = {
    select: '선택', directselect: '직접', groupselect: '그룹', magicwand: '자동',
    pen: '펜', addanchor: '점추가', delanchor: '점삭제', convert: '점변환', scissors: '가위',
    type: '문자', line: '선', rect: '사각형', roundrect: '둥근', ellipse: '원',
    polygon: '다각형', star: '별', brush: '브러시', pencil: '연필', blob: '물방울',
    eraser: '지우개', smooth: '매끄럽게', rotate: '회전', reflect: '반사', scale: '크기',
    shear: '기울임', freetransform: '자유변형', gradient: '그레이디언트',
    eyedropper: '스포이드', artboard: '대지', zoom: '확대', hand: '손'
  };
  function shortName(id) {
    if (SHORT[id]) return SHORT[id];
    var t = T.get(id);
    return t ? t.name.replace(' 도구', '') : id;
  }

  /* ---------------- 반응형 판정 ---------------- */
  function coarse() {
    return window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  }
  /* 가로폭만 보면 가로 모드 휴대폰(844×390)이 태블릿으로 잡힌다.
     짧은 변을 함께 보고 판정한다. */
  Mob.mode = function () {
    var w = window.innerWidth, h = window.innerHeight, shortSide = Math.min(w, h);
    if (shortSide < 500 || w < 700) return 'phone';
    if (coarse() && w < 1180) return 'tablet';
    return 'desktop';
  };

  function applyMode() {
    var m = Mob.mode();
    document.body.classList.toggle('mobile', m === 'phone');
    document.body.classList.toggle('tablet', m === 'tablet');
    if (coarse()) document.body.classList.add('touch');
    /* 터치에서는 히트 허용 범위를 넓힌다 (손가락 접촉면 · Holz & Baudisch) */
    AI.hit.TOL = coarse() ? 11 : 4;
    if (app) {
      app.resize();
      /* 레이아웃이 바뀌면 캔버스 크기도 바뀌므로 보기를 다시 맞춘다 */
      if (Mob.__lastMode !== m) { Mob.__lastMode = m; AI.viewT.fitArtboard(app); }
      app.invalidate();
    }
    Mob.sync();
  }
  Mob.applyMode = applyMode;

  /* ---------------- DOM 구성 ---------------- */
  function build() {
    if (built) return;
    built = true;

    var bar = U.el('div');
    bar.id = 'm-appbar';
    bar.innerHTML =
      '<button class="m-btn" id="m-menu" aria-label="메뉴">' + icon('menu') + '</button>' +
      '<span id="m-title">무제-1</span>' +
      '<button class="m-btn" id="m-undo" aria-label="실행 취소">' + icon('undo') + '</button>' +
      '<button class="m-btn" id="m-redo" aria-label="다시 실행">' + icon('redo') + '</button>' +
      '<button class="m-btn" id="m-more" aria-label="더보기">' + icon('more') + '</button>';
    document.body.appendChild(bar);

    var ctx = U.el('div');
    ctx.id = 'm-context';
    document.body.appendChild(ctx);

    var dock = U.el('div');
    dock.id = 'm-dock';
    dock.innerHTML = SLOTS.map(function (s, i) {
      return '<button class="m-tool" data-slot="' + i + '">' + svg(s.id) +
        '<span class="lbl">' + shortName(s.id) + '</span>' +
        (s.alts.length > 1 ? '<span class="fly"></span>' : '') + '</button>';
    }).join('') +
      '<button class="m-tool" id="m-alltools">' + icon('more') + '<span class="lbl">도구</span></button>' +
      '<div class="m-swatch"><div class="fs" id="m-fs">' +
      '<div class="f" id="m-fill"></div><div class="s" id="m-stroke"></div></div></div>';
    document.body.appendChild(dock);

    var scrim = U.el('div'); scrim.id = 'm-scrim'; document.body.appendChild(scrim);

    var sheet = U.el('div');
    sheet.id = 'm-sheet';
    sheet.innerHTML =
      '<div class="m-grip"><i></i></div>' +
      '<div class="m-sheet-head"><h3 id="m-sheet-title"></h3>' +
      '<button class="m-btn" id="m-sheet-close" aria-label="닫기">' + icon('close') + '</button></div>' +
      '<div class="m-sheet-body" id="m-sheet-body"></div>';
    document.body.appendChild(sheet);

    var mark = U.el('div'); mark.id = 'm-marking'; document.body.appendChild(mark);

    var zoom = U.el('button');
    zoom.id = 'm-zoom';
    zoom.innerHTML = icon('fit') + '<span id="m-zoom-val">100%</span>';
    document.getElementById('canvas-wrap').appendChild(zoom);

    bind();
  }

  /* ---------------- 바텀 시트 ---------------- */
  var sheetState = { open: false, panel: null, restore: null };

  function openSheet(title, fill) {
    var sheet = document.getElementById('m-sheet');
    var body = document.getElementById('m-sheet-body');
    closeSheet(true);
    document.getElementById('m-sheet-title').textContent = title;
    body.innerHTML = '';
    fill(body);
    sheet.classList.add('open');
    document.getElementById('m-scrim').classList.add('open');
    sheetState.open = true;
  }
  Mob.openSheet = openSheet;

  /* 데스크톱 패널을 시트로 "옮겨" 재사용 — UI 코드를 복제하지 않는다 */
  function openPanel(name, title) {
    var section = document.querySelector('.panel[data-panel="' + name + '"]');
    if (!section) return;
    var pbody = section.querySelector('.body');
    openSheet(title, function (body) { body.appendChild(pbody); });
    sheetState.panel = section;
    sheetState.restore = pbody;
    if (AI.ui && AI.ui.syncAll) AI.ui.syncAll(app);
  }
  Mob.openPanel = openPanel;

  function closeSheet(instant) {
    if (sheetState.restore && sheetState.panel) {
      sheetState.panel.appendChild(sheetState.restore);   /* 원래 자리로 되돌린다 */
    }
    sheetState.panel = null;
    sheetState.restore = null;
    sheetState.open = false;
    var sheet = document.getElementById('m-sheet');
    if (!sheet) return;
    sheet.classList.remove('open');
    document.getElementById('m-scrim').classList.remove('open');
    if (instant) sheet.style.transform = '';
  }
  Mob.closeSheet = closeSheet;

  /* ---------------- 마킹 메뉴 ----------------
     길게 눌러 방사형 메뉴를 보거나(초보), 같은 방향으로 바로 그어 선택(숙련자). */
  var marking = null;
  function startMarking(slotIndex, x, y) {
    var slot = SLOTS[slotIndex];
    if (!slot || slot.alts.length < 2) return false;
    var el = document.getElementById('m-marking');
    var n = slot.alts.length;
    var R = 116, LIFT = 52;
    /* 하단 독에서 열리므로 위쪽 호에만 배치한다 — 아래쪽은 독과 손에 가린다.
       호의 중심을 손가락보다 조금 위로 올려 끝 항목도 독 위로 오게 한다. */
    var A0 = -Math.PI * 160 / 180, A1 = -Math.PI * 20 / 180;
    var items = slot.alts.map(function (id, i) {
      var a = n === 1 ? -Math.PI / 2 : A0 + (A1 - A0) * (i / (n - 1));
      var px = x + Math.cos(a) * R, py = (y - LIFT) + Math.sin(a) * R;
      px = U.clamp(px, 62, window.innerWidth - 62);       /* 화면 밖으로 나가지 않게 */
      py = Math.max(py, 60);
      /* 위치를 옮긴 뒤에는 방향도 다시 계산한다 —
         보이는 위치와 선택 방향이 어긋나면 엉뚱한 항목이 골라진다 */
      return { id: id, angle: Math.atan2(py - y, px - x), x: px, y: py };
    });
    el.innerHTML = '<div class="scrim"></div>' +
      '<div class="center" style="left:' + x + 'px;top:' + y + 'px"></div>' +
      items.map(function (it, i) {
        var t = T.get(it.id);
        return '<div class="mi" data-i="' + i + '" style="left:' + it.x + 'px;top:' + it.y + 'px;transform:translateX(-50%)">' +
          svg(it.id) + '<span>' + (t ? t.name.replace(' 도구', '') : it.id) + '</span></div>';
      }).join('');
    el.classList.add('open');
    marking = { items: items, x: x, y: y, hot: -1, shown: false };
    return true;
  }
  function updateMarking(x, y) {
    if (!marking) return;
    var dx = x - marking.x, dy = y - marking.y;
    var d = Math.hypot(dx, dy);
    var hot = -1;

    /* 1) 항목 위에 직접 올라가 있으면 그것을 고른다 (정확도 우선).
       2) 아니면 방향으로 고른다 (마킹 메뉴의 빠른 조작).
       화면이 좁아 항목 간 각도가 45° 미만이 되어도 직접 조준이 가능하다. */
    var els = U.qa('#m-marking .mi');
    for (var k = 0; k < els.length; k++) {
      var b = els[k].getBoundingClientRect();
      if (x >= b.left - 10 && x <= b.right + 10 && y >= b.top - 10 && y <= b.bottom + 10) { hot = k; break; }
    }
    if (hot < 0 && d > 26) {
      var a = Math.atan2(dy, dx), best = Infinity;
      marking.items.forEach(function (it, i) {
        var diff = Math.abs(normAngle(a - it.angle));
        if (diff < best) { best = diff; hot = i; }
      });
      if (best > 0.5) hot = -1;
    }
    if (hot !== marking.hot) {
      marking.hot = hot;
      U.qa('#m-marking .mi').forEach(function (el, i) { el.classList.toggle('hot', i === hot); });
    }
  }
  function normAngle(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
  function endMarking(slotIndex) {
    var el = document.getElementById('m-marking');
    var chosen = null;
    if (marking && marking.hot >= 0) chosen = marking.items[marking.hot].id;
    el.classList.remove('open');
    el.innerHTML = '';
    marking = null;
    if (chosen) {
      SLOTS[slotIndex].id = chosen;
      T.setTool(app, chosen);
      Mob.sync();
    }
    return !!chosen;
  }

  /* ---------------- 바인딩 ---------------- */
  function bind() {
    U.on(document.getElementById('m-menu'), 'click', function () { menuSheet(); });
    U.on(document.getElementById('m-more'), 'click', function () { moreSheet(); });
    U.on(document.getElementById('m-undo'), 'click', function () { C.run('undo'); Mob.sync(); });
    U.on(document.getElementById('m-redo'), 'click', function () { C.run('redo'); Mob.sync(); });
    U.on(document.getElementById('m-title'), 'click', function () {
      AI.dialog.open({
        title: '문서 이름', fields: [{ id: 'n', label: '이름', type: 'text', value: app.doc.name, width: 160 }],
        onDone: function (v) { app.doc.name = v.n || app.doc.name; AI.ui.syncAll(app); Mob.sync(); }
      });
    });
    U.on(document.getElementById('m-sheet-close'), 'click', function () { closeSheet(); });
    U.on(document.getElementById('m-scrim'), 'click', function () { closeSheet(); });
    U.on(document.getElementById('m-alltools'), 'click', function () { toolsSheet(); });
    U.on(document.getElementById('m-zoom'), 'click', function () { AI.viewT.fitArtboard(app); Mob.sync(); });
    U.on(document.getElementById('m-fs'), 'click', function () { openPanel('color', '색상'); });

    /* 도구 슬롯: 탭 = 전환, 길게 누르기/드래그 = 마킹 메뉴 */
    U.qa('#m-dock .m-tool[data-slot]').forEach(function (btn) {
      var idx = +btn.dataset.slot;
      var timer = null, startX = 0, startY = 0, opened = false, moved = false;

      function down(x, y) {
        startX = x; startY = y; opened = false; moved = false;
        timer = setTimeout(function () { opened = startMarking(idx, startX, startY); }, 280);
      }
      function move(x, y) {
        if (Math.hypot(x - startX, y - startY) > 12) moved = true;
        if (!opened && moved) {                       /* 숙련자: 메뉴 없이 방향만으로 */
          clearTimeout(timer);
          opened = startMarking(idx, startX, startY);
        }
        if (opened) updateMarking(x, y);
      }
      function up() {
        clearTimeout(timer);
        if (opened) {
          if (!endMarking(idx)) { T.setTool(app, SLOTS[idx].id); Mob.sync(); }
        } else {
          T.setTool(app, SLOTS[idx].id);
          Mob.sync();
        }
        opened = false;
      }

      U.on(btn, 'touchstart', function (e) { down(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); }, { passive: false });
      U.on(btn, 'touchmove', function (e) { move(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); }, { passive: false });
      U.on(btn, 'touchend', function (e) { up(); e.preventDefault(); }, { passive: false });
      U.on(btn, 'mousedown', function (e) { if (app.touchInput) return; down(e.clientX, e.clientY); });
      U.on(window, 'mousemove', function (e) { if (timer === null && !opened) return; if (app.touchInput) return; move(e.clientX, e.clientY); });
      U.on(window, 'mouseup', function () { if (app.touchInput) return; if (timer !== null || opened) { up(); timer = null; } });
    });

    /* 시트 손잡이를 아래로 끌어 닫기 */
    var grip = U.q('#m-sheet .m-grip');
    var sheet = document.getElementById('m-sheet');
    var dragY = null;
    U.on(grip, 'touchstart', function (e) { dragY = e.touches[0].clientY; sheet.classList.add('dragging'); }, { passive: true });
    U.on(grip, 'touchmove', function (e) {
      if (dragY == null) return;
      var dy = Math.max(0, e.touches[0].clientY - dragY);
      sheet.style.transform = 'translateY(' + dy + 'px)';
    }, { passive: true });
    U.on(grip, 'touchend', function (e) {
      sheet.classList.remove('dragging');
      var dy = e.changedTouches[0].clientY - (dragY || 0);
      sheet.style.transform = '';
      if (dy > 70) closeSheet();
      dragY = null;
    });

    U.on(window, 'resize', function () { applyMode(); });
    U.on(window, 'orientationchange', function () { setTimeout(applyMode, 120); });
  }

  /* ---------------- 시트 내용 ---------------- */
  function listItem(label, opts) {
    var b = U.el('button', 'm-item' + (opts && opts.on ? ' on' : '') + (opts && opts.disabled ? ' disabled' : ''));
    b.innerHTML = (opts && opts.icon ? '<span class="ico">' + opts.icon + '</span>' : '') +
      '<span>' + label + '</span>' + (opts && opts.key ? '<span class="k">' + opts.key + '</span>' : '');
    if (opts && opts.run && !(opts && opts.disabled)) {
      U.on(b, 'click', function () { closeSheet(); setTimeout(opts.run, 60); });
    }
    return b;
  }

  function toolsSheet() {
    openSheet('도구', function (body) {
      var g = U.el('div', 'm-grid');
      ALL_TOOLS.forEach(function (o) {
        var t = T.get(o[0]);
        if (!t) return;
        var b = listItem(o[1], { icon: svg(o[0]), on: app.tool === o[0] });
        U.on(b, 'click', function () {
          closeSheet();
          /* 고른 도구를 관련 슬롯에 반영해 다음부터 독에서 바로 쓸 수 있게 */
          SLOTS.forEach(function (s) { if (s.alts.indexOf(o[0]) >= 0) s.id = o[0]; });
          T.setTool(app, o[0]);
          Mob.sync();
        });
        g.appendChild(b);
      });
      body.appendChild(g);
    });
  }

  function menuSheet() {
    openSheet('메뉴', function (body) {
      var list = U.el('div', 'm-list');
      [['new', '새 문서'], ['open', '열기'], ['save', '저장'], ['place', '이미지 가져오기'],
      ['exportSvg', 'SVG 내보내기'], ['exportPng', 'PNG 내보내기'], ['docSetup', '문서 설정']]
        .forEach(function (o) {
          list.appendChild(listItem(o[1], { run: function () { C.run(o[0]); } }));
        });
      list.appendChild(U.el('div', 'dlg-sep'));
      list.appendChild(listItem('선택 해제', { run: function () { C.run('deselectAll'); Mob.sync(); } }));
      list.appendChild(listItem('모두 선택', { run: function () { C.run('selectAll'); Mob.sync(); } }));
      body.appendChild(list);
    });
  }

  function moreSheet() {
    openSheet('패널 · 보기', function (body) {
      var list = U.el('div', 'm-list');
      [['color', '색상'], ['gradient', '그레이디언트'], ['swatches', '견본'], ['stroke', '획'],
      ['type', '문자'], ['transform', '변형'], ['align', '정렬'], ['pathfinder', '패스파인더'],
      ['layers', '레이어'], ['properties', '속성']]
        .forEach(function (o) {
          var b = listItem(o[1]);
          U.on(b, 'click', function () { openPanel(o[0], o[1]); });
          list.appendChild(b);
        });
      list.appendChild(U.el('div', 'dlg-sep'));
      [['showGrid', '격자'], ['smartGuides', '고급 안내선'], ['snapGrid', '격자에 물리기'],
      ['outlineMode', '윤곽선 보기'], ['showGuides', '안내선 표시']].forEach(function (o) {
        var d = C.defs[o[0]];
        var on = d && d.checked && d.checked(app);
        var b = listItem(o[1], { key: on ? '켜짐' : '꺼짐', on: on });
        U.on(b, 'click', function () { C.run(o[0]); closeSheet(); });
        list.appendChild(b);
      });
      list.appendChild(U.el('div', 'dlg-sep'));
      var lefty = document.body.classList.contains('lefty');
      var lb = listItem('왼손잡이 배치', { key: lefty ? '켜짐' : '꺼짐', on: lefty });
      U.on(lb, 'click', function () {
        document.body.classList.toggle('lefty');
        try { localStorage.setItem('illy.lefty', document.body.classList.contains('lefty') ? '1' : '0'); } catch (e) { }
        closeSheet();
      });
      list.appendChild(lb);
      list.appendChild(listItem('환경 설정', { run: function () { C.run('preferences'); } }));
      body.appendChild(list);
    });
  }

  /* ---------------- 선택 컨텍스트 바 ---------------- */
  function chip(label, opts) {
    var b = U.el('button', 'm-chip' + (opts && opts.danger ? ' danger' : ''));
    b.innerHTML = (opts && opts.dot ? '<span class="dotc" style="background:' + opts.dot + '"></span>' : '') + label;
    if (opts && opts.run) U.on(b, 'click', opts.run);
    return b;
  }

  function buildContext() {
    var bar = document.getElementById('m-context');
    if (!bar) return;
    bar.innerHTML = '';
    if (!app.sel.length) return;
    var it = app.sel[0];
    var leaf = it;
    while (leaf && leaf.type === 'group' && leaf.children.length) leaf = leaf.children[leaf.children.length - 1];
    var fillCss = AI.color.paintPreviewCss(leaf && leaf.fill);
    var strokeCss = (leaf && leaf.stroke && leaf.stroke.type !== 'none') ? leaf.stroke.color : 'transparent';

    bar.appendChild(chip('칠', { dot: fillCss, run: function () { app.fillFocus = true; openPanel('color', '칠 색상'); } }));
    bar.appendChild(chip('획', { dot: strokeCss, run: function () { app.fillFocus = false; openPanel('stroke', '획'); } }));
    if (app.sel.some(function (x) { return x.type === 'text'; })) {
      bar.appendChild(chip('문자', { run: function () { openPanel('type', '문자'); } }));
    }
    bar.appendChild(chip('변형', { run: function () { openPanel('transform', '변형'); } }));
    bar.appendChild(U.el('span', 'm-sep'));
    bar.appendChild(chip('◀', { run: function () { C.nudge(app, -nudgeStep(), 0); } }));
    bar.appendChild(chip('▶', { run: function () { C.nudge(app, nudgeStep(), 0); } }));
    bar.appendChild(chip('▲', { run: function () { C.nudge(app, 0, -nudgeStep()); } }));
    bar.appendChild(chip('▼', { run: function () { C.nudge(app, 0, nudgeStep()); } }));
    bar.appendChild(U.el('span', 'm-sep'));
    if (app.sel.length > 1) {
      bar.appendChild(chip('그룹', { run: function () { C.run('group'); Mob.sync(); } }));
      bar.appendChild(chip('정렬', { run: function () { openPanel('align', '정렬'); } }));
      bar.appendChild(chip('패스파인더', { run: function () { openPanel('pathfinder', '패스파인더'); } }));
    }
    if (app.sel.some(function (x) { return x.type === 'group'; })) {
      bar.appendChild(chip('그룹 풀기', { run: function () { C.run('ungroup'); Mob.sync(); } }));
    }
    bar.appendChild(chip('맨 앞', { run: function () { C.run('bringToFront'); } }));
    bar.appendChild(chip('맨 뒤', { run: function () { C.run('sendToBack'); } }));
    bar.appendChild(chip('복제', { run: function () { C.run('duplicate'); Mob.sync(); } }));
    bar.appendChild(chip('삭제', { danger: true, run: function () { C.run('clear'); Mob.sync(); } }));
  }
  function nudgeStep() { return (app.prefs.keyIncrement || 1); }

  /* ---------------- 동기화 ---------------- */
  Mob.sync = function () {
    if (!built || !app) return;
    document.body.classList.toggle('has-sel', app.sel.length > 0);
    var t = document.getElementById('m-title');
    if (t) t.textContent = app.doc.name + (app.dirty ? ' •' : '');
    var u = document.getElementById('m-undo'), r = document.getElementById('m-redo');
    if (u) u.disabled = !app.history.canUndo();
    if (r) r.disabled = !app.history.canRedo();
    U.qa('#m-dock .m-tool[data-slot]').forEach(function (btn) {
      var s = SLOTS[+btn.dataset.slot];
      btn.classList.toggle('on', app.tool === s.id);
      btn.innerHTML = svg(s.id) + '<span class="lbl">' + shortName(s.id) + '</span>' +
        (s.alts.length > 1 ? '<span class="fly"></span>' : '');
    });
    var f = document.getElementById('m-fill'), st = document.getElementById('m-stroke');
    if (f) f.style.background = AI.color.paintPreviewCss(app.fill);
    if (st) st.style.background = AI.color.paintPreviewCss(app.stroke);
    var z = document.getElementById('m-zoom-val');
    if (z) z.textContent = Math.round(app.view.scale * 100) + '%';
    buildContext();
  };

  Mob.init = function (a) {
    app = a;
    build();
    try { if (localStorage.getItem('illy.lefty') === '1') document.body.classList.add('lefty'); } catch (e) { }
    applyMode();
    /* GUI 상태가 바뀔 때마다 모바일 셸도 따라가게 한다 */
    var origSyncAll = AI.ui.syncAll;
    AI.ui.syncAll = function (x) { origSyncAll(x); Mob.sync(); };
  };
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
