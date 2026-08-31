/* =========================================================================
   ui/panels.js — 컨트롤 바 + 오른쪽 패널들
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, M = AI.mat, R = AI.rect, Model = AI.model, E = AI.edit, Rn = AI.render, Col = AI.color, C = AI.commands, T = AI.tools;
  var UI = AI.ui = AI.ui || {};

  var app = null;
  var syncing = false;

  UI.init = function (a) {
    app = a;
    UI.buildMenus(a);
    fillStaticIcons();
    buildControlBar();
    buildProperties();
    buildTransform();
    buildType();
    buildStyles();
    buildColor();
    buildGradient();
    buildSwatches();
    buildStroke();
    buildAlign();
    buildPathfinder();
    buildSymbols();
    buildAppearance();
    buildEffects();
    buildArtboards();
    UI.buildLayers(a);
    bindPanelFolding();
    UI.syncDocTabs(a);
    UI.syncAll(a);
  };

  /* index.html 에 미리 놓인 버튼들에 아이콘을 채워 넣는다
     (마크업에는 글리프를 두지 않아 OS 별 렌더 차이를 없앤다) */
  function fillStaticIcons() {
    var map = {
      'ctl-lockratio': 'link',
      'ab-first': 'navFirst', 'ab-prev': 'navPrev', 'ab-next': 'navNext', 'ab-last': 'navLast'
    };
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (el && !el.firstChild) el.innerHTML = UI.icon(map[id], 12);
    });
  }

  /* ---------------- 문서 탭 ----------------
     일러스트레이터처럼 열려 있는 문서를 탭으로 늘어놓는다.
     문서가 하나뿐이면 줄 자체를 감춘다 (지금까지의 화면과 똑같아 보이도록). */
  var docTabSig = null;
  UI.syncDocTabs = function (a) {
    var host = document.getElementById('doctabs');
    if (!host) return;
    AI.docs.init(a);
    AI.docs.sync(a);
    var list = AI.docs.list(a);
    /* 이름 · 수정 여부 · 활성 탭이 그대로면 다시 그리지 않는다 */
    var sig = a.docIndex + '|' + list.map(function (s) { return s.doc.name + (s.dirty ? '*' : ''); }).join('\u0001');
    if (sig === docTabSig) return;
    docTabSig = sig;
    host.classList.toggle('one', list.length < 2);
    host.innerHTML = list.map(function (s, i) {
      return '<button class="dtab' + (i === a.docIndex ? ' on' : '') + '" data-doc="' + i + '"' +
        ' title="' + U.esc(s.doc.name) + (s.dirty ? ' (저장 안 됨)' : '') + '">' +
        '<span class="dt-name">' + U.esc(s.doc.name) + '</span>' +
        (s.dirty ? '<span class="dt-dirty">•</span>' : '') +
        '<span class="dt-x" data-close="' + i + '" title="닫기">' + UI.icon('close', 8) + '</span>' +
        '</button>';
    }).join('') +
      '<button id="dt-new" title="새 문서 (Ctrl+N)">' + UI.icon('plus', 11) + '</button>';

    U.qa('.dtab', host).forEach(function (b) {
      U.on(b, 'click', function (ev) {
        if (ev.target.closest('[data-close]')) return;
        AI.docs.switchTo(a, +b.dataset.doc);
      });
      /* 가운데 버튼으로 닫기 — 브라우저 탭과 같은 관례 */
      U.on(b, 'auxclick', function (ev) {
        if (ev.button !== 1) return;
        ev.preventDefault();
        AI.docs.close(a, +b.dataset.doc);
      });
    });
    U.qa('[data-close]', host).forEach(function (x) {
      U.on(x, 'click', function (ev) { ev.stopPropagation(); AI.docs.close(a, +x.dataset.close); });
    });
    var nb = document.getElementById('dt-new');
    if (nb) U.on(nb, 'click', function () { C.run('new'); });
  };

  /* 패널 그룹: 탭 전환 + 그룹 접기 */
  function bindPanelFolding() {
    U.qa('.pgroup').forEach(function (g) {
      U.qa('.ptab', g).forEach(function (tab) {
        U.on(tab, 'click', function () { activateTab(g, tab.dataset.tab); });
      });
      var fold = U.q('.fold', g);
      if (fold) U.on(fold, 'click', function (e) { e.stopPropagation(); g.classList.toggle('collapsed'); });
    });
  }

  function activateTab(group, name) {
    U.qa('.ptab', group).forEach(function (t) { t.classList.toggle('on', t.dataset.tab === name); });
    U.qa('.panel', group).forEach(function (s2) { s2.classList.toggle('tab-hidden', s2.dataset.panel !== name); });
    group.classList.remove('collapsed');
  }

  /* 이름으로 패널을 앞으로 꺼낸다 (메뉴 · 모바일 · 자동화에서 쓴다) */
  UI.showPanel = function (name) {
    var sec = document.querySelector('.panel[data-panel="' + name + '"]');
    if (!sec) return false;
    var g = sec.closest('.pgroup');
    if (g) { activateTab(g, name); g.scrollIntoView({ block: 'nearest' }); }
    return true;
  };

  function num(el, get, set, label, isLength) {
    U.on(el, 'change', function () {
      if (syncing) return;
      var v = isLength ? U.parseLen(el.value, get(), app.prefs.unit || 'pt') : U.parseNum(el.value, get());
      app.history.begin(label || '값 변경', app.doc);
      set(v);
      app.history.commit();
      app.invalidate();
      UI.syncAll(app);
    });
    U.on(el, 'keydown', function (ev) {
      if (ev.key === 'Enter') { el.blur(); ev.stopPropagation(); }
      else if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
        ev.preventDefault();
        var step = ev.shiftKey ? 10 : 1;
        el.value = U.round(U.parseNum(el.value, 0) + (ev.key === 'ArrowUp' ? step : -step), 3);
        el.dispatchEvent(new Event('change'));
      }
      ev.stopPropagation();
    });
  }

  /* ================= 컨트롤 바 ================= */
  function buildControlBar() {
    var fill = document.getElementById('ctl-fill');
    var stroke = document.getElementById('ctl-stroke');
    U.on(fill, 'click', function () { app.fillFocus = true; UI.syncStyle(app); UI.openColorPicker(app, fill); });
    U.on(stroke, 'click', function () { app.fillFocus = false; UI.syncStyle(app); UI.openColorPicker(app, stroke); });

    var sw = document.getElementById('ctl-stroke-w');
    U.on(sw, 'change', function () {
      var v = U.parseNum(sw.value, 1);
      app.strokeWidth = v;
      if (app.sel.length) { app.history.begin('획 두께', app.doc); E.applyStrokeProp(app, 'width', v); app.history.commit(); }
      app.invalidate(); UI.syncAll(app);
    });

    var op = document.getElementById('ctl-opacity');
    num(op, function () { return 100; }, function (v) { E.setOpacity(app, U.clamp(v, 0, 100) / 100); }, '불투명도');

    num(document.getElementById('ctl-x'), function () { return 0; }, function (v) { E.setBounds(app, v, null, null, null); }, '위치', true);
    num(document.getElementById('ctl-y'), function () { return 0; }, function (v) { E.setBounds(app, null, v, null, null); }, '위치', true);
    num(document.getElementById('ctl-w'), function () { return 0; }, function (v) {
      var b = Rn.selectionBounds(app, true);
      var h = app.lockRatio ? R.h(b) * (v / (R.w(b) || 1)) : null;
      E.setBounds(app, null, null, v, h);
    }, '크기', true);
    num(document.getElementById('ctl-h'), function () { return 0; }, function (v) {
      var b = Rn.selectionBounds(app, true);
      var w = app.lockRatio ? R.w(b) * (v / (R.h(b) || 1)) : null;
      E.setBounds(app, null, null, w, v);
    }, '크기', true);
    num(document.getElementById('ctl-a'), function () { return 0; }, function (v) {
      if (app.sel.length === 1) {
        var it = app.sel[0];
        var cur = M.angle(Model.worldMatrix(app.doc, it));
        E.rotate(app, v - cur);
      } else E.rotate(app, v);
    }, '회전');

    var lock = document.getElementById('ctl-lockratio');
    U.on(lock, 'click', function () { app.lockRatio = !app.lockRatio; lock.classList.toggle('on', app.lockRatio); });

    ['first', 'prev', 'next', 'last'].forEach(function (k) {
      var b = document.getElementById('ab-' + k);
      if (b) U.on(b, 'click', function () { C.run(k + 'Artboard'); });
    });
    /* 눈금자 우클릭 = 단위 메뉴 (Illustrator 동작) */
    ['ruler-h', 'ruler-v', 'ruler-corner'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      U.on(el, 'contextmenu', function (ev) {
        ev.preventDefault();
        var cm = document.getElementById('contextmenu');
        cm.innerHTML = '';
        cm.className = 'menu-pop';
        [['pt', '포인트'], ['px', '픽셀'], ['mm', '밀리미터'], ['cm', '센티미터'], ['in', '인치']].forEach(function (o) {
          var mi = U.el('div', 'mi');
          mi.innerHTML = '<span class="chk">' + ((app.prefs.unit || 'pt') === o[0] ? '✓' : '') + '</span><span>' + o[1] + '</span>';
          U.on(mi, 'click', function () { cm.hidden = true; C.setUnit(app, o[0]); });
          cm.appendChild(mi);
        });
        cm.style.left = ev.clientX + 'px';
        cm.style.top = ev.clientY + 'px';
        cm.hidden = false;
      });
    });

    var z = document.getElementById('st-zoom');
    U.on(z, 'change', function () {
      var v = U.parseNum(z.value.replace('%', ''), app.view.scale * 100);
      AI.viewT.setZoom(app, v / 100);
    });
    U.on(z, 'keydown', function (ev) { if (ev.key === 'Enter') z.blur(); ev.stopPropagation(); });
  }

  /* ================= 속성 ================= */
  function buildProperties() {
    var p = document.getElementById('p-properties');
    p.innerHTML =
      '<div class="row"><span id="pr-info" class="pr-info"></span></div>' +
      '<div class="row"><label style="min-width:34px">불투명</label>' +
      '<input class="fld" id="pr-op" value="100"><span class="unit">%</span></div>' +
      '<div class="row"><label style="min-width:34px">혼합</label><select class="fld" id="pr-blend">' +
      ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity']
        .map(function (b) { return '<option value="' + b + '">' + b + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="sec">정돈</div>' +
      '<div class="grid4">' +
      UI.btn({ icon: 'toFront', title: '맨 앞으로', cmd: 'bringToFront' }) +
      UI.btn({ icon: 'forward', title: '앞으로', cmd: 'bringForward' }) +
      UI.btn({ icon: 'backward', title: '뒤로', cmd: 'sendBackward' }) +
      UI.btn({ icon: 'toBack', title: '맨 뒤로', cmd: 'sendToBack' }) +
      '</div>' +
      '<div class="sec">그룹 · 잠금</div>' +
      '<div class="grid4">' +
      UI.btn({ label: '그룹', cmd: 'group' }) +
      UI.btn({ label: '풀기', title: '그룹 풀기', cmd: 'ungroup' }) +
      UI.btn({ icon: 'lock', title: '잠금', cmd: 'lock' }) +
      UI.btn({ icon: 'eyeOff', title: '숨기기', cmd: 'hide' }) +
      '</div>';
    num(U.q('#pr-op', p), function () { return 100; }, function (v) { E.setOpacity(app, U.clamp(v, 0, 100) / 100); }, '불투명도');
    U.on(U.q('#pr-blend', p), 'change', function () {
      app.history.begin('혼합 모드', app.doc);
      var v = this.value;
      app.sel.forEach(function (it) { it.blend = v; });
      app.history.commit(); app.invalidate();
    });
    U.qa('[data-cmd]', p).forEach(function (b) { U.on(b, 'click', function () { C.run(b.dataset.cmd); }); });
  }

  /* ================= 변형 ================= */
  function buildTransform() {
    var p = document.getElementById('p-transform');
    p.innerHTML =
      '<div class="row" style="align-items:flex-start;gap:9px">' +
      '<div class="refpoint" id="tf-ref" title="기준점 — X/Y 와 크기 조절의 기준">' +
      [0, 1, 2, 3, 4, 5, 6, 7, 8].map(function (i) { return '<div class="rp' + (i === 0 ? ' on' : '') + '" data-i="' + i + '"></div>'; }).join('') +
      '</div>' +
      '<div style="flex:1">' +
      '<div class="grid2">' +
      '<div class="row"><label>X</label><input class="fld" id="tf-x"></div>' +
      '<div class="row"><label>Y</label><input class="fld" id="tf-y"></div>' +
      '<div class="row"><label>W</label><input class="fld" id="tf-w"></div>' +
      '<div class="row"><label>H</label><input class="fld" id="tf-h"></div>' +
      '</div></div></div>' +
      '<div class="grid2">' +
      '<div class="row"><label>∠</label><input class="fld" id="tf-a"></div>' +
      '<div class="row"><label title="기울이기">⌇</label><input class="fld" id="tf-s" value="0"></div>' +
      '</div>' +
      '<div class="grid2" style="margin-top:4px">' +
      '<button class="btn" data-cmd="reflectH">가로 반사</button>' +
      '<button class="btn" data-cmd="reflectV">세로 반사</button>' +
      '</div>';

    var ref = U.q('#tf-ref', p);
    U.on(ref, 'click', function (ev) {
      if (!ev.target.dataset.i) return;
      U.qa('.rp', ref).forEach(function (x) { x.classList.remove('on'); });
      ev.target.classList.add('on');
      app.refPoint = +ev.target.dataset.i;
      UI.syncSelection(app);
    });

    num(U.q('#tf-x', p), function () { return 0; }, function (v) { E.setBounds(app, v, null, null, null); }, '위치', true);
    num(U.q('#tf-y', p), function () { return 0; }, function (v) { E.setBounds(app, null, v, null, null); }, '위치', true);
    num(U.q('#tf-w', p), function () { return 0; }, function (v) {
      var b = Rn.selectionBounds(app, true);
      E.setBounds(app, null, null, v, app.lockRatio ? R.h(b) * (v / (R.w(b) || 1)) : null);
    }, '크기', true);
    num(U.q('#tf-h', p), function () { return 0; }, function (v) {
      var b = Rn.selectionBounds(app, true);
      E.setBounds(app, null, null, app.lockRatio ? R.w(b) * (v / (R.h(b) || 1)) : null, v);
    }, '크기', true);
    num(U.q('#tf-a', p), function () { return 0; }, function (v) {
      var b = Rn.selectionBounds(app, true);
      var o = E.refPointOf(b, app.refPoint || 0);
      if (app.sel.length === 1) {
        var cur = M.angle(Model.worldMatrix(app.doc, app.sel[0]));
        E.rotate(app, v - cur, o.x, o.y);
      } else E.rotate(app, v, o.x, o.y);
    }, '회전');
    num(U.q('#tf-s', p), function () { return 0; }, function (v) {
      var b = Rn.selectionBounds(app, true);
      var o = E.refPointOf(b, app.refPoint || 0);
      E.shear(app, v, 0, o.x, o.y);
    }, '기울이기');
    U.qa('[data-cmd]', p).forEach(function (b) { U.on(b, 'click', function () { C.run(b.dataset.cmd); }); });
  }

  /* ================= 색상 ================= */
  function buildColor() {
    var p = document.getElementById('p-color');
    p.innerHTML =
      '<div class="row">' +
      '<button class="swatch-btn" id="cl-fill" title="칠 (X 로 초점 전환)"><i></i></button>' +
      '<button class="swatch-btn" id="cl-stroke" title="획"><i></i></button>' +
      '<input class="fld" id="cl-hex" style="flex:1" value="#000000">' +
      '<button class="mini-btn" id="cl-none" title="없음 (/)">' + UI.icon('none', 13) + '</button>' +
      '</div>' +
      '<div class="row">' +
      '<label>R</label><input class="fld" id="cl-r">' +
      '<label>G</label><input class="fld" id="cl-g">' +
      '<label>B</label><input class="fld" id="cl-b"></div>' +
      '<div class="row"><label style="min-width:30px">알파</label>' +
      '<input class="fld" id="cl-a" value="100"><span class="unit">%</span></div>' +
      '<div class="hint">클릭한 견본은 현재 초점(칠 · 획)에 적용됩니다. X = 초점 전환, Shift+X = 교체</div>';

    U.on(U.q('#cl-fill', p), 'click', function () { app.fillFocus = true; UI.syncStyle(app); UI.openColorPicker(app, this); });
    U.on(U.q('#cl-stroke', p), 'click', function () { app.fillFocus = false; UI.syncStyle(app); UI.openColorPicker(app, this); });
    U.on(U.q('#cl-none', p), 'click', function () { C.run('noneFill'); });

    function applyHex(hex, alpha) {
      var paint = Col.solid(hex, alpha == null ? 1 : alpha);
      if (app.fillFocus) app.fill = paint; else app.stroke = paint;
      app.lastColor = hex;
      if (app.fillFocus && app.sel.some(function (i) { return i.type === 'text'; })) app.textFill = U.deepCopy(paint);
      if (app.sel.length) {
        app.history.begin('색상', app.doc);
        E.applyPaint(app, paint, app.fillFocus ? 'fill' : 'stroke');
        app.history.commit();
      }
      app.invalidate();
      UI.syncStyle(app);
    }
    UI.applyCurrentColor = applyHex;

    U.on(U.q('#cl-hex', p), 'change', function () {
      var v = this.value.trim();
      if (v[0] !== '#') v = '#' + v;
      applyHex(Col.rgbToHex(Col.hexToRgb(v).r, Col.hexToRgb(v).g, Col.hexToRgb(v).b));
    });
    U.on(U.q('#cl-hex', p), 'keydown', function (ev) { ev.stopPropagation(); if (ev.key === 'Enter') this.blur(); });
    ['r', 'g', 'b'].forEach(function (ch) {
      var el = U.q('#cl-' + ch, p);
      U.on(el, 'keydown', function (ev) { ev.stopPropagation(); if (ev.key === 'Enter') this.blur(); });
      U.on(el, 'change', function () {
        var r = U.parseNum(U.q('#cl-r', p).value, 0), g = U.parseNum(U.q('#cl-g', p).value, 0), b = U.parseNum(U.q('#cl-b', p).value, 0);
        applyHex(Col.rgbToHex(r, g, b));
      });
    });
    var alphaEl = U.q('#cl-a', p);
    U.on(alphaEl, 'keydown', function (ev) { ev.stopPropagation(); if (ev.key === 'Enter') this.blur(); });
    U.on(alphaEl, 'change', function () {
      var cur = app.fillFocus ? app.fill : app.stroke;
      var hex = cur && cur.type === 'solid' ? cur.color : '#000000';
      applyHex(hex, U.clamp(U.parseNum(alphaEl.value, 100), 0, 100) / 100);
    });
  }

  /* ================= 문자 ================= */
  var FONTS = UI.FONTS = [
    ['Noto Sans KR, sans-serif', 'Noto Sans KR'],
    ['Malgun Gothic, sans-serif', '맑은 고딕'],
    ['Nanum Gothic, sans-serif', '나눔고딕'],
    ['Nanum Myeongjo, serif', '나눔명조'],
    ['Arial, Helvetica, sans-serif', 'Arial'],
    ['Helvetica, Arial, sans-serif', 'Helvetica'],
    ['Georgia, serif', 'Georgia'],
    ['Times New Roman, serif', 'Times New Roman'],
    ['Courier New, monospace', 'Courier New'],
    ['Impact, sans-serif', 'Impact'],
    ['Verdana, sans-serif', 'Verdana'],
    ['serif', 'serif'],
    ['sans-serif', 'sans-serif'],
    ['monospace', 'monospace']
  ];

  function selectedTexts(a) {
    var out = [];
    (a.sel || []).forEach(function (it) {
      (function rec(o) {
        if (o.type === 'group') { o.children.forEach(rec); return; }
        if (o.type === 'text') out.push(o);
      })(it);
    });
    return out;
  }
  UI.selectedTexts = selectedTexts;

  function applyText(label, fn) {
    var list = selectedTexts(app);
    if (list.length) {
      app.history.begin(label, app.doc);
      list.forEach(function (t) { fn(t.text, t); });
      app.history.commit();
      if (app.editingText) T.syncTextBox(app);
    }
    app.typeOpts = app.typeOpts || {};
    fn(app.typeOpts, null);
    app.invalidate();
    UI.syncType(app);
  }

  function buildType() {
    var p = document.getElementById('p-type');
    p.innerHTML =
      '<div class="row"><select class="fld" id="ty-font">' +
      FONTS.map(function (f) { return '<option value="' + f[0] + '">' + f[1] + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="row">' +
      '<select class="fld" id="ty-weight" style="flex:1.2">' +
      [['300', 'Light'], ['400', 'Regular'], ['500', 'Medium'], ['700', 'Bold'], ['900', 'Black']]
        .map(function (w) { return '<option value="' + w[0] + '">' + w[1] + '</option>'; }).join('') +
      '</select>' +
      '<button class="mini-btn" id="ty-italic" title="기울임" style="font-style:italic;font-family:serif">I</button>' +
      '</div>' +
      '<div class="grid2">' +
      '<div class="row"><label style="min-width:26px" title="글꼴 크기">크기</label><input class="fld" id="ty-size" value="24"></div>' +
      '<div class="row"><label style="min-width:26px" title="행간(배수)">행간</label><input class="fld" id="ty-leading" value="1.2"></div>' +
      '<div class="row"><label style="min-width:26px" title="자간(px)">자간</label><input class="fld" id="ty-tracking" value="0"></div>' +
      '</div>' +
      '<div class="row" style="margin-top:var(--gap)">' +
      '<label style="min-width:26px">정렬</label>' +
      UI.seg([
        { value: 'left', icon: 'textLeft', title: '왼쪽 정렬' },
        { value: 'center', icon: 'textCenter', title: '가운데 정렬' },
        { value: 'right', icon: 'textRight', title: '오른쪽 정렬' }
      ], 'data-talign') +
      '</div>' +
      '<div class="grid2" style="margin-top:var(--gap-s)">' +
      UI.btn({ label: '크게', title: '글꼴 크기 확대', cmd: 'fontBigger' }) +
      UI.btn({ label: '작게', title: '글꼴 크기 축소', cmd: 'fontSmaller' }) +
      '</div>' +
      '<div class="hint">텍스트를 선택하거나 문자 도구로 새로 만들 때 적용됩니다.</div>';

    U.on(U.q('#ty-font', p), 'change', function () { var v = this.value; applyText('글꼴', function (t) { t.family = v; }); });
    U.on(U.q('#ty-weight', p), 'change', function () { var v = +this.value; applyText('글꼴 두께', function (t) { t.weight = v; }); });
    U.on(U.q('#ty-italic', p), 'click', function () {
      var on = !this.classList.contains('on');
      applyText('기울임', function (t) { t.italic = on; });
    });
    num(U.q('#ty-size', p), function () { return 24; }, function (v) { applyText('글꼴 크기', function (t) { t.size = U.clamp(v, 1, 1200); }); }, '글꼴 크기');
    num(U.q('#ty-leading', p), function () { return 1.2; }, function (v) { applyText('행간', function (t) { t.leading = U.clamp(v, 0.2, 10); }); }, '행간');
    num(U.q('#ty-tracking', p), function () { return 0; }, function (v) { applyText('자간', function (t) { t.tracking = v; }); }, '자간');
    U.qa('[data-talign]', p).forEach(function (b) {
      U.on(b, 'click', function () { applyText('정렬', function (t) { t.align = b.dataset.talign; }); });
    });
    U.qa('[data-cmd]', p).forEach(function (b) { U.on(b, 'click', function () { C.run(b.dataset.cmd); }); });
  }

  /* ---------------- 문자 · 단락 스타일 ---------------- */
  function styleCmd(kind, cmd, arg) {
    var ST = AI.styles, doc = app.doc;
    var texts = selectedTexts(app);
    var st = arg != null ? ST.list(doc, kind)[arg] : null;

    if (cmd === 'new') {
      app.history.begin(ST.LABEL[kind] + ' 만들기', doc);
      var base = texts.length ? ST.attrsFrom(kind, texts[0].text)
        : ST.attrsFrom(kind, app.typeOpts || {});
      var made = ST.create(doc, kind, null, base);
      texts.forEach(function (it) { ST.applyTo(it, kind, made); });
      app.history.commit();
      U.toast(ST.LABEL[kind] + ' "' + made.name + '" 만듦');
    } else if (cmd === 'apply') {
      if (!texts.length) { U.toast('텍스트를 먼저 선택하세요'); return; }
      app.history.begin(ST.LABEL[kind] + ' 적용', doc);
      texts.forEach(function (it) { ST.applyTo(it, kind, st); });
      app.history.commit();
      U.toast('"' + st.name + '" 적용 (' + texts.length + '개)');
    } else if (cmd === 'redefine') {
      if (!texts.length) { U.toast('기준이 될 텍스트를 선택하세요'); return; }
      app.history.begin(ST.LABEL[kind] + ' 재정의', doc);
      var n = ST.redefine(doc, kind, st, texts[0]);
      app.history.commit();
      U.toast('"' + st.name + '" 재정의 — ' + n + '개 텍스트에 반영');
    } else if (cmd === 'edit') {
      AI.dialogs.styleOptions(app, kind, st);
      return;
    } else if (cmd === 'del') {
      app.history.begin(ST.LABEL[kind] + ' 삭제', doc);
      ST.remove(doc, kind, st);
      app.history.commit();
    } else if (cmd === 'unlink') {
      if (!texts.length) { U.toast('텍스트를 먼저 선택하세요'); return; }
      app.history.begin('스타일 연결 끊기', doc);
      texts.forEach(function (it) { ST.unlink(it, kind); });
      app.history.commit();
    }
    app.invalidate();
    UI.syncAll(app);
  }

  function buildStyles() {
    var p = document.getElementById('p-styles');
    if (!p) return;
    p.innerHTML =
      '<div class="sec">문자 스타일</div>' +
      '<div id="sty-char" class="list"></div>' +
      '<div class="grid3" style="margin-top:var(--gap-s)">' +
      UI.btn({ icon: 'plus', label: '새로', title: '선택한 텍스트의 서식으로 문자 스타일 만들기', data: { sty: 'char:new' } }) +
      UI.btn({ icon: 'fxRepeat', label: '재정의', title: '선택한 텍스트의 서식으로 스타일 다시 정의', data: { sty: 'char:redefine' } }) +
      UI.btn({ icon: 'unlink', label: '연결 끊기', title: '스타일 연결만 끊기 (서식은 유지)', data: { sty: 'char:unlink' } }) +
      '</div>' +
      '<div class="sec" style="margin-top:var(--gap)">단락 스타일</div>' +
      '<div id="sty-para" class="list"></div>' +
      '<div class="grid3" style="margin-top:var(--gap-s)">' +
      UI.btn({ icon: 'plus', label: '새로', title: '선택한 텍스트의 서식으로 단락 스타일 만들기', data: { sty: 'para:new' } }) +
      UI.btn({ icon: 'fxRepeat', label: '재정의', title: '선택한 텍스트의 서식으로 스타일 다시 정의', data: { sty: 'para:redefine' } }) +
      UI.btn({ icon: 'unlink', label: '연결 끊기', title: '스타일 연결만 끊기 (서식은 유지)', data: { sty: 'para:unlink' } }) +
      '</div>' +
      '<div class="hint">행을 눌러 적용, 두 번 눌러 편집합니다. 스타일을 고치면 그 스타일을 쓰는 텍스트가 모두 따라 바뀝니다. 텍스트를 직접 고쳐 스타일과 달라지면 <b>+</b> 가 붙습니다.</div>';
  }

  function styleRows(a, kind, host) {
    var ST = AI.styles;
    var list = ST.list(a.doc, kind);
    var texts = selectedTexts(a);
    var cur = texts.length ? texts[0].text[ST.field(kind)] : null;
    var over = texts.length && ST.hasOverride(a.doc, texts[0], kind);
    if (!list.length) {
      host.innerHTML = '<div class="list-empty">' + ST.LABEL[kind] + ' 없음 — [새로] 로 만드세요</div>';
      return;
    }
    host.innerHTML = list.map(function (st, i) {
      var on = st.id === cur;
      return '<div class="list-row' + (on ? ' on' : '') + '" data-i="' + i + '" title="눌러 적용 · 두 번 눌러 편집">' +
        '<span class="list-name">' + U.esc(st.name) + (on && over ? ' <b class="ovr">+</b>' : '') + '</span>' +
        '<span class="list-sub">' + U.esc(ST.summary(kind, st)) + '</span>' +
        '<button class="mini-btn" data-styedit="' + i + '" title="편집">' + UI.icon('pencil', 12) + '</button>' +
        '<button class="mini-btn" data-stydel="' + i + '" title="삭제">' + UI.icon('close', 12) + '</button>' +
        '</div>';
    }).join('');
    U.qa('.list-row', host).forEach(function (row) {
      U.on(row, 'click', function (ev) {
        if (ev.target.closest('[data-styedit],[data-stydel]')) return;
        styleCmd(kind, 'apply', +row.dataset.i);
      });
      U.on(row, 'dblclick', function () { styleCmd(kind, 'edit', +row.dataset.i); });
    });
    U.qa('[data-styedit]', host).forEach(function (b) {
      U.on(b, 'click', function (ev) { ev.stopPropagation(); styleCmd(kind, 'edit', +b.dataset.styedit); });
    });
    U.qa('[data-stydel]', host).forEach(function (b) {
      U.on(b, 'click', function (ev) { ev.stopPropagation(); styleCmd(kind, 'del', +b.dataset.stydel); });
    });
  }

  UI.syncStyles = function (a) {
    var p = document.getElementById('p-styles');
    if (!p) return;
    if (!p.firstChild) buildStyles();
    ['char', 'para'].forEach(function (kind) {
      var host = document.getElementById('sty-' + (kind === 'char' ? 'char' : 'para'));
      if (host) styleRows(a, kind, host);
    });
    U.qa('[data-sty]', p).forEach(function (b) {
      if (b.__wired) return;
      b.__wired = true;
      U.on(b, 'click', function () {
        var parts = b.dataset.sty.split(':');
        var texts = selectedTexts(app);
        var kind = parts[0], cmd = parts[1];
        if (cmd === 'redefine' || cmd === 'unlink') {
          var st = texts.length ? AI.styles.styleOf(app.doc, texts[0], kind) : null;
          if (cmd === 'redefine' && !st) { U.toast('스타일이 걸린 텍스트를 선택하세요'); return; }
          var i = st ? AI.styles.list(app.doc, kind).indexOf(st) : null;
          styleCmd(kind, cmd, i);
        } else styleCmd(kind, cmd, null);
      });
    });
    /* 텍스트가 없으면 재정의·연결 끊기는 쓸 수 없다 */
    var hasText = selectedTexts(a).length > 0;
    U.qa('[data-sty$=":redefine"],[data-sty$=":unlink"]', p).forEach(function (b) {
      if (hasText) b.removeAttribute('disabled'); else b.setAttribute('disabled', '');
    });
  };

  UI.syncType = function (a) {
    var p = document.getElementById('p-type');
    if (!p) return;
    var list = selectedTexts(a);
    var t = list.length ? list[0].text : (a.typeOpts || { family: 'Noto Sans KR, sans-serif', size: 24, weight: 400, leading: 1.2, tracking: 0, align: 'left', italic: false });
    syncing = true;
    var f = U.q('#ty-font', p);
    if (f && document.activeElement !== f) {
      if (!Array.prototype.some.call(f.options, function (o) { return o.value === t.family; })) {
        var op = document.createElement('option');
        op.value = t.family; op.textContent = t.family;
        f.appendChild(op);
      }
      f.value = t.family;
    }
    var w = U.q('#ty-weight', p);
    if (w) w.value = String(t.weight || 400);
    var it = U.q('#ty-italic', p);
    if (it) it.classList.toggle('on', !!t.italic);
    [['#ty-size', t.size], ['#ty-leading', t.leading], ['#ty-tracking', t.tracking]].forEach(function (o) {
      var el = U.q(o[0], p);
      if (el && document.activeElement !== el) el.value = U.fmt(o[1] == null ? 0 : o[1]);
    });
    U.qa('[data-talign]', p).forEach(function (b) { b.classList.toggle('on', b.dataset.talign === (t.align || 'left')); });
    document.querySelector('.panel[data-panel="type"]').style.opacity = list.length ? '1' : '.65';
    syncing = false;
  };

  /* ================= 그레이디언트 ================= */
  var gradStop = 0;

  function currentGradient(a, create) {
    var target = null;
    if (a.sel.length) {
      var it = a.sel[0];
      while (it && it.type === 'group' && it.children.length) it = it.children[it.children.length - 1];
      if (it) target = a.fillFocus ? it.fill : it.stroke;
    }
    if (!Col.isGradient(target)) target = a.fillFocus ? a.fill : a.stroke;
    if (!Col.isGradient(target) && create) return null;
    return Col.isGradient(target) ? target : null;
  }

  function applyGradient(label, mutate) {
    var g = currentGradient(app);
    if (!g) {
      g = Col.gradient('linear', '#ffffff', '#000000');
      if (app.fillFocus) app.fill = g; else app.stroke = g;
    }
    mutate(g);
    if (app.sel.length) {
      app.history.begin(label, app.doc);
      E.applyPaint(app, g, app.fillFocus ? 'fill' : 'stroke');
      app.history.commit();
    }
    if (app.fillFocus) app.fill = U.deepCopy(g); else app.stroke = U.deepCopy(g);
    app.invalidate();
    UI.syncGradient(app);
    UI.syncStyle(app);
  }

  /* 선형·방사형 <-> 자유형 오가기.
     자유형은 정지점 대신 위치를 가진 색 점을 쓰므로 서로 옮겨 담는다. */
  function toFreeform(g) {
    if (g.type === 'freeform') return;
    var it = app.sel.filter(function (o) { return o.type !== 'group'; })[0];
    var b = it ? Rn.localBounds(it) : { x: 0, y: 0, x2: 100, y2: 100 };
    var w = (b.x2 - b.x) || 100, h = (b.y2 - b.y) || 100;
    var src = (g.stops && g.stops.length) ? g.stops.slice().sort(function (a, c) { return a.t - c.t; })
      : [{ t: 0, color: '#ffffff' }, { t: 1, color: '#000000' }];
    /* 정지점을 도형 안에 대각선으로 늘어놓는다 */
    g.stops = src.map(function (s, i) {
      var u = src.length < 2 ? 0.5 : i / (src.length - 1);
      return {
        x: b.x + w * (0.2 + 0.6 * u), y: b.y + h * (0.2 + 0.6 * u),
        color: s.color, alpha: s.alpha == null ? 1 : s.alpha, spread: 60
      };
    });
    g.mode = 'points';
    g.lines = [];
    delete g.p0; delete g.p1;
  }
  function fromFreeform(g, kind) {
    var n = Math.max(2, g.stops.length);
    g.stops = g.stops.map(function (s, i) {
      return { t: i / (n - 1), color: s.color, alpha: s.alpha == null ? 1 : s.alpha };
    });
    if (g.stops.length < 2) g.stops.push({ t: 1, color: '#000000', alpha: 1 });
    delete g.mode; delete g.lines;
    g.angle = g.angle || 0;
  }

  function buildGradient() {
    var p = document.getElementById('p-gradient');
    p.innerHTML =
      '<div class="row">' +
      '<select class="fld" id="gr-type" style="flex:1"><option value="linear">선형</option><option value="radial">방사형</option><option value="freeform">자유형</option></select>' +
      '<label title="각도">∠</label><input class="fld" id="gr-angle" style="width:48px" value="0">' +
      '<button class="mini-btn" id="gr-rev" title="정지점 반전">' + UI.icon('reverse', 13) + '</button>' +
      '</div>' +
      '<div class="gradbar" id="gr-bar"><div class="gradfill" id="gr-fill"></div><div class="stops" id="gr-stops"></div></div>' +
      '<div class="row" style="margin-top:8px">' +
      '<button class="swatch-btn" id="gr-color" title="선택한 정지점 색상"><i></i></button>' +
      '<label>위치</label><input class="fld" id="gr-pos" style="width:52px" value="0"><span class="unit">%</span>' +
      '<label>불투명</label><input class="fld" id="gr-alpha" style="width:46px" value="100">' +
      '<button class="mini-btn danger" id="gr-del" title="정지점 삭제">' + UI.icon('trash', 13) + '</button>' +
      '</div>' +
      '<div class="row" id="gr-spread-row" style="margin-top:var(--gap-s);display:none">' +
      '<label>모드</label><select class="fld" id="gr-mode" style="width:74px"><option value="points">점</option><option value="lines">선</option></select>' +
      '<label>번짐</label><input class="fld" id="gr-spread" style="width:52px" value="50"><span class="unit">%</span>' +
      '</div>' +
      '<div class="hint">막대를 클릭하면 정지점 추가, 드래그하면 이동합니다. G 도구로 캔버스에서 방향을 그릴 수 있습니다.<br>자유형은 도형 위의 색 점을 끌어 옮기고, 빈 곳을 두 번 누르면 점이 늘어납니다.</div>';

    U.on(U.q('#gr-mode', p), 'change', function () {
      var v = this.value;
      applyGradient('자유형 모드', function (g) {
        g.mode = v;
        if (v === 'lines' && (!g.lines || !g.lines.length)) {
          g.lines = [g.stops.map(function (_, i) { return i; })];
        }
      });
    });
    num(U.q('#gr-spread', p), function () { return 50; }, function (v) {
      applyGradient('번짐', function (g) {
        var st = g.stops[gradStop];
        if (st) st.spread = U.clamp(v, 1, 200);
      });
    }, '번짐');

    U.on(U.q('#gr-type', p), 'change', function () {
      var v = this.value;
      applyGradient('그레이디언트 유형', function (g) {
        if (v === 'freeform') toFreeform(g);
        else if (g.type === 'freeform') fromFreeform(g, v);
        g.type = v;
      });
    });
    num(U.q('#gr-angle', p), function () { return 0; }, function (v) { applyGradient('그레이디언트 각도', function (g) { g.angle = v; }); }, '각도');
    U.on(U.q('#gr-rev', p), 'click', function () {
      applyGradient('정지점 반전', function (g) {
        g.stops = g.stops.map(function (s) { return { t: 1 - s.t, color: s.color, alpha: s.alpha }; })
          .sort(function (a, b) { return a.t - b.t; });
      });
    });
    U.on(U.q('#gr-del', p), 'click', function () {
      applyGradient('정지점 삭제', function (g) {
        if (g.stops.length <= 2) { U.toast('정지점은 최소 2개 필요합니다'); return; }
        g.stops.splice(gradStop, 1);
        gradStop = Math.max(0, gradStop - 1);
      });
    });
    U.on(U.q('#gr-color', p), 'click', function () {
      app.gradStopEdit = true;
      UI.openColorPicker(app, this);
    });
    num(U.q('#gr-pos', p), function () { return 0; }, function (v) {
      applyGradient('정지점 위치', function (g) {
        var st = g.stops[gradStop];
        if (st) st.t = U.clamp(v / 100, 0, 1);
        g.stops.sort(function (a, b) { return a.t - b.t; });
        gradStop = g.stops.indexOf(st);
      });
    }, '정지점 위치');
    num(U.q('#gr-alpha', p), function () { return 100; }, function (v) {
      applyGradient('정지점 불투명도', function (g) {
        var st = g.stops[gradStop];
        if (st) st.alpha = U.clamp(v / 100, 0, 1);
      });
    }, '정지점 불투명도');

    var bar = U.q('#gr-bar', p);
    U.on(bar, 'mousedown', function (ev) {
      var g = currentGradient(app);
      if (!g) { applyGradient('그레이디언트', function () { }); g = currentGradient(app); if (!g) return; }
      var r = bar.getBoundingClientRect();
      var t = U.clamp((ev.clientX - r.left) / r.width, 0, 1);
      var hitIdx = -1;
      g.stops.forEach(function (s, i) { if (Math.abs(s.t - t) * r.width < 7) hitIdx = i; });
      if (hitIdx < 0) {
        applyGradient('정지점 추가', function (gg) {
          gg.stops.push({ t: t, color: sampleGradient(gg, t), alpha: 1 });
          gg.stops.sort(function (a, b) { return a.t - b.t; });
          gradStop = gg.stops.findIndex(function (s) { return s.t === t; });
        });
      } else {
        gradStop = hitIdx;
        UI.syncGradient(app);
      }
      var idx = gradStop;
      var move = function (e) {
        var nt = U.clamp((e.clientX - r.left) / r.width, 0, 1);
        applyGradient('정지점 이동', function (gg) {
          var st = gg.stops[idx];
          if (!st) return;
          st.t = nt;
          gg.stops.sort(function (a, b) { return a.t - b.t; });
          idx = gradStop = gg.stops.indexOf(st);
        });
      };
      var up = function () { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      ev.preventDefault();
    });
  }

  function sampleGradient(g, t) {
    var ss = g.stops.slice().sort(function (a, b) { return a.t - b.t; });
    if (t <= ss[0].t) return ss[0].color;
    if (t >= ss[ss.length - 1].t) return ss[ss.length - 1].color;
    for (var i = 0; i < ss.length - 1; i++) {
      if (t >= ss[i].t && t <= ss[i + 1].t) {
        var k = (t - ss[i].t) / Math.max(ss[i + 1].t - ss[i].t, 1e-6);
        return Col.mix(ss[i].color, ss[i + 1].color, k);
      }
    }
    return ss[0].color;
  }

  /* 색상 피커에서 정지점 색을 바꿀 때 호출 */
  /* 캔버스의 주석자에서 정지점을 고르면 패널도 같은 정지점을 가리키게 한다 */
  UI.setGradientStopIndex = function (a, i) {
    var g = currentGradient(a);
    if (!g || !g.stops || i == null || i < 0 || i >= g.stops.length) return false;
    gradStop = i;
    UI.syncGradient(a);
    return true;
  };
  UI.gradientStopIndex = function () { return gradStop; };

  UI.setGradientStopColor = function (a, hex) {
    var g = currentGradient(a);
    if (!g) return false;
    var st = g.stops[gradStop];
    if (!st) return false;
    st.color = hex;
    if (a.sel.length) E.applyPaint(a, g, a.fillFocus ? 'fill' : 'stroke');
    if (a.fillFocus) a.fill = U.deepCopy(g); else a.stroke = U.deepCopy(g);
    a.invalidate();
    UI.syncGradient(a);
    return true;
  };

  UI.syncGradient = function (a) {
    var p = document.getElementById('p-gradient');
    if (!p) return;
    var g = currentGradient(a);
    var panel = document.querySelector('.panel[data-panel="gradient"]');
    panel.style.opacity = g ? '1' : '.65';
    syncing = true;
    var stopsEl = U.q('#gr-stops', p), fillEl = U.q('#gr-fill', p);
    if (!g) {
      fillEl.style.background = 'repeating-linear-gradient(45deg,#333 0 6px,#3a3a3a 6px 12px)';
      stopsEl.innerHTML = '';
      syncing = false;
      return;
    }
    gradStop = U.clamp(gradStop, 0, g.stops.length - 1);
    var freeform = g.type === 'freeform';
    setEnabled(p, '#gr-angle', !freeform);
    setEnabled(p, '#gr-rev', !freeform);
    setEnabled(p, '#gr-pos', !freeform);
    var spreadRow = U.q('#gr-spread-row', p);
    if (spreadRow) spreadRow.style.display = freeform ? '' : 'none';
    if (freeform) {
      /* 색 점을 늘어놓아 미리 보여 준다 (막대는 위치 개념이 없다) */
      fillEl.style.background = 'linear-gradient(to right,' +
        g.stops.map(function (s) { return Col.toCss(s.color, s.alpha); }).join(',') + ')';
      stopsEl.innerHTML = '';
      g.stops.forEach(function (s, i) {
        var d = U.el('div', 'gstop' + (i === gradStop ? ' sel' : ''));
        d.style.left = (g.stops.length < 2 ? 50 : (i / (g.stops.length - 1)) * 100) + '%';
        d.style.setProperty('--c', s.color);
        stopsEl.appendChild(d);
      });
      var ty0 = U.q('#gr-type', p); if (ty0) ty0.value = 'freeform';
      var st0 = g.stops[gradStop] || g.stops[0] || { color: '#ffffff' };
      var cb0 = U.q('#gr-color i', p); if (cb0) cb0.style.background = st0.color;
      var al0 = U.q('#gr-alpha', p);
      if (al0 && document.activeElement !== al0) al0.value = U.fmt((st0.alpha == null ? 1 : st0.alpha) * 100);
      var sp0 = U.q('#gr-spread', p);
      if (sp0 && document.activeElement !== sp0) sp0.value = U.fmt(st0.spread == null ? 50 : st0.spread);
      var md = U.q('#gr-mode', p); if (md) md.value = g.mode || 'points';
      syncing = false;
      return;
    }
    fillEl.style.background = 'linear-gradient(to right,' + g.stops.slice().sort(function (x, y) { return x.t - y.t; })
      .map(function (s) { return Col.toCss(s.color, s.alpha) + ' ' + U.round(s.t * 100, 2) + '%'; }).join(',') + ')';
    stopsEl.innerHTML = '';
    g.stops.forEach(function (s, i) {
      var d = U.el('div', 'gstop' + (i === gradStop ? ' sel' : ''));
      d.style.left = (s.t * 100) + '%';
      d.style.setProperty('--c', s.color);
      stopsEl.appendChild(d);
    });
    var ty = U.q('#gr-type', p); if (ty) ty.value = g.type;
    var an = U.q('#gr-angle', p); if (an && document.activeElement !== an) an.value = U.fmt(g.angle || 0);
    var st = g.stops[gradStop] || g.stops[0];
    var pos = U.q('#gr-pos', p); if (pos && document.activeElement !== pos) pos.value = U.fmt((st.t || 0) * 100);
    var al = U.q('#gr-alpha', p); if (al && document.activeElement !== al) al.value = U.fmt((st.alpha == null ? 1 : st.alpha) * 100);
    var cb = U.q('#gr-color i', p); if (cb) cb.style.background = st.color;
    syncing = false;
  };

  /* ================= 견본 ================= */
  function buildSwatches() {
    var p = document.getElementById('p-swatches');
    p.innerHTML = '<div class="grid6" id="sw-grid"></div>' +
      '<div class="hint">클릭 = 칠 / 획(초점), Shift+클릭 = 반대쪽</div>';
    var g = U.q('#sw-grid', p);
    var none = U.el('div', 'sw none');
    none.title = '없음';
    U.on(none, 'click', function () { C.run('noneFill'); });
    g.appendChild(none);
    Col.SWATCHES.forEach(function (hex) {
      var s = U.el('div', 'sw');
      s.style.background = hex;
      s.title = hex;
      U.on(s, 'click', function (ev) {
        var which = ev.shiftKey ? !app.fillFocus : app.fillFocus;
        var paint = Col.solid(hex);
        if (which) app.fill = paint; else app.stroke = paint;
        app.lastColor = hex;
        if (app.sel.length) {
          app.history.begin('색상', app.doc);
          E.applyPaint(app, paint, which ? 'fill' : 'stroke');
          app.history.commit();
        }
        app.invalidate(); UI.syncStyle(app);
      });
      g.appendChild(s);
    });
  }

  /* ================= 획 ================= */
  var ARROW_OPTS =
    '<option value="none">없음</option>' +
    '<option value="arrow">화살표</option>' +
    '<option value="triangle">삼각형</option>' +
    '<option value="circle">원</option>' +
    '<option value="square">사각형</option>' +
    '<option value="bar">막대</option>';

  /* 일러스트레이터의 가변 폭 프로파일에 대응 */
  var WIDTH_PROFILES = {
    uniform: null,
    taper: [{ t: 0, w: 1 }, { t: 1, w: 0.05 }],
    taper2: [{ t: 0, w: 0.05 }, { t: 0.5, w: 1 }, { t: 1, w: 0.05 }],
    bulge: [{ t: 0, w: 0.4 }, { t: 0.5, w: 1.8 }, { t: 1, w: 0.4 }],
    wave: [{ t: 0, w: 0.5 }, { t: 0.25, w: 1.6 }, { t: 0.5, w: 0.5 }, { t: 0.75, w: 1.6 }, { t: 1, w: 0.5 }]
  };

  function buildStroke() {
    var p = document.getElementById('p-stroke');
    p.innerHTML =
      '<div class="row"><label style="min-width:34px">두께</label>' +
      '<input class="fld" id="sk-w" value="1"><span class="unit">pt</span></div>' +

      '<div class="row"><label style="min-width:34px">단면</label>' +
      UI.seg([
        { value: 'butt', icon: 'capButt', title: '끝 단면 (butt)' },
        { value: 'round', icon: 'capRound', title: '둥근 단면 (round)' },
        { value: 'square', icon: 'capSquare', title: '돌출 단면 (square)' }
      ], 'data-cap') + '</div>' +

      '<div class="row"><label style="min-width:34px">모퉁이</label>' +
      UI.seg([
        { value: 'miter', icon: 'joinMiter', title: '마이터 결합' },
        { value: 'round', icon: 'joinRound', title: '둥근 결합' },
        { value: 'bevel', icon: 'joinBevel', title: '베벨 결합' }
      ], 'data-join') + '</div>' +

      '<div class="row"><label style="min-width:34px">정렬</label>' +
      UI.seg([
        { value: 'center', icon: 'strokeCenter', title: '획을 가운데 정렬' },
        { value: 'inside', icon: 'strokeInside', title: '획을 안쪽 정렬 (닫힌 패스)' },
        { value: 'outside', icon: 'strokeOutside', title: '획을 바깥쪽 정렬 (닫힌 패스)' }
      ], 'data-salign') + '</div>' +

      '<div class="row"><label style="min-width:34px">점선</label>' +
      '<input class="fld" id="sk-dash" placeholder="예: 4 2"></div>' +

      '<div class="sec">화살표</div>' +
      '<div class="row">' +
      '<select class="fld" id="sk-a1" title="시작 화살표">' + ARROW_OPTS + '</select>' +
      UI.btn({ icon: 'swapArrows', title: '시작 · 끝 화살표 뒤바꾸기', data: { swap: '1' } }) +
      '<select class="fld" id="sk-a2" title="끝 화살표">' + ARROW_OPTS + '</select></div>' +
      '<div class="row"><label style="min-width:34px">비율</label>' +
      '<input class="fld" id="sk-ascale" value="100"><span class="unit">%</span></div>' +

      '<div class="sec">폭 프로파일</div>' +
      '<div class="row"><select class="fld" id="sk-prof">' +
      '<option value="uniform">균일</option>' +
      '<option value="taper">한쪽 가늘게</option>' +
      '<option value="taper2">양쪽 가늘게</option>' +
      '<option value="bulge">가운데 굵게</option>' +
      '<option value="wave">물결</option>' +
      '</select></div>' +

      '<div class="hint">점선은 공백으로 구분해 입력합니다 (비우면 실선).<br>' +
      '안쪽 · 바깥쪽 정렬과 화살표는 각각 닫힌 · 열린 패스에만 적용됩니다.</div>';

    num(U.q('#sk-w', p), function () { return 1; }, function (v) {
      app.strokeWidth = v;
      E.applyStrokeProp(app, 'width', v);
    }, '획 두께');
    U.qa('[data-cap]', p).forEach(function (b) {
      U.on(b, 'click', function () {
        app.strokeCap = b.dataset.cap;
        app.history.begin('획 단면', app.doc);
        E.applyStrokeProp(app, 'cap', b.dataset.cap);
        app.history.commit(); app.invalidate(); UI.syncStyle(app);
      });
    });
    U.qa('[data-join]', p).forEach(function (b) {
      U.on(b, 'click', function () {
        app.strokeJoin = b.dataset.join;
        app.history.begin('획 모퉁이', app.doc);
        E.applyStrokeProp(app, 'join', b.dataset.join);
        app.history.commit(); app.invalidate(); UI.syncStyle(app);
      });
    });
    U.qa('[data-salign]', p).forEach(function (b) {
      U.on(b, 'click', function () {
        app.strokeAlign = b.dataset.salign;
        app.history.begin('획 정렬', app.doc);
        E.applyStrokeProp(app, 'align', b.dataset.salign);
        app.history.commit(); app.invalidate(); UI.syncStyle(app);
      });
    });
    var dash = U.q('#sk-dash', p);
    U.on(dash, 'keydown', function (ev) { ev.stopPropagation(); if (ev.key === 'Enter') this.blur(); });
    U.on(dash, 'change', function () {
      var arr = dash.value.trim().split(/[\s,]+/).map(parseFloat).filter(function (v) { return !isNaN(v) && v >= 0; });
      app.strokeDash = arr;
      app.history.begin('점선', app.doc);
      E.applyStrokeProp(app, 'dash', arr);
      app.history.commit(); app.invalidate();
    });

    /* 화살표 */
    [['sk-a1', 'arrowStart'], ['sk-a2', 'arrowEnd']].forEach(function (o) {
      U.on(U.q('#' + o[0], p), 'change', function () {
        if (syncing) return;
        app[o[1]] = this.value;
        app.history.begin('화살표', app.doc);
        E.applyStrokeProp(app, o[1], this.value);
        app.history.commit(); app.invalidate(); UI.syncStyle(app);
      });
    });
    U.on(U.q('[data-swap]', p), 'click', function () {
      var a1 = U.q('#sk-a1', p), a2 = U.q('#sk-a2', p);
      var t = a1.value; a1.value = a2.value; a2.value = t;
      app.arrowStart = a1.value; app.arrowEnd = a2.value;
      app.history.begin('화살표 뒤바꾸기', app.doc);
      E.applyStrokeProp(app, 'arrowStart', a1.value);
      E.applyStrokeProp(app, 'arrowEnd', a2.value);
      app.history.commit(); app.invalidate(); UI.syncStyle(app);
    });
    /* 가변 폭 프로파일 (폭 도구로 만든 것과 같은 데이터) */
    U.on(U.q('#sk-prof', p), 'change', function () {
      if (syncing) return;
      var prof = WIDTH_PROFILES[this.value];
      app.history.begin('폭 프로파일', app.doc);
      app.sel.forEach(function (it) {
        (function rec(o) {
          if (o.type === 'group') { o.children.forEach(rec); return; }
          if (!o.stroke) return;
          if (prof) o.stroke.widthProfile = U.deepCopy(prof);
          else delete o.stroke.widthProfile;
          AI.appearance.pushDown(o);
        })(it);
      });
      app.history.commit();
      app.invalidate();
      UI.syncStyle(app);
    });

    num(U.q('#sk-ascale', p), function () { return app.arrowScale == null ? 100 : app.arrowScale; }, function (v) {
      v = U.clamp(v, 1, 1000);
      app.arrowScale = v;
      E.applyStrokeProp(app, 'arrowScale', v);
    }, '화살표 비율');
  }

  /* ================= 정렬 ================= */
  var ALIGN_BTNS = [
    ['alignLeft', '왼쪽 정렬', 'alignLeft'], ['alignHCenter', '가로 가운데 정렬', 'alignHCenter'],
    ['alignRight', '오른쪽 정렬', 'alignRight'], ['alignTop', '위쪽 정렬', 'alignTop'],
    ['alignVCenter', '세로 가운데 정렬', 'alignVCenter'], ['alignBottom', '아래쪽 정렬', 'alignBottom']
  ];

  function buildAlign() {
    var p = document.getElementById('p-align');
    p.innerHTML =
      '<div class="sec">오브젝트 정렬</div>' +
      '<div class="grid6">' +
      ALIGN_BTNS.map(function (o) {
        return UI.btn({ icon: o[2], title: o[1], cmd: o[0] });
      }).join('') + '</div>' +

      '<div class="sec">오브젝트 배분</div>' +
      '<div class="grid2">' +
      UI.btn({ icon: 'distH', label: '가로', title: '가로 균등 배분', cmd: 'distH' }) +
      UI.btn({ icon: 'distV', label: '세로', title: '세로 균등 배분', cmd: 'distV' }) +
      '</div>' +

      '<div class="row" style="margin-top:8px"><label style="min-width:34px">기준</label>' +
      '<select class="fld" id="al-to">' +
      '<option value="selection">선택 영역</option>' +
      '<option value="artboard">대지</option>' +
      '<option value="key">키 오브젝트</option>' +
      '</select></div>';
    U.qa('[data-cmd]', p).forEach(function (b) { U.on(b, 'click', function () { C.run(b.dataset.cmd); }); });
    U.on(U.q('#al-to', p), 'change', function () { app.alignTo = this.value; });
  }

  UI.syncAlign = function (a) {
    var p = document.getElementById('p-align');
    if (!p) return;
    U.qa('[data-cmd]', p).forEach(function (b) {
      var d = C.defs[b.dataset.cmd];
      var on = !d || !d.enabled || d.enabled(a);
      /* 배분은 3개 이상이어야 의미가 있다 */
      if (b.dataset.cmd === 'distH' || b.dataset.cmd === 'distV') on = a.sel.length > 2;
      if (on) b.removeAttribute('disabled'); else b.setAttribute('disabled', '');
    });
    var sel = U.q('#al-to', p);
    if (sel && sel.value !== (a.alignTo || 'selection')) sel.value = a.alignTo || 'selection';
  };

  /* ================= 패스파인더 ================= */
  function buildPathfinder() {
    var p = document.getElementById('p-pathfinder');
    var shape = [['unite', '합치기'], ['minusFront', '앞면 제외'], ['intersect', '교차'], ['exclude', '교차 제외']];
    var conv = [['divide', '나누기'], ['trim', '자르기'], ['merge', '병합'], ['crop', '오리기'], ['outline', '윤곽선'], ['minusBack', '뒷면 제외']];
    p.innerHTML =
      '<div class="sec">모양 모드</div>' +
      '<div class="grid4">' + shape.map(function (o) {
        return '<button class="btn pf" data-pf="' + o[0] + '" title="' + o[1] + '">' + pfIcon(o[0]) + '</button>';
      }).join('') + '</div>' +
      '<div class="sec">패스파인더</div>' +
      '<div class="grid6">' + conv.map(function (o) {
        return '<button class="btn pf" data-pf="' + o[0] + '" title="' + o[1] + '">' + pfIcon(o[0]) + '</button>';
      }).join('') + '</div>' +
      '<div class="hint">2개 이상의 도형을 선택한 뒤 사용하세요. 곡선은 근사 처리됩니다.</div>';
    U.qa('[data-pf]', p).forEach(function (b) { U.on(b, 'click', function () { C.run('pf_' + b.dataset.pf); }); });
  }

  /* 선택이 2개 미만이면 패스파인더 버튼을 흐리게 */
  UI.syncPathfinder = function (a) {
    var p = document.getElementById('p-pathfinder');
    if (!p) return;
    var on = a.sel.length > 1;
    U.qa('[data-pf]', p).forEach(function (b) {
      if (on) b.removeAttribute('disabled'); else b.setAttribute('disabled', '');
    });
  };

  function pfIcon(op) {
    var s = '<svg viewBox="0 0 20 16" style="width:20px;height:16px">';
    var A = '<rect x="2" y="3" width="10" height="10" rx="1"/>';
    var B = '<rect x="8" y="3" width="10" height="10" rx="1"/>';
    var f = '#c9c9c9', d = '#5a5a5a';
    if (op === 'unite') s += '<g fill="' + f + '">' + A + B + '</g>';
    else if (op === 'minusFront') s += '<g fill="' + f + '">' + A + '</g><g fill="#333">' + B + '</g>';
    else if (op === 'intersect') s += '<g fill="' + d + '">' + A + B + '</g><rect x="8" y="3" width="4" height="10" fill="' + f + '"/>';
    else if (op === 'exclude') s += '<g fill="' + f + '">' + A + B + '</g><rect x="8" y="3" width="4" height="10" fill="#333"/>';
    else if (op === 'divide') s += '<g fill="' + f + '">' + A + B + '</g><rect x="8" y="3" width="4" height="10" fill="#8a8a8a"/>';
    else if (op === 'trim') s += '<g fill="' + f + '">' + A + '</g><g fill="#8a8a8a">' + B + '</g>';
    else if (op === 'merge') s += '<g fill="' + f + '">' + A + B + '</g>';
    else if (op === 'crop') s += '<g fill="' + d + '">' + A + '</g><g fill="' + f + '">' + B + '</g>';
    else if (op === 'outline') s += '<g fill="none" stroke="' + f + '">' + A + B + '</g>';
    else s += '<g fill="#333">' + A + '</g><g fill="' + f + '">' + B + '</g>';
    return s + '</svg>';
  }

  /* ================= 심볼 · 패턴 ================= */
  function buildSymbols() {
    var p = document.getElementById('p-symbols');
    if (!p) return;
    p.innerHTML =
      '<div class="sec">심볼</div>' +
      '<div id="sy-list" class="sw-grid"></div>' +
      '<div class="grid2" style="margin-top:var(--gap-s)">' +
      UI.btn({ icon: 'symbol', label: '새 심볼', title: '선택 아트웍을 심볼로 등록', cmd: 'newSymbol' }) +
      UI.btn({ icon: 'breakLink', label: '링크 끊기', title: '인스턴스를 실제 아트웍으로', cmd: 'breakSymbolLink' }) +
      '</div>' +
      '<div class="sec">패턴</div>' +
      '<div id="pt-list" class="sw-grid"></div>' +
      '<div class="grid2" style="margin-top:var(--gap-s)">' +
      UI.btn({ icon: 'pattern', label: '새 패턴', title: '선택 아트웍을 타일로 등록', cmd: 'newPattern' }) +
      UI.btn({ icon: 'gear', label: '패턴 옵션', cmd: 'patternOptions' }) +
      '</div>' +
      '<div class="sec">브러시</div>' +
      '<div class="grid2">' +
      UI.btn({ icon: 'brush', label: '브러시 옵션', title: '서예 · 산포 브러시', cmd: 'brushOptions' }) +
      UI.btn({ icon: 'recolor', label: '재색상화', title: '아트웍 재색상화', cmd: 'recolor' }) +
      '</div>' +
      '<div class="hint">심볼을 클릭하면 화면 가운데에 배치되고, 패턴을 클릭하면 선택한 오브젝트의 칠이 됩니다.</div>';
    U.qa('[data-cmd]', p).forEach(function (b) { U.on(b, 'click', function () { C.run(b.dataset.cmd); }); });
  }

  UI.syncSymbols = function (a) {
    AI.assets.ensure(a.doc);
    var sy = document.getElementById('sy-list'), pt = document.getElementById('pt-list');
    if (!sy || !pt) return;
    var p = document.getElementById('p-symbols');

    U.qa('[data-cmd]', p).forEach(function (b) {
      var d = C.defs[b.dataset.cmd];
      var on = !d || !d.enabled || d.enabled(a);
      if (on) b.removeAttribute('disabled'); else b.setAttribute('disabled', '');
    });

    sy.innerHTML = a.doc.symbols.length
      ? a.doc.symbols.map(function (d, i) {
        return '<button class="sw" data-sym="' + i + '" title="' + U.esc(d.name) + ' — 클릭해 배치">' +
          UI.icon('symbol', 15) + '<span class="nm">' + U.esc(d.name) + '</span></button>';
      }).join('')
      : '<div class="list-empty">심볼 없음</div>';
    U.qa('[data-sym]', sy).forEach(function (b) {
      U.on(b, 'click', function () {
        var d = a.doc.symbols[+b.dataset.sym];
        a.lastSymbolId = d.id;
        a.history.begin('심볼 배치', a.doc);
        var c = AI.viewT.toDoc(a, a.canvas.clientWidth / 2, a.canvas.clientHeight / 2);
        AI.assets.placeSymbol(a, d.id, c.x, c.y);
        a.history.commit();
        a.invalidate();
        UI.syncAll(a);
      });
    });

    pt.innerHTML = a.doc.patterns.length
      ? a.doc.patterns.map(function (d, i) {
        return '<button class="sw" data-pat="' + i + '" title="' + U.esc(d.name) + ' — 클릭해 칠하기">' +
          UI.icon('pattern', 15) + '<span class="nm">' + U.esc(d.name) + '</span></button>';
      }).join('')
      : '<div class="list-empty">패턴 없음</div>';
    U.qa('[data-pat]', pt).forEach(function (b) {
      U.on(b, 'click', function () {
        var d = a.doc.patterns[+b.dataset.pat];
        if (!a.sel.length) { U.toast('오브젝트를 먼저 선택하세요'); return; }
        a.history.begin('패턴 칠', a.doc);
        E.applyPaint(a, AI.assets.patternPaint(d), a.fillFocus ? 'fill' : 'stroke');
        a.history.commit();
        a.invalidate();
        UI.syncAll(a);
      });
    });
  };

  /* ================= 모양 (Appearance) ================= */
  function buildAppearance() {
    var p = document.getElementById('p-appearance');
    if (!p) return;
    p.innerHTML =
      '<div id="ap-list" class="list"></div>' +
      '<div class="grid4" style="margin-top:var(--gap-s)">' +
      UI.btn({ icon: 'addFill', title: '새 칠 추가', data: { apcmd: 'addFill' } }) +
      UI.btn({ icon: 'addStroke', title: '새 획 추가', data: { apcmd: 'addStroke' } }) +
      UI.btn({ icon: 'moveUp', title: '선택한 겹을 앞으로', data: { apcmd: 'up' } }) +
      UI.btn({ icon: 'moveDown', title: '선택한 겹을 뒤로', data: { apcmd: 'down' } }) +
      '</div>' +
      '<div class="grid2">' +
      UI.btn({ icon: 'trash', label: '겹 삭제', title: '선택한 겹 삭제', data: { apcmd: 'remove' }, cls: 'danger' }) +
      UI.btn({ icon: 'expand', label: '모양 확장', title: '각 겹을 실제 오브젝트로', cmd: 'expandAppearance' }) +
      '</div>' +
      '<div class="hint">겹을 클릭해 선택한 뒤 색을 바꾸세요. 목록 위쪽이 앞(위)에 그려집니다.</div>';
    U.qa('[data-apcmd]', p).forEach(function (b) {
      U.on(b, 'click', function () { apCommand(b.dataset.apcmd); });
    });
    U.qa('[data-cmd]', p).forEach(function (b) { U.on(b, 'click', function () { C.run(b.dataset.cmd); }); });
  }

  function apTarget(a) { return a.sel.length === 1 && AI.appearance.supports(a.sel[0]) ? a.sel[0] : null; }

  function apCommand(cmd) {
    var it = apTarget(app);
    if (!it) { U.toast('패스나 문자를 하나만 선택하세요'); return; }
    var AP = AI.appearance;
    var n = AP.list(it).length;
    var i = app.apIndex == null ? n - 1 : U.clamp(app.apIndex, 0, n - 1);
    app.history.begin('모양', app.doc);
    var ok = true;
    if (cmd === 'addFill') { AP.addFill(it); app.apIndex = null; }
    else if (cmd === 'addStroke') { AP.addStroke(it); app.apIndex = null; }
    else if (cmd === 'remove') { ok = AP.removeAt(it, i); app.apIndex = null; }
    else if (cmd === 'up') { ok = AP.moveAt(it, i, 1); if (ok) app.apIndex = i + 1; }
    else if (cmd === 'down') { ok = AP.moveAt(it, i, -1); if (ok) app.apIndex = i - 1; }
    if (!ok) { app.history.abort(); U.toast('더 이상 할 수 없습니다'); }
    else app.history.commit();
    app.invalidate();
    UI.syncAll(app);
  }

  /* 칠 · 획 겹의 색 견본 */
  function paintChip(e) {
    if (e.kind === 'fill') {
      return '<span class="chip"><i style="background:' + Col.paintPreviewCss(e.paint) + '"></i></span>';
    }
    var s2 = e.stroke;
    var css = (s2 && s2.type !== 'none') ? Col.paintPreviewCss(s2) : 'transparent';
    return '<span class="chip stroke" style="color:' + (s2 && s2.color ? s2.color : 'transparent') +
      '"><i style="background:' + css + '"></i></span>';
  }

  UI.syncAppearance = function (a) {
    var host = document.getElementById('ap-list');
    if (!host) return;
    var AP = AI.appearance;
    var it = apTarget(a);
    var p = document.getElementById('p-appearance');

    if (!it) {
      host.innerHTML = '<div class="list-empty">' +
        (a.sel.length ? '패스나 문자를 하나만 선택하세요' : '선택 없음') + '</div>';
      setEnabled(p, '[data-apcmd]', false);
      setEnabled(p, '[data-cmd]', false);
      return;
    }
    setEnabled(p, '[data-apcmd]', true);

    var list = AP.list(it);
    if (a.apIndex != null) a.apIndex = U.clamp(a.apIndex, 0, list.length - 1);
    /* 일러스트레이터처럼 위쪽이 앞(스택의 끝)이므로 뒤집어 보여 준다 */
    var rows = [];
    for (var i = list.length - 1; i >= 0; i--) {
      rows.push('<div class="list-row' + (i === a.apIndex ? ' on' : '') + '" data-i="' + i + '">' +
        paintChip(list[i]) +
        '<span class="list-name">' + U.esc(AP.label(list[i])) + '</span></div>');
    }
    host.innerHTML = rows.join('');
    /* 겹이 하나뿐이면 삭제할 수 없고, 확장은 스택이 있을 때만 */
    setEnabled(p, '[data-apcmd="remove"]', list.length > 1);
    setEnabled(p, '[data-apcmd="up"]', a.apIndex != null && a.apIndex < list.length - 1);
    setEnabled(p, '[data-apcmd="down"]', a.apIndex != null && a.apIndex > 0);
    setEnabled(p, '[data-cmd="expandAppearance"]', AP.isCustom(it));

    U.qa('.list-row', host).forEach(function (row) {
      U.on(row, 'click', function () {
        a.apIndex = +row.dataset.i;
        var e = AP.entry(it, a.apIndex);
        /* 선택한 겹을 색상 패널의 편집 대상으로 삼는다 */
        a.fillFocus = (e && e.kind === 'fill');
        UI.syncAll(a);
      });
    });
  };

  /* 셀렉터에 맞는 버튼의 사용 가능 여부를 한 번에 설정 */
  function setEnabled(root, sel, on) {
    if (!root) return;
    U.qa(sel, root).forEach(function (b) {
      if (on) b.removeAttribute('disabled'); else b.setAttribute('disabled', '');
    });
  }
  UI.setEnabled = setEnabled;

  /* ================= 효과 ================= */
  function buildEffects() {
    var p = document.getElementById('p-effects');
    if (!p) return;
    p.innerHTML =
      '<div class="sec">3D</div>' +
      '<div class="grid2">' +
      UI.btn({ icon: 'fx3dExtrude', label: '돌출과 경사', title: '평면을 두께 있는 입체로', cmd: 'fx3dExtrude' }) +
      UI.btn({ icon: 'fx3dRotate', label: '3D 회전', title: '평면을 3차원으로 돌리기', cmd: 'fx3dRotate' }) +
      '</div>' +
      '<div class="sec" style="margin-top:var(--gap-s)">왜곡 및 변형</div>' +
      '<div class="grid4">' +
      UI.btn({ icon: 'fxZigzag', title: '지그재그', cmd: 'fxZigzag' }) +
      UI.btn({ icon: 'fxRoughen', title: '거칠게 하기', cmd: 'fxRoughen' }) +
      UI.btn({ icon: 'fxPucker', title: '오목· 볼록', cmd: 'fxPuckerBloat' }) +
      UI.btn({ icon: 'fxTwist', title: '비틀기', cmd: 'fxTwist' }) +
      UI.btn({ icon: 'fxTransformFx', title: '변형', cmd: 'fxTransform' }) +
      UI.btn({ icon: 'fxFreeDistort', title: '자유 왜곡', cmd: 'fxFreeDistort' }) +
      '</div>' +
      '<div class="sec">흐림 효과 · 스타일화</div>' +
      '<div class="grid4">' +
      UI.btn({ icon: 'fxBlur', title: '가우시안 흐림', cmd: 'fxBlur' }) +
      UI.btn({ icon: 'fxShadow', title: '그림자 만들기', cmd: 'fxShadow' }) +
      UI.btn({ icon: 'fxGlow', title: '외부 광선', cmd: 'fxGlow' }) +
      UI.btn({ icon: 'fxRepeat', title: '마지막 효과 적용', cmd: 'fxLast' }) +
      '</div>' +
      '<div id="fx-list" class="list" style="margin-top:var(--gap-s)"></div>' +
      '<div class="grid2" style="margin-top:var(--gap-s)">' +
      UI.btn({ icon: 'fxClear', label: '모양 지우기', title: '적용된 효과 모두 제거', cmd: 'fxClear', cls: 'danger' }) +
      UI.btn({ icon: 'expand', label: '모양 확장', cmd: 'expandAppearance' }) +
      '</div>' +
      '<div class="hint">효과는 비파괴적입니다 — 원본 패스는 그대로 남고, 목록에서 다시 편집하거나 지울 수 있습니다.</div>';
    U.qa('[data-cmd]', p).forEach(function (b) { U.on(b, 'click', function () { C.run(b.dataset.cmd); }); });
  }

  UI.syncEffects = function (a) {
    var host = document.getElementById('fx-list');
    if (!host) return;
    var p = document.getElementById('p-effects');
    var FX = AI.effects;
    var it = a.sel.length === 1 ? a.sel[0] : null;

    /* 버튼은 명령이 실제로 쓸 수 있을 때만 켠다 */
    U.qa('[data-cmd]', p).forEach(function (b) {
      var d = C.defs[b.dataset.cmd];
      var on = !d || !d.enabled || d.enabled(a);
      if (on) b.removeAttribute('disabled'); else b.setAttribute('disabled', '');
    });

    if (!it) {
      host.innerHTML = '<div class="list-empty">' +
        (a.sel.length ? a.sel.length + '개 선택됨 — 목록은 하나만 선택했을 때 표시됩니다' : '선택 없음') + '</div>';
      return;
    }
    var list = FX.list(it);
    if (!list.length) { host.innerHTML = '<div class="list-empty">적용된 효과 없음</div>'; return; }
    host.innerHTML = list.map(function (e, i) {
      return '<div class="list-row" data-i="' + i + '">' +
        '<span class="list-name" title="두 번 눌러 편집">' + U.esc(FX.label(e)) + '</span>' +
        '<button class="mini-btn" data-edit="' + i + '" title="편집">' + UI.icon('pencil', 12) + '</button>' +
        '<button class="mini-btn" data-del="' + i + '" title="삭제">' + UI.icon('close', 12) + '</button>' +
        '</div>';
    }).join('');
    U.qa('[data-edit]', host).forEach(function (b) {
      U.on(b, 'click', function (ev) { ev.stopPropagation(); AI.dialogs.effect(app, list[+b.dataset.edit].type); });
    });
    U.qa('[data-del]', host).forEach(function (b) {
      U.on(b, 'click', function (ev) {
        ev.stopPropagation();
        app.history.begin('효과 삭제', app.doc);
        AI.effects.removeAt(it, +b.dataset.del);
        app.history.commit();
        app.invalidate();
        UI.syncAll(app);
      });
    });
    U.qa('.list-row', host).forEach(function (row) {
      U.on(row, 'dblclick', function () { AI.dialogs.effect(app, list[+row.dataset.i].type); });
    });
  };

  /* ================= 대지 ================= */
  function buildArtboards() {
    var p = document.getElementById('p-artboards');
    if (!p) return;
    p.innerHTML =
      '<div id="ab-list" class="list"></div>' +
      '<div class="grid4" style="margin-top:var(--gap-s)">' +
      UI.btn({ icon: 'plus', title: '새 대지', cmd: 'newArtboard' }) +
      UI.btn({ icon: 'duplicate', title: '대지 복제', cmd: 'duplicateArtboard' }) +
      UI.btn({ icon: 'gear', title: '대지 옵션', cmd: 'artboardOptions' }) +
      UI.btn({ icon: 'trash', title: '대지 삭제', cmd: 'deleteArtboard', cls: 'danger' }) +
      '</div>' +
      '<div class="grid2">' +
      UI.btn({ icon: 'fitSelection', label: '선택에 맞춤', title: '대지를 선택 항목에 맞추기', cmd: 'fitArtboardToSelection' }) +
      UI.btn({ icon: 'fitArtwork', label: '아트웍에 맞춤', title: '대지를 아트웍 전체에 맞추기', cmd: 'fitArtboardToArtwork' }) +
      '</div>' +
      '<div class="grid2">' +
      UI.btn({ icon: 'rearrange', label: '모두 재정렬', cmd: 'rearrangeArtboards' }) +
      UI.btn({ icon: 'fitAll', label: '전체 보기', cmd: 'fitAll' }) +
      '</div>' +
      '<div class="hint">행을 클릭하면 그 대지로 이동하고, 두 번 누르면 옵션이 열립니다.</div>';
    U.qa('[data-cmd]', p).forEach(function (b) { U.on(b, 'click', function () { C.run(b.dataset.cmd); }); });
  }

  UI.syncArtboards = function (a) {
    var host = document.getElementById('ab-list');
    if (!host) return;
    var p = document.getElementById('p-artboards');
    var un = a.prefs.unit || 'pt';
    host.innerHTML = a.doc.artboards.map(function (ab, i) {
      return '<div class="list-row' + (i === a.doc.activeArtboard ? ' on' : '') + '" data-ab="' + i + '">' +
        '<span class="list-num">' + (i + 1) + '</span>' +
        '<span class="list-name" title="두 번 눌러 옵션 열기">' + U.esc(ab.name) + '</span>' +
        '<span class="list-sub">' + U.fmtUnit(ab.w, un) + ' × ' + U.fmtUnit(ab.h, un) + '</span>' +
        '</div>';
    }).join('');
    U.qa('[data-cmd]', p).forEach(function (b) {
      var d = C.defs[b.dataset.cmd];
      var on = !d || !d.enabled || d.enabled(a);
      if (b.dataset.cmd === 'deleteArtboard') on = a.doc.artboards.length > 1;
      if (on) b.removeAttribute('disabled'); else b.setAttribute('disabled', '');
    });
    U.qa('.list-row', host).forEach(function (row) {
      U.on(row, 'click', function () {
        a.doc.activeArtboard = +row.dataset.ab;
        AI.viewT.fitArtboard(a);
        a.invalidate();
        UI.syncStatus(a);
        UI.syncArtboards(a);
      });
      U.on(row, 'dblclick', function () {
        a.doc.activeArtboard = +row.dataset.ab;
        AI.dialogs.artboardOptions(a);
      });
    });
  };

  /* ================= 컨트롤 바 도구 옵션 (상황별) ================= */
  function optNum(label, id, value, title, onSet, width) {
    return '<span class="ctl-label" title="' + (title || label) + '">' + label + '</span>' +
      '<input class="ctl-input num" id="' + id + '" value="' + value + '" style="width:' + (width || 52) + 'px">';
  }

  UI.buildToolOptions = function (a) {
    var host = document.getElementById('ctl-tool-options');
    if (!host) return;
    var tool = a.tool;
    a.shapeOpts = a.shapeOpts || {};
    var so = a.shapeOpts;
    var html = '', wire = [];

    function shapeOpt(kind, key, def) {
      so[kind] = so[kind] || {};
      return so[kind][key] == null ? def : so[kind][key];
    }

    if (tool === 'rect' || tool === 'roundrect') {
      var r = shapeOpt(tool, 'r', tool === 'roundrect' ? 12 : 0);
      html = optNum('모퉁이', 'to-r', U.fmt(r), '모퉁이 반경');
      wire.push(['to-r', function (v) {
        so[tool] = so[tool] || {}; so[tool].r = Math.max(0, v);
        if (E.updateShape(a, ['rect'], 'r', Math.max(0, v))) return true;
      }, '모퉁이 반경']);
    } else if (tool === 'ellipse') {
      /* 원형 파이 각도 — 선택한 타원이 있으면 바로 반영된다 */
      html = optNum('파이 시작', 'to-p0', U.fmt(shapeOpt('ellipse', 'pieStart', 0)), '파이 시작 각도(°)', null, 48) +
        optNum('끝', 'to-p1', U.fmt(shapeOpt('ellipse', 'pieEnd', 360)), '파이 끝 각도(°)', null, 48);
      wire.push(['to-p0', function (v) {
        so.ellipse.pieStart = v;
        return E.updatePie(a, v, null);
      }, '파이 시작 각도']);
      wire.push(['to-p1', function (v) {
        so.ellipse.pieEnd = v;
        return E.updatePie(a, null, v);
      }, '파이 끝 각도']);
    } else if (tool === 'polygon') {
      html = optNum('변', 'to-n', shapeOpt('polygon', 'n', 6), '변의 수', null, 44);
      wire.push(['to-n', function (v) {
        v = Math.max(3, Math.round(v));
        so.polygon.n = v;
        if (E.updateShape(a, ['polygon'], 'n', v)) return true;
      }, '변의 수']);
    } else if (tool === 'star') {
      html = optNum('점', 'to-n', shapeOpt('star', 'n', 5), '별의 점 개수', null, 44) +
        optNum('비율', 'to-ratio', U.fmt(shapeOpt('star', 'ratio', 0.5) * 100), '안쪽 반지름 비율(%)', null, 48) +
        '<span class="ctl-label">%</span>';
      wire.push(['to-n', function (v) {
        v = Math.max(3, Math.round(v)); so.star.n = v;
        if (E.updateShape(a, ['star'], 'n', v)) return true;
      }, '별 점 개수']);
      wire.push(['to-ratio', function (v) {
        v = U.clamp(v, 1, 100) / 100; so.star.ratio = v;
        if (E.updateShape(a, ['star'], 'ratio', v)) return true;
      }, '별 비율']);
    } else if (tool === 'brush' || tool === 'blob') {
      html = optNum('폭', 'to-bw', U.fmt(a.brushWidth || 3), '브러시 폭', null, 48);
      wire.push(['to-bw', function (v) { a.brushWidth = U.clamp(v, 0.1, 400); }, '브러시 폭']);
    } else if (tool === 'eraser') {
      html = optNum('폭', 'to-ew', U.fmt(a.eraserWidth || 20), '지우개 폭', null, 48);
      wire.push(['to-ew', function (v) { a.eraserWidth = U.clamp(v, 0.5, 800); }, '지우개 폭']);
    } else if (tool === 'pencil') {
      html = optNum('정밀도', 'to-fid', U.fmt(a.pencilFidelity == null ? 2.5 : a.pencilFidelity), '값이 클수록 단순화', null, 48);
      wire.push(['to-fid', function (v) { a.pencilFidelity = U.clamp(v, 0.2, 20); }, '연필 정밀도']);
    } else if (tool === 'type' || tool === 'typearea') {
      a.typeOpts = a.typeOpts || { family: 'Noto Sans KR, sans-serif', size: 24 };
      html = '<select class="ctl-input" id="to-font" style="width:130px">' +
        FONTS.map(function (f) { return '<option value="' + f[0] + '"' + (f[0] === a.typeOpts.family ? ' selected' : '') + '>' + f[1] + '</option>'; }).join('') +
        '</select>' + optNum('크기', 'to-size', U.fmt(a.typeOpts.size || 24), '글꼴 크기', null, 48);
      wire.push(['to-size', function (v) {
        a.typeOpts.size = U.clamp(v, 1, 1200);
        var list = selectedTexts(a);
        list.forEach(function (t) { t.text.size = a.typeOpts.size; });
        UI.syncType(a);
        return list.length > 0;
      }, '글꼴 크기']);
    } else if (tool === 'zoom') {
      html = [50, 100, 200, 400].map(function (z) {
        return '<button class="mini-btn" data-zoom="' + z + '">' + z + '%</button>';
      }).join('');
    } else if (tool === 'gradient') {
      html = '<span class="ctl-label">그레이디언트 도구로 캔버스를 드래그해 방향을 지정하세요</span>';
    } else if (tool === 'artboard') {
      html = '<span class="ctl-label">사전 설정</span>' +
        [['A4', 595, 842], ['FHD', 1920, 1080], ['정사각', 1080, 1080]].map(function (o) {
          return '<button class="mini-btn" data-ab="' + o[1] + 'x' + o[2] + '">' + o[0] + '</button>';
        }).join('');
    } else {
      html = '<button class="mini-btn" id="to-smart" title="고급 안내선 (Ctrl+U)">고급 안내선</button>' +
        '<button class="mini-btn" id="to-grid" title="격자 표시 (Ctrl+\')">격자</button>' +
        '<button class="mini-btn" id="to-snap" title="격자에 물리기">스냅</button>';
    }

    host.innerHTML = html;

    wire.forEach(function (w) {
      var el = document.getElementById(w[0]);
      if (!el) return;
      num(el, function () { return 0; }, function (v) { w[1](v); }, w[2]);
    });

    var fo = document.getElementById('to-font');
    if (fo) U.on(fo, 'change', function () {
      a.typeOpts.family = this.value;
      var list = selectedTexts(a);
      if (list.length) {
        a.history.begin('글꼴', a.doc);
        list.forEach(function (t) { t.text.family = a.typeOpts.family; });
        a.history.commit();
      }
      a.invalidate(); UI.syncType(a);
    });
    U.qa('[data-zoom]', host).forEach(function (b) {
      U.on(b, 'click', function () { AI.viewT.setZoom(a, +b.dataset.zoom / 100); });
    });
    U.qa('[data-ab]', host).forEach(function (b) {
      U.on(b, 'click', function () {
        var d = b.dataset.ab.split('x');
        var ab = a.doc.artboards[a.doc.activeArtboard];
        a.history.begin('대지 크기', a.doc);
        ab.w = +d[0]; ab.h = +d[1];
        a.history.commit();
        a.invalidate(); AI.viewT.fitArtboard(a);
      });
    });
    var sm = document.getElementById('to-smart');
    if (sm) {
      sm.classList.toggle('on', !!a.prefs.smart);
      U.on(sm, 'click', function () { C.run('smartGuides'); UI.buildToolOptions(a); });
      var gr = document.getElementById('to-grid');
      gr.classList.toggle('on', !!a.prefs.grid);
      U.on(gr, 'click', function () { C.run('showGrid'); UI.buildToolOptions(a); });
      var sn = document.getElementById('to-snap');
      sn.classList.toggle('on', !!a.prefs.snapGrid);
      U.on(sn, 'click', function () { C.run('snapGrid'); UI.buildToolOptions(a); });
    }
  };

  /* ================= 동기화 ================= */
  UI.syncTool = function (a) {
    U.qa('#toolbar .tool').forEach(function (el) { el.classList.toggle('active', el.dataset.tool === a.tool); });
    UI.buildToolOptions(a);
    var t = T.current(a);
    var n = document.getElementById('ctl-toolname');
    if (n && t) n.textContent = t.name.replace(' 도구', '');
    var h = document.getElementById('st-hint');
    if (h && t) h.textContent = t.name;
  };

  UI.updateZoom = function (a) {
    ['first', 'prev', 'next', 'last'].forEach(function (k) {
      var b = document.getElementById('ab-' + k);
      if (b) U.on(b, 'click', function () { C.run(k + 'Artboard'); });
    });
    /* 눈금자 우클릭 = 단위 메뉴 (Illustrator 동작) */
    ['ruler-h', 'ruler-v', 'ruler-corner'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      U.on(el, 'contextmenu', function (ev) {
        ev.preventDefault();
        var cm = document.getElementById('contextmenu');
        cm.innerHTML = '';
        cm.className = 'menu-pop';
        [['pt', '포인트'], ['px', '픽셀'], ['mm', '밀리미터'], ['cm', '센티미터'], ['in', '인치']].forEach(function (o) {
          var mi = U.el('div', 'mi');
          mi.innerHTML = '<span class="chk">' + ((app.prefs.unit || 'pt') === o[0] ? '✓' : '') + '</span><span>' + o[1] + '</span>';
          U.on(mi, 'click', function () { cm.hidden = true; C.setUnit(app, o[0]); });
          cm.appendChild(mi);
        });
        cm.style.left = ev.clientX + 'px';
        cm.style.top = ev.clientY + 'px';
        cm.hidden = false;
      });
    });

    var z = document.getElementById('st-zoom');
    if (z && document.activeElement !== z) z.value = U.round(a.view.scale * 100, 2) + '%';
  };

  UI.syncIsolation = function (a) {
    var bar = document.getElementById('iso-bar');
    if (!bar) return;
    var iso = a.isolation || [];
    bar.hidden = iso.length === 0;
    if (!iso.length) return;
    var crumbs = U.q('.iso-crumbs', bar);
    crumbs.innerHTML = '';
    var loc = Model.locate(a.doc, iso[0]);
    var parts = [(loc && loc.layer ? loc.layer.name : '레이어 1')].concat(iso.map(function (g) { return g.name || '그룹'; }));
    parts.forEach(function (name, i) {
      if (i) crumbs.appendChild(U.el('span', 'sepc', '›'));
      var c = U.el('span', 'crumb' + (i === parts.length - 1 ? ' cur' : ''), name);
      U.on(c, 'click', function () {
        a.isolation = iso.slice(0, i);       /* i=0 이면 완전히 빠져나감 */
        if (a.isolation.length) AI.sel.set(a, [a.isolation[a.isolation.length - 1]]);
        else AI.sel.clear(a);
        a.invalidate();
        UI.syncAll(a);
      });
      crumbs.appendChild(c);
    });
    var back = U.q('.iso-back', bar);
    back.onclick = function () { C.run('exitIsolation'); UI.syncAll(a); };
  };

  UI.syncStatus = function (a) {
    var ab = a.doc.artboards[a.doc.activeArtboard];
    var el = document.getElementById('st-artboard');
    var n = a.doc.artboards.length;
    if (el && ab) el.textContent = ab.name + (n > 1 ? ' (' + (a.doc.activeArtboard + 1) + '/' + n + ')' : '');
    var i = a.doc.activeArtboard;
    var dis = { first: i === 0, prev: i === 0, next: i >= n - 1, last: i >= n - 1 };
    Object.keys(dis).forEach(function (k) {
      var b = document.getElementById('ab-' + k);
      if (b) b.disabled = dis[k];
    });
    document.getElementById('doc-title').textContent = a.doc.name + (a.dirty ? ' *' : '');
  };

  function setSwatchBtn(btn, paint, isStroke) {
    if (!btn) return;
    var i = btn.querySelector('i');
    if (!i) return;
    i.style.background = Col.paintPreviewCss(paint);
    i.style.boxShadow = isStroke && paint && paint.type !== 'none' ? 'inset 0 0 0 3px #2b2b2b' : 'none';
  }

  UI.syncStyle = function (a) {
    syncing = true;
    var f = a.fill, s = a.stroke;
    if (a.sel.length) {
      var it = a.sel[0];
      var leaf = it;
      while (leaf && leaf.type === 'group' && leaf.children.length) leaf = leaf.children[leaf.children.length - 1];
      if (leaf) {
        f = leaf.fill || Col.none();
        s = leaf.stroke && leaf.stroke.type !== 'none' ? Col.solid(leaf.stroke.color, leaf.stroke.alpha) : Col.none();
      }
    }
    setSwatchBtn(document.getElementById('ctl-fill'), f);
    setSwatchBtn(document.getElementById('ctl-stroke'), s, true);
    setSwatchBtn(document.getElementById('cl-fill'), f);
    setSwatchBtn(document.getElementById('cl-stroke'), s, true);
    document.getElementById('ctl-fill').classList.toggle('active', !!a.fillFocus);
    document.getElementById('ctl-stroke').classList.toggle('active', !a.fillFocus);

    var ff = document.getElementById('fs-fill'), fsk = document.getElementById('fs-stroke');
    if (ff) { ff.style.background = Col.paintPreviewCss(f); ff.classList.toggle('sel', !!a.fillFocus); }
    if (fsk) { fsk.style.background = Col.paintPreviewCss(s); fsk.classList.toggle('sel', !a.fillFocus); }

    var cur = a.fillFocus ? f : s;
    var hex = (cur && cur.type === 'solid') ? cur.color : '';
    var hexEl = document.getElementById('cl-hex');
    if (hexEl && document.activeElement !== hexEl) hexEl.value = hex || (cur && cur.type === 'none' ? '없음' : '그레이디언트');
    var rgb = Col.hexToRgb(hex || '#000000');
    [['r', rgb.r], ['g', rgb.g], ['b', rgb.b]].forEach(function (o) {
      var el = document.getElementById('cl-' + o[0]);
      if (el && document.activeElement !== el) el.value = Math.round(o[1]);
    });
    var al = document.getElementById('cl-a');
    if (al && document.activeElement !== al) al.value = Math.round(((cur && cur.alpha != null) ? cur.alpha : 1) * 100);

    var w = a.strokeWidth == null ? 1 : a.strokeWidth;
    /* 획이 '없음'이면 width 가 없다 — 그때는 마지막으로 쓰던 두께를 그대로 보여 준다 */
    if (a.sel.length && a.sel[0].stroke && a.sel[0].stroke.width != null) w = a.sel[0].stroke.width;
    var sw = document.getElementById('ctl-stroke-w');
    if (sw && document.activeElement !== sw) sw.value = String(w);
    var skw = document.getElementById('sk-w');
    if (skw && document.activeElement !== skw) skw.value = String(w);

    var cap = (a.sel.length && a.sel[0].stroke) ? a.sel[0].stroke.cap : a.strokeCap;
    var join = (a.sel.length && a.sel[0].stroke) ? a.sel[0].stroke.join : a.strokeJoin;
    U.qa('[data-cap]').forEach(function (b) { b.classList.toggle('on', b.dataset.cap === cap); });
    U.qa('[data-join]').forEach(function (b) { b.classList.toggle('on', b.dataset.join === join); });
    var salign = (a.sel.length && a.sel[0].stroke) ? (a.sel[0].stroke.align || 'center') : (a.strokeAlign || 'center');
    U.qa('[data-salign]').forEach(function (b) { b.classList.toggle('on', b.dataset.salign === salign); });
    var dashEl = document.getElementById('sk-dash');
    if (dashEl && document.activeElement !== dashEl) {
      var d = (a.sel.length && a.sel[0].stroke) ? a.sel[0].stroke.dash : a.strokeDash;
      dashEl.value = (d && d.length) ? d.join(' ') : '';
    }
    var sst = (a.sel.length && a.sel[0].stroke) ? a.sel[0].stroke : null;
    [['sk-a1', 'arrowStart'], ['sk-a2', 'arrowEnd']].forEach(function (o) {
      var el = document.getElementById(o[0]);
      if (!el) return;
      el.value = (sst && sst[o[1]]) || a[o[1]] || 'none';
    });
    var pf = document.getElementById('sk-prof');
    if (pf) {
      var wp = sst && sst.widthProfile;
      var name = 'uniform';
      if (wp) {
        Object.keys(WIDTH_PROFILES).forEach(function (k) {
          if (WIDTH_PROFILES[k] && JSON.stringify(WIDTH_PROFILES[k]) === JSON.stringify(wp)) name = k;
        });
        if (name === 'uniform') name = 'custom';
      }
      if (name === 'custom') {
        if (!U.q('option[value=custom]', pf)) {
          var o = U.el('option'); o.value = 'custom'; o.textContent = '사용자 정의(폭 도구)';
          pf.appendChild(o);
        }
      }
      pf.value = name;
    }
    var asc = document.getElementById('sk-ascale');
    if (asc && document.activeElement !== asc) {
      asc.value = String((sst && sst.arrowScale != null) ? sst.arrowScale : (a.arrowScale == null ? 100 : a.arrowScale));
    }
    syncing = false;
  };

  UI.syncSelection = function (a) {
    syncing = true;
    var n = a.sel.length;
    var info = document.getElementById('pr-info');
    if (info) {
      info.textContent = n === 0 ? '선택 없음'
        : n === 1 ? (a.sel[0].name + ' · ' + a.sel[0].type) : (n + '개 오브젝트 선택됨');
    }
    var b = n ? Rn.selectionBounds(a, true) : null;
    var vals = { x: '', y: '', w: '', h: '', a: '' };
    if (b && !R.isEmpty(b)) {
      var un = a.prefs.unit || 'pt';
      var rp = E.refPointOf(b, a.refPoint || 0);
      vals.x = U.fmtUnit(rp.x, un); vals.y = U.fmtUnit(rp.y, un);
      vals.w = U.fmtUnit(R.w(b), un); vals.h = U.fmtUnit(R.h(b), un);
      vals.a = n === 1 ? U.fmt(M.angle(Model.worldMatrix(a.doc, a.sel[0]))) : '0';
    }
    ['x', 'y', 'w', 'h', 'a'].forEach(function (k) {
      [document.getElementById('ctl-' + k), document.getElementById('tf-' + k)].forEach(function (el) {
        if (el && document.activeElement !== el) el.value = vals[k];
      });
    });
    var op = n ? Math.round((a.sel[0].opacity == null ? 1 : a.sel[0].opacity) * 100) : 100;
    [document.getElementById('ctl-opacity'), document.getElementById('pr-op')].forEach(function (el) {
      if (el && document.activeElement !== el) el.value = op;
    });
    var bl = document.getElementById('pr-blend');
    if (bl && n) bl.value = a.sel[0].blend || 'normal';
    var rf = document.getElementById('tf-ref');
    if (rf) U.qa('.rp', rf).forEach(function (x, i) { x.classList.toggle('on', i === (a.refPoint || 0)); });
    syncing = false;
    UI.syncStyle(a);
  };

  UI.syncAll = function (a) {
    UI.syncDocTabs(a);
    UI.syncTool(a);
    UI.syncSelection(a);
    UI.syncType(a);
    UI.syncStyles(a);
    UI.syncGradient(a);
    UI.syncStatus(a);
    UI.updateZoom(a);
    UI.syncIsolation(a);
    UI.syncPathfinder(a);
    UI.syncAlign(a);
    UI.syncSymbols(a);
    UI.syncAppearance(a);
    UI.syncEffects(a);
    UI.syncArtboards(a);
    UI.buildLayers(a);
  };
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
