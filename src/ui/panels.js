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
    buildColor();
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

  function num(el, get, set, label) {
    U.on(el, 'change', function () {
      if (syncing) return;
      var v = U.parseNum(el.value, get());
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

    num(document.getElementById('ctl-x'), function () { return 0; }, function (v) { E.setBounds(app, v, null, null, null); }, '위치');
    num(document.getElementById('ctl-y'), function () { return 0; }, function (v) { E.setBounds(app, null, v, null, null); }, '위치');
    num(document.getElementById('ctl-w'), function () { return 0; }, function (v) {
      var b = Rn.selectionBounds(app, true);
      var h = app.lockRatio ? R.h(b) * (v / (R.w(b) || 1)) : null;
      E.setBounds(app, null, null, v, h);
    }, '크기');
    num(document.getElementById('ctl-h'), function () { return 0; }, function (v) {
      var b = Rn.selectionBounds(app, true);
      var w = app.lockRatio ? R.w(b) * (v / (R.h(b) || 1)) : null;
      E.setBounds(app, null, null, w, v);
    }, '크기');
    num(document.getElementById('ctl-a'), function () { return 0; }, function (v) {
      if (app.sel.length === 1) {
        var it = app.sel[0];
        var cur = M.angle(Model.worldMatrix(app.doc, it));
        E.rotate(app, v - cur);
      } else E.rotate(app, v);
    }, '회전');

    var lock = document.getElementById('ctl-lockratio');
    U.on(lock, 'click', function () { app.lockRatio = !app.lockRatio; lock.classList.toggle('on', app.lockRatio); });

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
      '<div class="grid2">' +
      '<div class="row"><label>X</label><input class="fld" id="tf-x"></div>' +
      '<div class="row"><label>Y</label><input class="fld" id="tf-y"></div>' +
      '<div class="row"><label>W</label><input class="fld" id="tf-w"></div>' +
      '<div class="row"><label>H</label><input class="fld" id="tf-h"></div>' +
      '<div class="row"><label>∠</label><input class="fld" id="tf-a"></div>' +
      '<div class="row"><label>⌇</label><input class="fld" id="tf-s" value="0"></div>' +
      '</div>' +
      '<div class="grid2" style="margin-top:4px">' +
      '<button class="btn" data-cmd="reflectH">가로 반사</button>' +
      '<button class="btn" data-cmd="reflectV">세로 반사</button>' +
      '</div>';
    num(U.q('#tf-x', p), function () { return 0; }, function (v) { E.setBounds(app, v, null, null, null); }, '위치');
    num(U.q('#tf-y', p), function () { return 0; }, function (v) { E.setBounds(app, null, v, null, null); }, '위치');
    num(U.q('#tf-w', p), function () { return 0; }, function (v) {
      var b = Rn.selectionBounds(app, true);
      E.setBounds(app, null, null, v, app.lockRatio ? R.h(b) * (v / (R.w(b) || 1)) : null);
    }, '크기');
    num(U.q('#tf-h', p), function () { return 0; }, function (v) {
      var b = Rn.selectionBounds(app, true);
      E.setBounds(app, null, null, app.lockRatio ? R.w(b) * (v / (R.h(b) || 1)) : null, v);
    }, '크기');
    num(U.q('#tf-a', p), function () { return 0; }, function (v) {
      if (app.sel.length === 1) {
        var cur = M.angle(Model.worldMatrix(app.doc, app.sel[0]));
        E.rotate(app, v - cur);
      } else E.rotate(app, v);
    }, '회전');
    num(U.q('#tf-s', p), function () { return 0; }, function (v) { E.shear(app, v, 0); }, '기울이기');
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
      '<div class="row"><label style="min-width:30px">점선</label><input class="fld" id="sk-dash" placeholder="예: 4 2"></div>' +
      '<div class="hint">점선은 공백으로 구분해 입력 (비우면 실선)</div>';

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

  /* ================= 동기화 ================= */
  UI.syncTool = function (a) {
    U.qa('#toolbar .tool').forEach(function (el) { el.classList.toggle('active', el.dataset.tool === a.tool); });
    var t = T.current(a);
    var n = document.getElementById('ctl-toolname');
    if (n && t) n.textContent = t.name.replace(' 도구', '');
    var h = document.getElementById('st-hint');
    if (h && t) h.textContent = t.name;
  };

  UI.updateZoom = function (a) {
    var z = document.getElementById('st-zoom');
    if (z && document.activeElement !== z) z.value = U.round(a.view.scale * 100, 2) + '%';
  };

  UI.syncStatus = function (a) {
    var ab = a.doc.artboards[a.doc.activeArtboard];
    var el = document.getElementById('st-artboard');
    if (el && ab) el.textContent = ab.name;
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
      vals.x = U.fmt(b.x); vals.y = U.fmt(b.y);
      vals.w = U.fmt(R.w(b)); vals.h = U.fmt(R.h(b));
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
    syncing = false;
    UI.syncStyle(a);
  };

  UI.syncAll = function (a) {
    UI.syncTool(a);
    UI.syncSelection(a);
    UI.syncStatus(a);
    UI.updateZoom(a);
    UI.buildLayers(a);
  };
})(window.AI);
