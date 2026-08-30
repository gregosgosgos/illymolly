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
    buildControlBar();
    buildProperties();
    buildTransform();
    buildType();
    buildColor();
    buildGradient();
    buildSwatches();
    buildStroke();
    buildAlign();
    buildPathfinder();
    UI.buildLayers(a);
    bindPanelFolding();
    UI.syncAll(a);
  };

  function bindPanelFolding() {
    U.qa('.panel > header').forEach(function (h) {
      U.on(h, 'click', function () { h.parentNode.classList.toggle('collapsed'); });
    });
  }

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
      '<div class="row"><span id="pr-info" style="color:#9a9a9a"></span></div>' +
      '<div class="row"><label>불투명</label><input class="fld" id="pr-op" value="100"><span style="color:#9a9a9a">%</span></div>' +
      '<div class="row"><label style="min-width:34px">혼합</label><select class="fld" id="pr-blend">' +
      ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity']
        .map(function (b) { return '<option value="' + b + '">' + b + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="grid4" style="margin-top:6px">' +
      '<button class="btn" data-cmd="bringToFront" title="맨 앞으로 (Ctrl+Shift+])">⤒</button>' +
      '<button class="btn" data-cmd="bringForward" title="앞으로 (Ctrl+])">↑</button>' +
      '<button class="btn" data-cmd="sendBackward" title="뒤로 (Ctrl+[)">↓</button>' +
      '<button class="btn" data-cmd="sendToBack" title="맨 뒤로 (Ctrl+Shift+[)">⤓</button>' +
      '</div>' +
      '<div class="grid4" style="margin-top:4px">' +
      '<button class="btn" data-cmd="group" title="그룹 (Ctrl+G)">그룹</button>' +
      '<button class="btn" data-cmd="ungroup" title="그룹 풀기 (Ctrl+Shift+G)">풀기</button>' +
      '<button class="btn" data-cmd="lock" title="잠금 (Ctrl+2)">잠금</button>' +
      '<button class="btn" data-cmd="hide" title="숨기기 (Ctrl+3)">숨김</button>' +
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
      '<button class="swatch-btn" id="cl-fill" title="칠"><i></i></button>' +
      '<button class="swatch-btn" id="cl-stroke" title="획"><i></i></button>' +
      '<input class="fld" id="cl-hex" style="flex:1" value="#000000">' +
      '<button class="mini-btn" id="cl-none" title="없음 (/)">∅</button>' +
      '</div>' +
      '<div class="row"><label>R</label><input class="fld" id="cl-r"><label>G</label><input class="fld" id="cl-g"><label>B</label><input class="fld" id="cl-b"></div>' +
      '<div class="row"><label style="min-width:30px">알파</label><input class="fld" id="cl-a" value="100"><span style="color:#9a9a9a">%</span></div>' +
      '<div class="hint">클릭한 견본은 현재 초점(칠/획)에 적용됩니다. X = 초점 전환, Shift+X = 교체</div>';

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
  var FONTS = [
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
      '<div class="row" style="gap:4px;margin-top:6px">' +
      '<label style="min-width:26px">정렬</label>' +
      '<button class="mini-btn" data-talign="left" title="왼쪽 정렬" style="flex:1">◧</button>' +
      '<button class="mini-btn" data-talign="center" title="가운데 정렬" style="flex:1">◫</button>' +
      '<button class="mini-btn" data-talign="right" title="오른쪽 정렬" style="flex:1">◨</button>' +
      '</div>' +
      '<div class="grid2" style="margin-top:4px">' +
      '<button class="btn" data-cmd="fontBigger" title="글꼴 크기 확대 (' + AI.keymap.display('Ctrl+Shift+.') + ')">크게</button>' +
      '<button class="btn" data-cmd="fontSmaller" title="글꼴 크기 축소 (' + AI.keymap.display('Ctrl+Shift+,') + ')">작게</button>' +
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
    if (!target || (target.type !== 'linear' && target.type !== 'radial')) {
      target = a.fillFocus ? a.fill : a.stroke;
    }
    if ((!target || (target.type !== 'linear' && target.type !== 'radial')) && create) return null;
    return (target && (target.type === 'linear' || target.type === 'radial')) ? target : null;
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

  function buildGradient() {
    var p = document.getElementById('p-gradient');
    p.innerHTML =
      '<div class="row">' +
      '<select class="fld" id="gr-type" style="flex:1"><option value="linear">선형</option><option value="radial">방사형</option></select>' +
      '<label title="각도">∠</label><input class="fld" id="gr-angle" style="width:48px" value="0">' +
      '<button class="mini-btn" id="gr-rev" title="정지점 반전">⇄</button>' +
      '</div>' +
      '<div class="gradbar" id="gr-bar"><div class="gradfill" id="gr-fill"></div><div class="stops" id="gr-stops"></div></div>' +
      '<div class="row" style="margin-top:8px">' +
      '<button class="swatch-btn" id="gr-color" title="선택한 정지점 색상"><i></i></button>' +
      '<label>위치</label><input class="fld" id="gr-pos" style="width:52px" value="0"><span style="color:#9a9a9a">%</span>' +
      '<label>불투명</label><input class="fld" id="gr-alpha" style="width:46px" value="100">' +
      '<button class="mini-btn" id="gr-del" title="정지점 삭제">🗑</button>' +
      '</div>' +
      '<div class="hint">막대를 클릭하면 정지점 추가, 드래그하면 이동합니다. G 도구로 캔버스에서 방향을 그릴 수 있습니다.</div>';

    U.on(U.q('#gr-type', p), 'change', function () { var v = this.value; applyGradient('그레이디언트 유형', function (g) { g.type = v; }); });
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
  function buildStroke() {
    var p = document.getElementById('p-stroke');
    p.innerHTML =
      '<div class="row"><label style="min-width:30px">두께</label><input class="fld" id="sk-w" value="1"><span style="color:#9a9a9a">pt</span></div>' +
      '<div class="row"><label style="min-width:30px">단면</label>' +
      '<button class="mini-btn" data-cap="butt" title="끝 단면">▭</button>' +
      '<button class="mini-btn" data-cap="round" title="둥근 단면">▬</button>' +
      '<button class="mini-btn" data-cap="square" title="돌출 단면">▪</button>' +
      '<label style="min-width:30px;margin-left:6px">모퉁이</label>' +
      '<button class="mini-btn" data-join="miter">◣</button>' +
      '<button class="mini-btn" data-join="round">◜</button>' +
      '<button class="mini-btn" data-join="bevel">◺</button>' +
      '</div>' +
      '<div class="row"><label style="min-width:30px">정렬</label>' +
      '<button class="mini-btn" data-salign="center" title="획을 가운데 정렬" style="flex:1">가운데</button>' +
      '<button class="mini-btn" data-salign="inside" title="획을 안쪽 정렬" style="flex:1">안쪽</button>' +
      '<button class="mini-btn" data-salign="outside" title="획을 바깥쪽 정렬" style="flex:1">바깥쪽</button>' +
      '</div>' +
      '<div class="row"><label style="min-width:30px">점선</label><input class="fld" id="sk-dash" placeholder="예: 4 2"></div>' +
      '<div class="hint">점선은 공백으로 구분해 입력 (비우면 실선).<br>안쪽·바깥쪽 정렬은 닫힌 패스에만 적용됩니다.</div>';

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
  }

  /* ================= 정렬 ================= */
  function buildAlign() {
    var p = document.getElementById('p-align');
    p.innerHTML =
      '<div class="grid6">' +
      '<button class="btn" data-cmd="alignLeft" title="왼쪽 정렬">⇤</button>' +
      '<button class="btn" data-cmd="alignHCenter" title="가로 가운데">⇥⇤</button>' +
      '<button class="btn" data-cmd="alignRight" title="오른쪽 정렬">⇥</button>' +
      '<button class="btn" data-cmd="alignTop" title="위쪽 정렬">⤒</button>' +
      '<button class="btn" data-cmd="alignVCenter" title="세로 가운데">⇕</button>' +
      '<button class="btn" data-cmd="alignBottom" title="아래쪽 정렬">⤓</button>' +
      '</div>' +
      '<div class="grid2" style="margin-top:5px">' +
      '<button class="btn" data-cmd="distH" title="가로 균등 배분">⇹ 가로</button>' +
      '<button class="btn" data-cmd="distV" title="세로 균등 배분">⇳ 세로</button>' +
      '</div>' +
      '<div class="row" style="margin-top:6px"><label style="min-width:42px">기준</label>' +
      '<select class="fld" id="al-to"><option value="selection">선택 영역</option><option value="artboard">대지</option><option value="key">키 오브젝트</option></select></div>';
    U.qa('[data-cmd]', p).forEach(function (b) { U.on(b, 'click', function () { C.run(b.dataset.cmd); }); });
    U.on(U.q('#al-to', p), 'change', function () { app.alignTo = this.value; });
  }

  /* ================= 패스파인더 ================= */
  function buildPathfinder() {
    var p = document.getElementById('p-pathfinder');
    var shape = [['unite', '합치기'], ['minusFront', '앞면 제외'], ['intersect', '교차'], ['exclude', '교차 제외']];
    var conv = [['divide', '나누기'], ['trim', '자르기'], ['merge', '병합'], ['crop', '오리기'], ['outline', '윤곽선'], ['minusBack', '뒷면 제외']];
    p.innerHTML =
      '<div style="color:#9a9a9a;margin-bottom:4px">모양 모드</div>' +
      '<div class="grid4">' + shape.map(function (o) {
        return '<button class="btn" data-pf="' + o[0] + '" title="' + o[1] + '">' + pfIcon(o[0]) + '</button>';
      }).join('') + '</div>' +
      '<div style="color:#9a9a9a;margin:8px 0 4px">패스파인더</div>' +
      '<div class="grid6">' + conv.map(function (o) {
        return '<button class="btn" data-pf="' + o[0] + '" title="' + o[1] + '">' + pfIcon(o[0]) + '</button>';
      }).join('') + '</div>' +
      '<div class="hint">2개 이상의 도형을 선택한 뒤 사용하세요. 곡선은 근사 처리됩니다.</div>';
    U.qa('[data-pf]', p).forEach(function (b) { U.on(b, 'click', function () { C.run('pf_' + b.dataset.pf); }); });
  }

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
    if (a.sel.length && a.sel[0].stroke) w = a.sel[0].stroke.width;
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
    UI.syncTool(a);
    UI.syncSelection(a);
    UI.syncType(a);
    UI.syncGradient(a);
    UI.syncStatus(a);
    UI.updateZoom(a);
    UI.syncIsolation(a);
    UI.buildLayers(a);
  };
})(window.AI);
