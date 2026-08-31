/* =========================================================================
   ui/dialogs.js — Illustrator 대화상자 모음
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, M = AI.mat, R = AI.rect, Model = AI.model, E = AI.edit, Rn = AI.render, D = AI.dialog;
  var Dlg = AI.dialogs = {};

  function refPoint(b, idx) {
    var xs = [b.x, (b.x + b.x2) / 2, b.x2], ys = [b.y, (b.y + b.y2) / 2, b.y2];
    return { x: xs[idx % 3], y: ys[Math.floor(idx / 3)] };
  }
  Dlg.refPoint = refPoint;

  /* ---------- 변형 대화상자 공통 ---------- */
  function transformDialog(app, cfg) {
    if (!app.sel.length) { U.toast('오브젝트를 먼저 선택하세요'); return; }
    var sel = app.sel.slice();
    var snap = sel.map(function (it) { return it.m.slice(); });
    var strokeSnap = [];
    Model.walkWorld(app.doc, function (it) {
      if (it.stroke && sel.some(function (s) { return s === it || contains(s, it); })) {
        strokeSnap.push({ it: it, w: it.stroke.width });
      }
    });
    function contains(parent, it) {
      if (parent.type !== 'group') return false;
      var found = false;
      (function rec(g) { g.children.forEach(function (c) { if (c === it) found = true; else if (c.type === 'group') rec(c); }); })(parent);
      return found;
    }
    function restore() {
      for (var i = 0; i < sel.length; i++) sel[i].m = snap[i].slice();
      strokeSnap.forEach(function (o) { o.it.stroke.width = o.w; });
    }

    var api = D.open({
      title: cfg.title,
      fields: cfg.fields,
      buttons: [{ id: 'copy', label: '복사' }, { id: 'cancel', label: '취소' }, { id: 'ok', label: '확인', primary: true }],
      onChange: function (v, changed, a) {
        if (cfg.onChange) cfg.onChange(v, changed, a);
        restore();
        if (v.preview !== false) {
          apply(v);
          app.invalidate();
          AI.ui.syncSelection(app);
        } else app.invalidate();
      },
      onDone: function (v, btn) {
        restore();
        app.history.begin(cfg.title, app.doc);
        if (btn === 'copy') E.duplicate(app, 0, 0);
        apply(v);
        app.lastTransform = cfg.matrix(v, bounds());
        app.history.commit();
        app.invalidate();
        AI.ui.syncAll(app);
      },
      onCancel: function () { restore(); app.invalidate(); AI.ui.syncAll(app); }
    });

    function bounds() { return Rn.selectionBounds(app, true); }
    function apply(v) {
      var b = bounds();
      if (R.isEmpty(b)) return;
      var W = cfg.matrix(v, b);
      E.transformSelection(app, W);
      if (v.scaleStrokes) {
        var k = Math.sqrt(Math.abs(W[0] * W[3] - W[1] * W[2])) || 1;
        strokeSnap.forEach(function (o) { o.it.stroke.width = o.w * k; });
      }
    }
    return api;
  }

  /* ---------- 이동 ---------- */
  Dlg.move = function (app) {
    transformDialog(app, {
      title: '이동',
      fields: [
        { id: 'x', label: '가로', type: 'num', value: 0, unit: 'pt' },
        { id: 'y', label: '세로', type: 'num', value: 0, unit: 'pt' },
        { type: 'sep' },
        { id: 'dist', label: '거리', type: 'num', value: 0, unit: 'pt' },
        { id: 'angle', label: '각도', type: 'num', value: 0, unit: '°' },
        { type: 'sep' },
        { id: 'preview', label: '미리 보기', type: 'check', value: true }
      ],
      onChange: function (v, changed, a) {
        if (changed === 'x' || changed === 'y') {
          a.set('dist', Math.hypot(v.x, v.y));
          a.set('angle', U.round(U.deg(Math.atan2(-v.y, v.x)), 2));
        } else if (changed === 'dist' || changed === 'angle') {
          var r = U.rad(v.angle);
          a.set('x', Math.cos(r) * v.dist);
          a.set('y', -Math.sin(r) * v.dist);
        }
      },
      matrix: function (v) { return M.translate(v.x, v.y); }
    });
  };

  /* ---------- 회전 ---------- */
  Dlg.rotate = function (app) {
    transformDialog(app, {
      title: '회전',
      fields: [
        { id: 'ref', label: '기준점', type: 'ref', value: 4 },
        { id: 'angle', label: '각도', type: 'num', value: 0, unit: '°' },
        { type: 'sep' },
        { id: 'preview', label: '미리 보기', type: 'check', value: true }
      ],
      matrix: function (v, b) {
        var o = refPoint(b, v.ref);
        return M.around(M.rotate(U.rad(-v.angle)), o.x, o.y);
      }
    });
  };

  /* ---------- 크기 조절 ---------- */
  Dlg.scale = function (app) {
    transformDialog(app, {
      title: '크기 조절',
      fields: [
        { id: 'ref', label: '기준점', type: 'ref', value: 4 },
        { id: 'mode', label: '', type: 'radio', value: 'uniform', options: [['uniform', '균일'], ['nonuniform', '비균일']] },
        { id: 'uni', label: '비율', type: 'num', value: 100, unit: '%' },
        { id: 'sx', label: '가로', type: 'num', value: 100, unit: '%' },
        { id: 'sy', label: '세로', type: 'num', value: 100, unit: '%' },
        { type: 'sep' },
        { id: 'autoSave', label: '복구 정보 자동 저장', type: 'check', value: app.prefs.autoSave !== false },
        { id: 'autoSaveMin', label: '자동 저장 간격', type: 'select', width: 110,
          value: String(app.prefs.autoSaveMin || AI.autosave.DEFAULT_MIN),
          options: [['1', '1분'], ['2', '2분'], ['5', '5분'], ['10', '10분'], ['15', '15분'], ['30', '30분']] },
        { type: 'sep' },
        { id: 'scaleStrokes', label: '획 두께와 효과 크기 조절', type: 'check', value: !!app.prefs.scaleStrokes },
        { id: 'preview', label: '미리 보기', type: 'check', value: true }
      ],
      matrix: function (v, b) {
        var o = refPoint(b, v.ref);
        var sx = (v.mode === 'uniform' ? v.uni : v.sx) / 100;
        var sy = (v.mode === 'uniform' ? v.uni : v.sy) / 100;
        return M.around(M.scale(sx || 0.0001, sy || 0.0001), o.x, o.y);
      }
    });
  };

  /* ---------- 반사 ---------- */
  Dlg.reflect = function (app) {
    transformDialog(app, {
      title: '반사',
      fields: [
        { id: 'ref', label: '기준점', type: 'ref', value: 4 },
        { id: 'axis', label: '축', type: 'radio', value: 'v', options: [['h', '가로'], ['v', '세로'], ['angle', '각도']] },
        { id: 'angle', label: '각도', type: 'num', value: 0, unit: '°' },
        { type: 'sep' },
        { id: 'preview', label: '미리 보기', type: 'check', value: true }
      ],
      matrix: function (v, b) {
        var o = refPoint(b, v.ref);
        var a = v.axis === 'h' ? 0 : v.axis === 'v' ? Math.PI / 2 : U.rad(-v.angle);
        return M.mulAll(M.translate(o.x, o.y), M.rotate(a), M.scale(1, -1), M.rotate(-a), M.translate(-o.x, -o.y));
      }
    });
  };

  /* ---------- 기울이기 ---------- */
  Dlg.shear = function (app) {
    transformDialog(app, {
      title: '기울이기',
      fields: [
        { id: 'ref', label: '기준점', type: 'ref', value: 4 },
        { id: 'angle', label: '기울기 각도', type: 'num', value: 0, unit: '°' },
        { id: 'axis', label: '축', type: 'radio', value: 'h', options: [['h', '가로'], ['v', '세로']] },
        { type: 'sep' },
        { id: 'preview', label: '미리 보기', type: 'check', value: true }
      ],
      matrix: function (v, b) {
        var o = refPoint(b, v.ref);
        var t = U.rad(U.clamp(v.angle, -89, 89));
        return M.around(v.axis === 'h' ? M.skew(t, 0) : M.skew(0, t), o.x, o.y);
      }
    });
  };

  /* ---------- 새 문서 ---------- */
  var PRESETS = {
    a4: [595.28, 841.89], a3: [841.89, 1190.55], letter: [612, 792],
    fhd: [1920, 1080], hd: [1280, 720], square: [1080, 1080],
    web: [1440, 900], mobile: [390, 844]
  };
  Dlg.newDocument = function (app) {
    D.open({
      title: '새 문서',
      fields: [
        { id: 'name', label: '이름', type: 'text', value: '무제-1', width: 150 },
        { id: 'preset', label: '사전 설정', type: 'select', value: 'a4', width: 150, options: [
          ['a4', 'A4 (595 × 842)'], ['a3', 'A3 (842 × 1191)'], ['letter', 'Letter (612 × 792)'],
          ['fhd', 'Full HD (1920 × 1080)'], ['hd', 'HD (1280 × 720)'], ['square', '정사각 (1080 × 1080)'],
          ['web', '웹 (1440 × 900)'], ['mobile', '모바일 (390 × 844)'], ['custom', '사용자 정의']
        ] },
        { id: 'w', label: '폭', type: 'num', value: 595.28, unit: 'pt' },
        { id: 'h', label: '높이', type: 'num', value: 841.89, unit: 'pt' },
        { id: 'orient', label: '방향', type: 'radio', value: 'p', options: [['p', '세로'], ['l', '가로']] },
        { type: 'sep' },
        { id: 'bg', label: '배경', type: 'select', value: '#ffffff', width: 110, options: [['#ffffff', '흰색'], ['#f5f5f5', '연회색'], ['#000000', '검정']] }
      ],
      onChange: function (v, changed, a) {
        if (changed === 'preset' && PRESETS[v.preset]) {
          var p = PRESETS[v.preset];
          a.set('w', p[0]); a.set('h', p[1]);
          a.set('orient', p[0] > p[1] ? 'l' : 'p');
        } else if (changed === 'orient') {
          if ((v.orient === 'l') !== (v.w > v.h)) { a.set('w', v.h); a.set('h', v.w); }
        } else if (changed === 'w' || changed === 'h') {
          a.set('preset', 'custom');
        }
      },
      onDone: function (v) {
        var doc = Model.newDoc(Math.max(1, v.w), Math.max(1, v.h));
        doc.name = v.name || '무제-1';
        doc.bg = v.bg;
        doc.artboards[0].name = '대지 1';
        /* 일러스트레이터처럼 새 문서는 새 탭으로 열린다 */
        AI.docs.add(app, doc, { label: '새 문서' });
        U.toast('새 문서 ' + U.round(v.w) + ' × ' + U.round(v.h));
      }
    });
  };

  /* ---------- 문서 설정 ---------- */
  Dlg.documentSetup = function (app) {
    var ab = app.doc.artboards[app.doc.activeArtboard];
    D.open({
      title: '문서 설정',
      fields: [
        { id: 'name', label: '대지 이름', type: 'text', value: ab.name, width: 150 },
        { id: 'w', label: '폭', type: 'num', value: ab.w, unit: 'pt' },
        { id: 'h', label: '높이', type: 'num', value: ab.h, unit: 'pt' },
        { id: 'bg', label: '배경', type: 'select', value: app.doc.bg || '#ffffff', width: 110,
          options: [['#ffffff', '흰색'], ['#f5f5f5', '연회색'], ['#1e1e1e', '어두운 회색'], ['#000000', '검정']] },
        { type: 'sep' },
        { id: 'unit', label: '단위', type: 'select', value: app.prefs.unit || 'pt', width: 110,
          options: [['pt', '포인트'], ['px', '픽셀'], ['mm', '밀리미터'], ['cm', '센티미터'], ['in', '인치']] }
      ],
      onDone: function (v) {
        app.history.begin('문서 설정', app.doc);
        ab.name = v.name || ab.name;
        ab.w = Math.max(1, v.w); ab.h = Math.max(1, v.h);
        app.doc.width = ab.w; app.doc.height = ab.h;
        app.doc.bg = v.bg;
        app.prefs.unit = v.unit;
        app.history.commit();
        app.invalidate();
        AI.ui.syncAll(app);
      }
    });
  };

  /* ---------- 도형 옵션 ---------- */
  var SHAPE_DEF = {
    rect: { title: '사각형', fields: function (o) { return [
      { id: 'w', label: '폭', type: 'num', value: o.w || 100, unit: 'pt' },
      { id: 'h', label: '높이', type: 'num', value: o.h || 100, unit: 'pt' },
      { id: 'r', label: '모퉁이 반경', type: 'num', value: o.r || 0, unit: 'pt' }
    ]; } },
    roundrect: { title: '둥근 사각형', fields: function (o) { return [
      { id: 'w', label: '폭', type: 'num', value: o.w || 100, unit: 'pt' },
      { id: 'h', label: '높이', type: 'num', value: o.h || 100, unit: 'pt' },
      { id: 'r', label: '모퉁이 반경', type: 'num', value: o.r == null ? 12 : o.r, unit: 'pt' }
    ]; } },
    ellipse: { title: '타원', fields: function (o) { return [
      { id: 'w', label: '폭', type: 'num', value: o.w || 100, unit: 'pt' },
      { id: 'h', label: '높이', type: 'num', value: o.h || 100, unit: 'pt' },
      { type: 'sep' },
      { id: 'pieStart', label: '파이 시작 각도', type: 'num', value: o.pieStart || 0, unit: '°' },
      { id: 'pieEnd', label: '파이 끝 각도', type: 'num', value: o.pieEnd == null ? 360 : o.pieEnd, unit: '°' }
    ]; } },
    polygon: { title: '다각형', fields: function (o) { return [
      { id: 'rad', label: '반경', type: 'num', value: o.rad || 50, unit: 'pt' },
      { id: 'n', label: '변', type: 'num', value: o.n || 6, step: 1 }
    ]; } },
    star: { title: '별모양', fields: function (o) { return [
      { id: 'r1', label: '반경 1', type: 'num', value: o.r1 || 50, unit: 'pt' },
      { id: 'r2', label: '반경 2', type: 'num', value: o.r2 || 25, unit: 'pt' },
      { id: 'n', label: '점', type: 'num', value: o.n || 5, step: 1 }
    ]; } },
    line: { title: '선분 도구 옵션', fields: function (o) { return [
      { id: 'len', label: '길이', type: 'num', value: o.len || 100, unit: 'pt' },
      { id: 'angle', label: '각도', type: 'num', value: o.angle || 0, unit: '°' }
    ]; } }
  };

  /* 도형 도구로 클릭했을 때 / 도구를 더블클릭했을 때 */
  Dlg.shapeOptions = function (app, kind, at) {
    var def = SHAPE_DEF[kind];
    if (!def) return;
    app.shapeOpts = app.shapeOpts || {};
    var o = app.shapeOpts[kind] = app.shapeOpts[kind] || {};
    var stored = {
      w: o.lastW, h: o.lastH, r: o.r,
      rad: o.lastRad, n: o.n, r1: o.lastRad, r2: o.lastRad2,
      len: o.lastLen, angle: o.lastAngle,
      pieStart: o.pieStart, pieEnd: o.pieEnd
    };
    D.open({
      title: def.title,
      fields: def.fields(stored),
      onDone: function (v) {
        var it = null, T = AI.tools;
        if (kind === 'rect' || kind === 'roundrect') {
          o.lastW = v.w; o.lastH = v.h; o.r = v.r;
          it = Model.newRect(at.x - v.w / 2, at.y - v.h / 2, v.w, v.h, v.r);
        } else if (kind === 'ellipse') {
          o.lastW = v.w; o.lastH = v.h;
          o.pieStart = v.pieStart; o.pieEnd = v.pieEnd;
          it = Model.newEllipse(at.x - v.w / 2, at.y - v.h / 2, v.w, v.h);
          if (Math.abs((((v.pieEnd - v.pieStart) % 360) + 360) % 360) > 0.001) {
            it.shape.pie = { start: v.pieStart, end: v.pieEnd };
            it.name = '파이';
            Model.buildShape(it);
          }
        } else if (kind === 'polygon') {
          o.lastRad = v.rad; o.n = Math.max(3, Math.round(v.n));
          it = Model.newPolygon(at.x, at.y, v.rad, o.n);
        } else if (kind === 'star') {
          o.lastRad = v.r1; o.lastRad2 = v.r2; o.n = Math.max(3, Math.round(v.n));
          o.ratio = v.r1 ? v.r2 / v.r1 : 0.5;
          it = Model.newStar(at.x, at.y, v.r1, v.r2, o.n);
        } else if (kind === 'line') {
          o.lastLen = v.len; o.lastAngle = v.angle;
          var r = U.rad(-v.angle);
          it = Model.newLine(at.x, at.y, at.x + Math.cos(r) * v.len, at.y + Math.sin(r) * v.len);
        }
        if (!it) return;
        app.history.begin(def.title, app.doc);
        T.applyCurrentStyle(app, it, kind === 'line');
        if (kind === 'line') it.fill = AI.color.none();
        Model.activeLayer(app.doc).children.push(it);
        AI.sel.set(app, [it]);
        app.history.commit();
        app.invalidate();
        AI.ui.syncAll(app);
      }
    });
  };

  /* ---------- PNG 내보내기 ---------- */
  Dlg.exportPNG = function (app, run) {
    var ab = app.doc.artboards[app.doc.activeArtboard];
    D.open({
      title: 'PNG로 내보내기',
      fields: [
        { id: 'scale', label: '배율', type: 'select', value: '2', width: 110,
          options: [['0.5', '0.5× (50%)'], ['1', '1× (100%)'], ['2', '2× (200%)'], ['3', '3× (300%)'], ['4', '4× (400%)']] },
        { id: 'bg', label: '배경', type: 'radio', value: 'white', options: [['white', '대지 색상'], ['transparent', '투명']] },
        { type: 'sep' },
        { id: 'info', label: '출력 크기: ' + Math.round(ab.w * 2) + ' × ' + Math.round(ab.h * 2) + ' px', type: 'info' }
      ],
      onChange: function (v, changed, a) {
        var el = document.querySelector('.dlg-info');
        if (el) el.textContent = '출력 크기: ' + Math.round(ab.w * +v.scale) + ' × ' + Math.round(ab.h * +v.scale) + ' px';
      },
      onDone: function (v) { run(+v.scale, v.bg !== 'transparent'); }
    });
  };

  /* ---------- 단축키 목록 ----------
     브라우저가 가져가는 키를 숨기지 않고 그대로 보여 주고, 대신 쓸 키를 옆에 적는다. */
  Dlg.shortcuts = function (app) {
    var K = AI.keymap;
    var rows = K.audit();
    var clash = rows.filter(function (r) { return r.reserved; });

    function kbd(k) { return '<kbd>' + U.esc(K.pretty(k)) + '</kbd>'; }
    function row(r) {
      if (!r.reserved) {
        return '<tr><td>' + U.esc(r.label) + '</td><td>' + kbd(r.key) + '</td><td></td></tr>';
      }
      return '<tr class="conflict"><td>' + U.esc(r.label) + '</td>' +
        '<td>' + kbd(r.key) + (r.alternate ? ' <span class="alt">' + kbd(r.alternate) + '</span>' : '') + '</td>' +
        '<td class="why">브라우저가 "' + U.esc(r.reserved) + '" 로 가져감' +
        (r.alternate ? ' — 파란 키를 쓰세요' : '') + '</td></tr>';
    }
    function table(cap, list) {
      if (!list.length) return '';
      return '<table class="keys"><caption>' + U.esc(cap) + '</caption><thead><tr>' +
        '<th>명령</th><th>단축키</th><th>비고</th></tr></thead><tbody>' +
        list.map(row).join('') + '</tbody></table>';
    }
    /* 물어본 것부터 보여 준다 — 충돌하는 것을 위로 올린다 */
    var body = table('브라우저와 겹치는 단축키 (' + clash.length + ')', clash) +
      table('그 밖의 단축키 (' + (rows.length - clash.length) + ')',
        rows.filter(function (r) { return !r.reserved; }));

    var head = K.locked
      ? '키보드 잠금이 켜져 있어 모든 단축키가 앱으로 들어옵니다.'
      : clash.length
        ? clash.length + '개 단축키를 브라우저가 가져갑니다. [보기 > 단축키 완전 사용] 을 켜면 전부 앱이 받습니다.'
        : '모든 단축키를 앱이 그대로 받습니다.';

    D.open({
      title: '단축키',
      fields: [
        { id: 'i', type: 'info', label: head },
        { id: 'tbl', type: 'html', html: body },
        { id: 'i2', type: 'info',
          label: K.standalone() ? '앱 창으로 실행 중 — 탭 단축키(숫자 · N · W · Tab)가 풀려 있습니다.'
            : '앱으로 설치해 탭 없는 창으로 띄우면 이 충돌이 모두 사라집니다.' +
              (AI.pwa.reason() ? ' (' + AI.pwa.reason() + ')' : '') }
      ],
      buttons: [
        AI.pwa.canInstall() ? { id: 'install', label: '앱으로 설치' } : null,
        K.canLock() ? { id: 'lock', label: K.locked ? '잠금 해제' : '단축키 완전 사용' } : null,
        { id: 'ok', label: '닫기', primary: true }
      ].filter(Boolean),
      onDone: function (v, btn) {
        if (btn === 'lock') K.toggleLock(app);
        else if (btn === 'install') AI.pwa.install();
      }
    });
  };

  /* ---------- 모퉁이 (라이브 코너) ---------- */
  Dlg.corners = function (app, it, targets) {
    var Model = AI.model, E = AI.edit;
    it = it || (app.sel.length === 1 ? app.sel[0] : null);
    if (!it || it.type !== 'path' || !it.shape || it.shape.kind !== 'rect') {
      U.toast('라이브 사각형을 선택하세요');
      return;
    }
    var sh = it.shape;
    targets = (targets && targets.length) ? targets : [0, 1, 2, 3];
    var rs = Model.rectRadii(sh), kinds = Model.rectCornerKinds(sh);
    var lim = Math.min(Math.abs(sh.w), Math.abs(sh.h)) / 2;

    /* 고른 모퉁이들의 지금 값 — 서로 다르면 첫 값을 보여 준다 */
    var r0 = rs[targets[0]], k0 = kinds[targets[0]];
    /* 고른 모퉁이끼리 다른가 — 값 칸에 무엇을 보일지 정한다 */
    var mixedR = targets.some(function (i) { return Math.abs(rs[i] - r0) > 1e-6; });
    var mixedK = targets.some(function (i) { return kinds[i] !== k0; });
    /* 도형 전체가 고른가 — 고르지 않으면 지금 상태를 적어 준다 */
    var uneven = rs.some(function (v) { return Math.abs(v - rs[0]) > 1e-6; }) ||
      kinds.some(function (k) { return k !== kinds[0]; });
    var NAMES = ['좌상', '우상', '우하', '좌하'];

    var before = { r: sh.r, rs: sh.rs && sh.rs.slice(), c: sh.c, cs: sh.cs && sh.cs.slice() };
    function restore() {
      sh.r = before.r;
      if (before.rs) sh.rs = before.rs.slice(); else delete sh.rs;
      if (before.c) sh.c = before.c; else delete sh.c;
      if (before.cs) sh.cs = before.cs.slice(); else delete sh.cs;
      Model.buildShape(it);
      app.invalidate();
    }
    function preview(v) {
      restore();
      var t = v.all ? [0, 1, 2, 3] : targets;
      E.setCornerKind(it, t, v.kind);
      E.setCornerRadius(it, t, Math.max(0, +v.radius || 0));
      app.invalidate();
    }

    D.open({
      title: '모퉁이',
      fields: [
        { id: 'kind', label: '종류', type: 'radio', value: mixedK ? 'round' : k0,
          options: Model.CORNER_KINDS.map(function (k) { return [k, Model.CORNER_LABEL[k]]; }) },
        { id: 'radius', label: '반경', type: 'num', unit: 'pt', min: 0, max: Math.round(lim * 100) / 100,
          value: U.round(r0, 2) },
        { type: 'sep' },
        { id: 'all', label: '네 모퉁이 모두', type: 'check', value: targets.length === 4 },
        { id: 'info', type: 'info',
          label: (targets.length === 4 ? '' :
            '고른 모퉁이: ' + targets.map(function (i) { return NAMES[i]; }).join(' · ') +
            ' — 끄면 이 모퉁이만 바뀝니다. ') +
            (uneven ? '지금은 모퉁이마다 다릅니다 (' +
              rs.map(function (v, i) {
                return NAMES[i] + ' ' + U.fmt(v) +
                  (kinds[i] === 'round' ? '' : ' ' + Model.CORNER_LABEL[kinds[i]]);
              }).join(' · ') + '). ' : '') +
            '최대 반경 ' + U.fmt(lim) + 'pt' }
      ],
      /* 열자마자 오는 첫 호출(id 없음)에는 손대지 않는다 — 값이 섞여 있으면
         보이는 값 하나로 네 모퉁이를 덮어써 버린다 */
      onChange: function (v, id) { if (id != null) preview(v); },
      onDone: function (v) {
        restore();
        app.history.begin('모퉁이', app.doc);
        var t = v.all ? [0, 1, 2, 3] : targets;
        E.setCornerKind(it, t, v.kind);
        E.setCornerRadius(it, t, Math.max(0, +v.radius || 0));
        app.history.commit();
        app.invalidate();
        AI.ui.syncAll(app);
      },
      onCancel: restore
    });
  };

  /* ---------- 문자 · 단락 스타일 옵션 ---------- */
  Dlg.styleOptions = function (app, kind, st) {
    var ST = AI.styles;
    if (!st) { U.toast('스타일을 선택하세요'); return; }
    var a0 = st.attrs || {};
    var fields = [{ id: 'name', label: '스타일 이름', type: 'text', value: st.name, width: 160 }, { type: 'sep' }];
    if (kind === 'char') {
      fields.push(
        { id: 'family', label: '글꼴', type: 'select', width: 160,
          value: a0.family || 'Noto Sans KR, sans-serif',
          options: (AI.ui.FONTS || []).map(function (f) { return [f[0], f[1]]; }) },
        { id: 'size', label: '크기', type: 'num', value: a0.size == null ? 24 : a0.size, unit: 'pt' },
        { id: 'weight', label: '두께', type: 'select', width: 110, value: String(a0.weight || 400),
          options: [['300', 'Light'], ['400', 'Regular'], ['500', 'Medium'], ['700', 'Bold'], ['900', 'Black']] },
        { id: 'italic', label: '기울임', type: 'check', value: !!a0.italic },
        { id: 'tracking', label: '자간', type: 'num', value: a0.tracking || 0, unit: 'px' }
      );
    } else {
      fields.push(
        { id: 'leading', label: '행간 (배수)', type: 'num', value: a0.leading == null ? 1.2 : a0.leading, step: 0.1 },
        { id: 'align', label: '정렬', type: 'radio', value: a0.align || 'left',
          options: [['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']] }
      );
    }
    fields.push({ type: 'sep' },
      { id: 'info', type: 'info',
        label: '이 스타일을 쓰는 텍스트 ' + ST.textsUsing(app.doc, kind, st.id).length + '개에 곧바로 반영됩니다.' });

    D.open({
      title: ST.LABEL[kind] + ' 옵션',
      fields: fields,
      onDone: function (v) {
        app.history.begin(ST.LABEL[kind] + ' 옵션', app.doc);
        st.name = (v.name || st.name).trim() || st.name;
        if (kind === 'char') {
          st.attrs = {
            family: v.family, size: U.clamp(v.size, 1, 1200),
            weight: +v.weight || 400, italic: !!v.italic, tracking: v.tracking
          };
        } else {
          st.attrs = { leading: U.clamp(v.leading, 0.2, 10), align: v.align };
        }
        var n = ST.sync(app.doc, kind, st);
        app.history.commit();
        app.invalidate();
        AI.ui.syncAll(app);
        U.toast('"' + st.name + '" — ' + n + '개 텍스트에 반영');
      }
    });
  };

  /* ---------- 대지별 내보내기 ---------- */
  Dlg.exportArtboards = function (app, format, run) {
    var n = app.doc.artboards.length;
    function count(v) {
      if (v.which === 'current') return 1;
      if (v.which === 'range') return AI.io.parseRange(v.range, n).length;
      return n;
    }
    function sizeText(v) {
      var ab = app.doc.artboards[app.doc.activeArtboard];
      var c = count(v);
      var px = v.format === 'png'
        ? ' · 활성 대지 ' + Math.round(ab.w * +v.scale) + ' × ' + Math.round(ab.h * +v.scale) + ' px'
        : '';
      return c ? c + '개 파일' + px : '내보낼 대지 없음 — 범위를 확인하세요';
    }

    D.open({
      title: '대지별 내보내기',
      fields: [
        { id: 'format', label: '형식', type: 'select', value: format || 'png', width: 110,
          options: [['png', 'PNG'], ['svg', 'SVG'], ['pdf', 'PDF']] },
        { type: 'sep' },
        { id: 'which', label: '대지', type: 'radio', value: 'all',
          options: [['all', '모두 (' + n + '개)'], ['current', '현재 대지'], ['range', '범위']] },
        { id: 'range', label: '범위', type: 'text', value: '1-' + n, width: 130 },
        { type: 'sep' },
        { id: 'scale', label: '배율 (PNG)', type: 'select', value: '2', width: 110,
          options: [['0.5', '0.5× (50%)'], ['1', '1× (100%)'], ['2', '2× (200%)'], ['3', '3× (300%)'], ['4', '4× (400%)']] },
        { id: 'background', label: '대지 배경 포함', type: 'check', value: true },
        { type: 'sep' },
        { id: 'info', label: '', type: 'info' }
      ],
      onChange: function (v) {
        var el = document.querySelector('.dlg-info');
        if (el) el.textContent = sizeText(v);
      },
      onDone: function (v) {
        run({
          format: v.format, which: v.which, range: v.range,
          scale: +v.scale || 1, background: v.background !== false
        });
      }
    });
    /* 처음 열릴 때의 안내 문구 */
    var el = document.querySelector('.dlg-info');
    if (el) el.textContent = sizeText({ which: 'all', format: format || 'png', scale: '2' });
  };

  /* ---------- 평균점 연결 ---------- */
  Dlg.average = function (app, run) {
    D.open({
      title: '평균',
      fields: [{ id: 'axis', label: '축', type: 'radio', value: 'both', options: [['h', '가로'], ['v', '세로'], ['both', '양쪽 모두']] }],
      onDone: function (v) { run(v.axis); }
    });
  };

  /* ---------- 환경 설정 ---------- */
  Dlg.preferences = function (app) {
    D.open({
      title: '환경 설정',
      fields: [
        { id: 'inc', label: '키보드 증감', type: 'num', value: app.prefs.keyIncrement || 1, unit: 'pt' },
        { id: 'tol', label: '선택 허용 범위', type: 'num', value: AI.hit.TOL, unit: 'px' },
        { id: 'corner', label: '모퉁이 반경 기본값', type: 'num', value: (app.shapeOpts && app.shapeOpts.roundrect && app.shapeOpts.roundrect.r) || 12, unit: 'pt' },
        { type: 'sep' },
        { id: 'gridSize', label: '격자 간격', type: 'num', value: app.prefs.gridSize || 72, unit: 'pt' },
        { id: 'gridDiv', label: '격자 분할', type: 'num', value: app.prefs.gridDiv || 8, step: 1 },
        { type: 'sep' },
        { id: 'scaleStrokes', label: '획 두께와 효과 크기 조절', type: 'check', value: !!app.prefs.scaleStrokes },
        { id: 'smart', label: '고급 안내선 사용', type: 'check', value: app.prefs.smart !== false },
        { id: 'previewBounds', label: '미리보기 경계 사용 (획 포함)', type: 'check', value: !!app.prefs.previewBounds },
        { id: 'centerPoint', label: '중심점 표시', type: 'check', value: !!app.prefs.centerPoint }
      ],
      onDone: function (v) {
        app.prefs.keyIncrement = U.clamp(v.inc, 0.01, 1000);
        AI.hit.TOL = U.clamp(v.tol, 1, 20);
        app.shapeOpts = app.shapeOpts || {};
        app.shapeOpts.roundrect = app.shapeOpts.roundrect || {};
        app.shapeOpts.roundrect.r = Math.max(0, v.corner);
        app.prefs.gridSize = U.clamp(v.gridSize, 1, 10000);
        app.prefs.gridDiv = U.clamp(Math.round(v.gridDiv), 1, 100);
        app.prefs.autoSave = v.autoSave;
        app.prefs.autoSaveMin = Math.max(1, +v.autoSaveMin || AI.autosave.DEFAULT_MIN);
        AI.autosave.restart(app);
        app.prefs.scaleStrokes = v.scaleStrokes;
        app.prefs.smart = v.smart;
        app.prefs.previewBounds = v.previewBounds;
        app.prefs.centerPoint = v.centerPoint;
        app.invalidate();
        AI.ui.syncAll(app);
        U.toast('환경 설정 적용됨');
      }
    });
  };

  /* ---------- 개별 변형 (Transform Each) ---------- */
  Dlg.transformEach = function (app) {
    if (!app.sel.length) { U.toast('오브젝트를 먼저 선택하세요'); return; }
    var sel = app.sel.slice();
    var snap = sel.map(function (it) { return it.m.slice(); });
    function restore() { for (var i = 0; i < sel.length; i++) sel[i].m = snap[i].slice(); }

    D.open({
      title: '개별 변형',
      fields: [
        { id: 'info1', label: '비율 조절', type: 'info' },
        { id: 'sx', label: '가로', type: 'num', value: 100, unit: '%' },
        { id: 'sy', label: '세로', type: 'num', value: 100, unit: '%' },
        { type: 'sep' },
        { id: 'info2', label: '이동', type: 'info' },
        { id: 'dx', label: '가로', type: 'num', value: 0, unit: 'pt' },
        { id: 'dy', label: '세로', type: 'num', value: 0, unit: 'pt' },
        { type: 'sep' },
        { id: 'angle', label: '각도', type: 'num', value: 0, unit: '°' },
        { id: 'anchor', label: '기준점', type: 'ref', value: 4 },
        { type: 'sep' },
        { id: 'reflectX', label: 'X 반사', type: 'check', value: false },
        { id: 'reflectY', label: 'Y 반사', type: 'check', value: false },
        { id: 'random', label: '임의', type: 'check', value: false },
        { id: 'preview', label: '미리 보기', type: 'check', value: true }
      ],
      buttons: [{ id: 'copy', label: '복사' }, { id: 'cancel', label: '취소' }, { id: 'ok', label: '확인', primary: true }],
      onChange: function (v) {
        restore();
        if (v.preview !== false) E.transformEach(app, v);
        app.invalidate();
        AI.ui.syncSelection(app);
      },
      onDone: function (v, btn) {
        restore();
        app.history.begin('개별 변형', app.doc);
        if (btn === 'copy') E.duplicate(app, 0, 0);
        E.transformEach(app, v);
        app.history.commit();
        app.invalidate();
        AI.ui.syncAll(app);
      },
      onCancel: function () { restore(); app.invalidate(); AI.ui.syncAll(app); }
    });
  };

  /* ---------- 효과 (흐림 효과 / 스타일화) ---------- */
  var FX_FIELDS = {
    blur: function (e) {
      return [{ id: 'radius', label: '반경', type: 'num', value: e.radius, unit: 'pt', step: 1 }];
    },
    shadow: function (e) {
      return [
        { id: 'dx', label: 'X 오프셋', type: 'num', value: e.dx, unit: 'pt' },
        { id: 'dy', label: 'Y 오프셋', type: 'num', value: e.dy, unit: 'pt' },
        { id: 'blur', label: '흐림 정도', type: 'num', value: e.blur, unit: 'pt' },
        { id: 'color', label: '색상', type: 'color', value: e.color },
        { id: 'alpha', label: '불투명도', type: 'num', value: Math.round(e.alpha * 100), unit: '%' }
      ];
    },
    glow: function (e) {
      return [
        { id: 'blur', label: '흐림 정도', type: 'num', value: e.blur, unit: 'pt' },
        { id: 'color', label: '색상', type: 'color', value: e.color },
        { id: 'alpha', label: '불투명도', type: 'num', value: Math.round(e.alpha * 100), unit: '%' }
      ];
    },
    /* ---- 왜곡 및 변형 (벡터 효과) ---- */
    zigzag: function (e) {
      return [
        { id: 'size', label: '크기', type: 'num', value: e.size, unit: 'pt', step: 1 },
        { id: 'ridges', label: '각 세그먼트에 대한 융기 수', type: 'num', value: e.ridges, step: 1 },
        { id: 'smooth', label: '매끄럽게', type: 'check', value: !!e.smooth }
      ];
    },
    roughen: function (e) {
      return [
        { id: 'size', label: '크기', type: 'num', value: e.size, unit: 'pt', step: 1 },
        { id: 'detail', label: '세부', type: 'num', value: e.detail, unit: '/인치', step: 1 },
        { id: 'smooth', label: '매끄럽게', type: 'check', value: !!e.smooth }
      ];
    },
    puckerBloat: function (e) {
      return [
        { id: 'amount', label: '오목(-) · 볼록(+)', type: 'num', value: e.amount, unit: '%', step: 5 }
      ];
    },
    twist: function (e) {
      return [{ id: 'angle', label: '각도', type: 'num', value: e.angle, unit: '°', step: 5 }];
    },
    transformFx: function (e) {
      return [
        { id: 'scaleX', label: '가로 비율', type: 'num', value: e.scaleX, unit: '%' },
        { id: 'scaleY', label: '세로 비율', type: 'num', value: e.scaleY, unit: '%' },
        { type: 'sep' },
        { id: 'moveX', label: '가로 이동', type: 'num', value: e.moveX, unit: 'pt' },
        { id: 'moveY', label: '세로 이동', type: 'num', value: e.moveY, unit: 'pt' },
        { id: 'angle', label: '각도', type: 'num', value: e.angle, unit: '°' },
        { type: 'sep' },
        { id: 'reflectX', label: 'X 반사', type: 'check', value: !!e.reflectX },
        { id: 'reflectY', label: 'Y 반사', type: 'check', value: !!e.reflectY },
        { id: 'copies', label: '사본', type: 'num', value: e.copies, step: 1 },
        { id: 'anchor', label: '기준점', type: 'ref', value: e.anchor == null ? 4 : e.anchor }
      ];
    },
    /* ---- 3D ---- */
    extrude: function (e) {
      return THREE_POS(e).concat([
        { type: 'sep' },
        { id: 'depth', label: '돌출 깊이', type: 'num', value: e.depth, unit: 'pt' },
        { id: 'cap', label: '마구리 (앞뒤 막기)', type: 'check', value: e.cap !== false },
        { type: 'sep' }
      ]).concat(THREE_SURF(e));
    },
    rotate3d: function (e) {
      return THREE_POS(e).concat([{ type: 'sep' }]).concat(THREE_SURF(e));
    },
    freeDistort: function (e) {
      return [
        { id: 'tlx', label: '왼쪽 위 X', type: 'num', value: e.tl[0], unit: '%' },
        { id: 'tly', label: '왼쪽 위 Y', type: 'num', value: e.tl[1], unit: '%' },
        { id: 'trx', label: '오른쪽 위 X', type: 'num', value: e.tr[0], unit: '%' },
        { id: 'try', label: '오른쪽 위 Y', type: 'num', value: e.tr[1], unit: '%' },
        { type: 'sep' },
        { id: 'brx', label: '오른쪽 아래 X', type: 'num', value: e.br[0], unit: '%' },
        { id: 'bry', label: '오른쪽 아래 Y', type: 'num', value: e.br[1], unit: '%' },
        { id: 'blx', label: '왼쪽 아래 X', type: 'num', value: e.bl[0], unit: '%' },
        { id: 'bly', label: '왼쪽 아래 Y', type: 'num', value: e.bl[1], unit: '%' }
      ];
    }
  };
  /* 3D 대화상자의 공통 부분 — 위치(회전각·원근)와 표면(음영) */
  function THREE_POS(e) {
    return [
      { id: 'preset', label: '위치', type: 'select', width: 150, value: 'custom', options: [
        ['custom', '사용자 정의 회전'],
        ['front', '앞면'], ['off', '오프축 앞면'],
        ['isoTop', '등축 위'], ['isoLeft', '등축 왼쪽'], ['isoRight', '등축 오른쪽'],
        ['top', '윗면'], ['left', '왼쪽면'], ['right', '오른쪽면']
      ] },
      { id: 'ax', label: 'X 회전', type: 'num', value: e.ax, unit: '°' },
      { id: 'ay', label: 'Y 회전', type: 'num', value: e.ay, unit: '°' },
      { id: 'az', label: 'Z 회전', type: 'num', value: e.az, unit: '°' },
      { id: 'perspective', label: '원근', type: 'num', value: e.perspective, unit: '°' }
    ];
  }
  function THREE_SURF(e) {
    return [
      { id: 'shade', label: '표면', type: 'select', width: 150, value: e.shade || 'plastic',
        options: [['none', '음영 없음'], ['diffuse', '확산 음영'], ['plastic', '플라스틱 음영']] },
      { id: 'light', label: '조명 강도', type: 'num', value: e.light, unit: '%' },
      { id: 'ambient', label: '주변광', type: 'num', value: e.ambient, unit: '%' }
    ];
  }
  /* 일러스트레이터의 위치 사전 설정 (X, Y, Z) */
  var THREE_PRESETS = {
    front: [0, 0, 0], off: [-18, -26, 8],
    isoTop: [-35.26, -45, 0], isoLeft: [-35.26, -45, 0], isoRight: [35.26, 45, 0],
    top: [-90, 0, 0], left: [0, -90, 0], right: [0, 90, 0]
  };
  Dlg.THREE_PRESETS = THREE_PRESETS;

  var FX_BUILD = {
    blur: function (v) { return { type: 'blur', radius: Math.max(0, v.radius) }; },
    shadow: function (v) {
      return {
        type: 'shadow', dx: v.dx, dy: v.dy, blur: Math.max(0, v.blur),
        color: v.color || '#000000', alpha: U.clamp(v.alpha / 100, 0, 1)
      };
    },
    glow: function (v) {
      return {
        type: 'glow', blur: Math.max(0, v.blur),
        color: v.color || '#ffd166', alpha: U.clamp(v.alpha / 100, 0, 1)
      };
    },
    zigzag: function (v) {
      return {
        type: 'zigzag', size: v.size,
        ridges: U.clamp(Math.round(v.ridges), 1, 100), smooth: !!v.smooth
      };
    },
    roughen: function (v) {
      return {
        type: 'roughen', size: Math.max(0, v.size),
        detail: U.clamp(v.detail, 0.5, 200), smooth: !!v.smooth
      };
    },
    puckerBloat: function (v) { return { type: 'puckerBloat', amount: U.clamp(v.amount, -200, 200) }; },
    twist: function (v) { return { type: 'twist', angle: v.angle }; },
    transformFx: function (v) {
      return {
        type: 'transformFx', scaleX: v.scaleX, scaleY: v.scaleY,
        moveX: v.moveX, moveY: v.moveY, angle: v.angle,
        copies: U.clamp(Math.round(v.copies), 0, 60),
        anchor: v.anchor == null ? 4 : v.anchor,
        reflectX: !!v.reflectX, reflectY: !!v.reflectY
      };
    },
    freeDistort: function (v) {
      return {
        type: 'freeDistort',
        tl: [v.tlx, v.tly], tr: [v.trx, v.try], br: [v.brx, v.bry], bl: [v.blx, v.bly]
      };
    },
    extrude: function (v) {
      return {
        type: 'extrude', depth: Math.max(0, v.depth),
        ax: v.ax, ay: v.ay, az: v.az,
        perspective: U.clamp(v.perspective, 0, 160), cap: v.cap !== false,
        shade: v.shade, light: U.clamp(v.light, 0, 150), ambient: U.clamp(v.ambient, 0, 100)
      };
    },
    rotate3d: function (v) {
      return {
        type: 'rotate3d', depth: 0,
        ax: v.ax, ay: v.ay, az: v.az,
        perspective: U.clamp(v.perspective, 0, 160), cap: true,
        shade: v.shade, light: U.clamp(v.light, 0, 150), ambient: U.clamp(v.ambient, 0, 100)
      };
    }
  };

  Dlg.effect = function (app, type) {
    var FX = AI.effects, def = FX.def(type);
    if (!def || !FX_FIELDS[type]) return;
    if (!app.sel.length) { U.toast('오브젝트를 먼저 선택하세요'); return; }
    var sel = app.sel.slice();
    var snap = sel.map(function (it) { return it.effects ? U.deepCopy(it.effects) : null; });
    function restore() {
      sel.forEach(function (it, i) {
        if (snap[i]) it.effects = U.deepCopy(snap[i]);
        else delete it.effects;
      });
    }
    /* 이미 같은 종류의 효과가 걸려 있으면 그 값을 시작값으로 — 일러스트레이터처럼 편집이 된다 */
    var base = null;
    sel.forEach(function (it) {
      (it.effects || []).forEach(function (e) { if (!base && e.type === type) base = e; });
    });
    base = base ? U.deepCopy(base) : def.make();

    function apply(v) {
      var e = FX_BUILD[type](v);
      sel.forEach(function (it) {
        it.effects = it.effects || [];
        var idx = -1;
        for (var k = 0; k < it.effects.length; k++) if (it.effects[k].type === type) { idx = k; break; }
        if (idx >= 0) it.effects[idx] = U.deepCopy(e);
        else it.effects.push(U.deepCopy(e));
      });
      return e;
    }

    D.open({
      title: def.name,
      fields: FX_FIELDS[type](base).concat([
        { type: 'sep' },
        { id: 'preview', label: '미리 보기', type: 'check', value: true }
      ]),
      onChange: function (v, changed, api) {
        if (changed === 'preset' && THREE_PRESETS[v.preset]) {
          var pz = THREE_PRESETS[v.preset];
          api.set('ax', pz[0]); api.set('ay', pz[1]); api.set('az', pz[2]);
          v = api.values();
        } else if (changed === 'ax' || changed === 'ay' || changed === 'az') {
          api.set('preset', 'custom');
        }
        restore();
        if (v.preview !== false) apply(v);
        app.invalidate();
      },
      onDone: function (v) {
        restore();
        app.history.begin(def.name, app.doc);
        app.lastEffect = apply(v);
        app.history.commit();
        app.invalidate();
        AI.ui.syncAll(app);
      },
      onCancel: function () { restore(); app.invalidate(); AI.ui.syncAll(app); }
    });
  };

  /* ---------- 패스 상의 문자 옵션 ---------- */
  Dlg.typePath = function (app) {
    var sel = app.sel.filter(function (it) { return it.type === 'text' && it.text.path; });
    if (!sel.length) { U.toast('패스 상의 문자를 선택하세요'); return; }
    var snap = sel.map(function (it) { return U.deepCopy(it.text.path); });
    function restore() { sel.forEach(function (it, i) { it.text.path = U.deepCopy(snap[i]); }); }
    var base = snap[0];
    var len = Rn.measureText(sel[0]).pathLen || 0;

    function apply(v) {
      sel.forEach(function (it) {
        it.text.path.align = v.align;
        it.text.path.flip = !!v.flip;
        it.text.path.start = v.start;
      });
    }

    D.open({
      title: '패스 상의 문자 옵션',
      fields: [
        { id: 'align', label: '문자 맞추기', type: 'select', value: base.align || 'baseline', width: 130,
          options: [['baseline', '기준선'], ['ascender', '어센더'], ['descender', '디센더'], ['center', '가운데']] },
        { id: 'start', label: '시작 위치', type: 'num', value: base.start || 0, unit: 'pt' },
        { id: 'flip', label: '뒤집기', type: 'check', value: !!base.flip },
        { type: 'sep' },
        { id: 'info', label: '패스 길이 ' + U.fmt(len) + 'pt', type: 'info' },
        { id: 'preview', label: '미리 보기', type: 'check', value: true }
      ],
      onChange: function (v) {
        restore();
        if (v.preview !== false) apply(v);
        app.invalidate();
      },
      onDone: function (v) {
        restore();
        app.history.begin('패스 상의 문자 옵션', app.doc);
        apply(v);
        app.history.commit();
        app.invalidate();
        AI.ui.syncAll(app);
      },
      onCancel: function () { restore(); app.invalidate(); AI.ui.syncAll(app); }
    });
  };

  /* ---------- 이미지 추적 ---------- */
  Dlg.imageTrace = function (app) {
    var TR = AI.trace;
    var img = null;
    app.sel.forEach(function (it) { if (!img && it.type === 'image') img = it; });
    if (!img) { U.toast('추적할 이미지를 선택하세요'); return; }
    var el = Rn.getImage(img.src);
    if (!el || !el.complete || !el.naturalWidth) { U.toast('이미지를 아직 읽는 중입니다'); return; }

    var presetOpts = Object.keys(TR.PRESETS).map(function (k) { return [k, TR.PRESETS[k].name]; });
    presetOpts.push(['custom', '사용자 정의']);
    var P0 = TR.PRESETS.bwLogo;
    var preview = null;   /* 미리 보기로 넣어 둔 그룹 */

    function clearPreview() {
      if (!preview) return;
      var loc = Model.locate(app.doc, preview);
      if (loc) loc.list.splice(loc.index, 1);
      preview = null;
      img.visible = true;
    }
    function optsOf(v) {
      return {
        mode: v.mode, threshold: v.threshold, colors: Math.round(v.colors),
        path: v.path, noise: v.noise, curves: v.curves
      };
    }
    function build(v) {
      var layers = TR.traceImage(el, optsOf(v));
      return { group: TR.toGroup(app, img, layers, optsOf(v)), layers: layers };
    }
    function info(res) {
      if (!res || !res.group) return '추적 결과 없음';
      var paths = res.group.children.length, anchors = 0;
      res.group.children.forEach(function (c) {
        c.subs.forEach(function (sb) { anchors += sb.pts.length; });
      });
      return '패스 ' + paths + ' · 색상 ' + res.layers.length + ' · 앵커 ' + anchors;
    }
    function setInfo(txt) {
      var e = document.querySelector('.dlg-info');
      if (e) e.textContent = txt;
    }

    D.open({
      title: '이미지 추적',
      fields: [
        { id: 'preset', label: '사전 설정', type: 'select', value: 'bwLogo', width: 150, options: presetOpts },
        { id: 'mode', label: '모드', type: 'select', value: P0.mode, width: 110,
          options: [['bw', '흑백'], ['gray', '회색 음영'], ['color', '색상']] },
        { id: 'colors', label: '색상 수', type: 'num', value: P0.colors || 6, step: 1 },
        { id: 'threshold', label: '한계값', type: 'num', value: P0.threshold == null ? 128 : P0.threshold, step: 4 },
        { type: 'sep' },
        { id: 'path', label: '패스 단순화', type: 'num', value: P0.path, step: 0.2 },
        { id: 'noise', label: '노이즈', type: 'num', value: P0.noise, unit: 'px²', step: 5 },
        { id: 'curves', label: '곡선으로 맞춤', type: 'check', value: true },
        { type: 'sep' },
        { id: 'preview', label: '미리 보기', type: 'check', value: false },
        { id: 'info', label: '사전 설정을 고르고 미리 보기를 켜세요', type: 'info' }
      ],
      onChange: function (v, changed, a) {
        if (changed === 'preset' && TR.PRESETS[v.preset]) {
          var P = TR.PRESETS[v.preset];
          a.set('mode', P.mode);
          if (P.colors != null) a.set('colors', P.colors);
          if (P.threshold != null) a.set('threshold', P.threshold);
          a.set('path', P.path);
          a.set('noise', P.noise);
          v = a.values();
        } else if (changed && changed !== 'preview' && changed !== 'info') {
          a.set('preset', 'custom');
        }
        clearPreview();
        if (v.preview) {
          var res = build(v);
          if (res.group) {
            preview = res.group;
            img.visible = false;
            Model.activeLayer(app.doc).children.push(preview);
          }
          setInfo(info(res));
        } else setInfo('미리 보기를 켜면 결과를 확인할 수 있습니다');
        app.invalidate();
      },
      onDone: function (v) {
        clearPreview();
        var res = build(v);
        if (!res.group) { U.toast('추적 결과가 비어 있습니다 — 한계값이나 노이즈를 조정하세요'); app.invalidate(); return; }
        app.history.begin('이미지 추적', app.doc);
        var loc = Model.locate(app.doc, img);
        if (loc) loc.list.splice(loc.index, 1, res.group);
        else Model.activeLayer(app.doc).children.push(res.group);
        AI.sel.set(app, [res.group]);
        app.history.commit();
        app.invalidate();
        AI.ui.syncAll(app);
        U.toast('이미지 추적: ' + info(res));
      },
      onCancel: function () { clearPreview(); app.invalidate(); AI.ui.syncAll(app); }
    });
  };

  /* ---------- 대지 옵션 ---------- */
  Dlg.artboardOptions = function (app) {
    var i = app.doc.activeArtboard, ab = app.doc.artboards[i];
    D.open({
      title: '대지 옵션',
      fields: [
        { id: 'name', label: '이름', type: 'text', value: ab.name, width: 150 },
        { id: 'preset', label: '사전 설정', type: 'select', value: 'custom', width: 150, options: [
          ['custom', '사용자 정의'],
          ['a4', 'A4 (595 × 842)'], ['a3', 'A3 (842 × 1191)'], ['letter', 'Letter (612 × 792)'],
          ['fhd', 'Full HD (1920 × 1080)'], ['hd', 'HD (1280 × 720)'], ['square', '정사각 (1080 × 1080)'],
          ['web', '웹 (1440 × 900)'], ['mobile', '모바일 (390 × 844)']
        ] },
        { id: 'w', label: '폭', type: 'num', value: ab.w, unit: 'pt' },
        { id: 'h', label: '높이', type: 'num', value: ab.h, unit: 'pt' },
        { id: 'x', label: 'X', type: 'num', value: ab.x, unit: 'pt' },
        { id: 'y', label: 'Y', type: 'num', value: ab.y, unit: 'pt' },
        { id: 'orient', label: '방향', type: 'radio', value: ab.w > ab.h ? 'l' : 'p', options: [['p', '세로'], ['l', '가로']] }
      ],
      onChange: function (v, changed, a) {
        if (changed === 'preset' && PRESETS[v.preset]) {
          a.set('w', PRESETS[v.preset][0]); a.set('h', PRESETS[v.preset][1]);
          a.set('orient', PRESETS[v.preset][0] > PRESETS[v.preset][1] ? 'l' : 'p');
        } else if (changed === 'orient') {
          if ((v.orient === 'l') !== (v.w > v.h)) { a.set('w', v.h); a.set('h', v.w); }
        } else if (changed === 'w' || changed === 'h') a.set('preset', 'custom');
      },
      onDone: function (v) {
        app.history.begin('대지 옵션', app.doc);
        ab.name = v.name || ab.name;
        ab.w = Math.max(1, v.w); ab.h = Math.max(1, v.h);
        ab.x = v.x; ab.y = v.y;
        if (i === app.doc.activeArtboard) { app.doc.width = ab.w; app.doc.height = ab.h; }
        app.history.commit();
        app.invalidate();
        AI.ui.syncAll(app);
      }
    });
  };

  /* ---------- 모든 대지 재정렬 ---------- */
  Dlg.rearrangeArtboards = function (app) {
    var n = app.doc.artboards.length;
    D.open({
      title: '모든 대지 재정렬',
      fields: [
        { id: 'cols', label: '가로 개수', type: 'num', value: Math.ceil(Math.sqrt(n)), step: 1 },
        { id: 'gap', label: '간격', type: 'num', value: 40, unit: 'pt' },
        { id: 'info', label: '대지 ' + n + '개', type: 'info' }
      ],
      onDone: function (v) {
        app.history.begin('대지 재정렬', app.doc);
        E.rearrangeArtboards(app, Math.max(1, Math.round(v.cols)), Math.max(0, v.gap));
        app.history.commit();
        AI.viewT.fitAll(app);
        app.invalidate();
        AI.ui.syncAll(app);
      }
    });
  };

  /* ---------- 패스 이동 (Offset Path) ---------- */
  Dlg.offsetPath = function (app) {
    if (!app.sel.length) { U.toast('오브젝트를 먼저 선택하세요'); return; }
    D.open({
      title: '패스 이동',
      fields: [
        { id: 'offset', label: '이동', type: 'num', value: 10, unit: 'pt' },
        { id: 'replace', label: '원본 대체', type: 'check', value: false },
        { id: 'info', label: '음수를 넣으면 안쪽으로 줄어듭니다', type: 'info' }
      ],
      onDone: function (v) {
        app.history.begin('패스 이동', app.doc);
        if (E.offsetPath(app, v.offset, { replace: v.replace }) === false) app.history.abort();
        else { app.history.commit(); U.toast('패스 이동 ' + U.fmt(v.offset) + 'pt'); }
        app.invalidate();
        AI.ui.syncAll(app);
      }
    });
  };

  /* ---------- 단순화 (Simplify) ---------- */
  Dlg.simplify = function (app) {
    if (!app.sel.length) { U.toast('오브젝트를 먼저 선택하세요'); return; }
    var snap = app.sel.map(function (it) { return U.deepCopy(it.subs); });
    var shapes = app.sel.map(function (it) { return it.shape ? U.deepCopy(it.shape) : null; });
    function restore() {
      app.sel.forEach(function (it, i) {
        if (snap[i]) it.subs = U.deepCopy(snap[i]);
        it.shape = shapes[i] ? U.deepCopy(shapes[i]) : null;
      });
    }
    function setInfo(r) {
      var el = document.querySelector('.dlg-info');
      if (el) el.textContent = r ? ('앵커 ' + r.before + ' → ' + r.after) : '미리 보기를 켜면 결과를 볼 수 있습니다';
    }
    D.open({
      title: '단순화',
      fields: [
        { id: 'precision', label: '곡선 정밀도', type: 'num', value: 90, unit: '%' },
        { id: 'angle', label: '각도 한계값', type: 'num', value: 0, unit: '°' },
        { id: 'curves', label: '곡선으로 맞춤', type: 'check', value: true },
        { type: 'sep' },
        { id: 'preview', label: '미리 보기', type: 'check', value: true },
        { id: 'info', label: '앵커 —', type: 'info' }
      ],
      onChange: function (v) {
        restore();
        if (v.preview !== false) setInfo(E.simplifyPaths(app, v) || null);
        else setInfo(null);
        app.invalidate();
      },
      onDone: function (v) {
        restore();
        app.history.begin('단순화', app.doc);
        var r = E.simplifyPaths(app, v);
        if (r === false) { app.history.abort(); U.toast('단순화할 패스가 없습니다'); }
        else { app.history.commit(); U.toast('앵커 ' + r.before + ' → ' + r.after); }
        app.invalidate();
        AI.ui.syncAll(app);
      },
      onCancel: function () { restore(); app.invalidate(); AI.ui.syncAll(app); }
    });
  };

  /* ---------- 블렌드 옵션 ---------- */
  Dlg.blendOptions = function (app) {
    app.blendOpts = app.blendOpts || { steps: 5 };
    D.open({
      title: '블렌드 옵션',
      fields: [
        { id: 'mode', label: '간격', type: 'select', value: 'steps', width: 130,
          options: [['steps', '지정된 단계'], ['smooth', '매끄러운 색상']] },
        { id: 'steps', label: '단계', type: 'num', value: app.blendOpts.steps, step: 1 },
        { id: 'info', label: '2개 이상 선택한 뒤 Ctrl+Alt+B 로 만듭니다', type: 'info' }
      ],
      onChange: function (v, changed, a) {
        if (changed === 'mode' && v.mode === 'smooth') a.set('steps', 24);
      },
      onDone: function (v) {
        app.blendOpts.steps = U.clamp(Math.round(v.steps), 1, 200);
        if (app.sel.length > 1) AI.commands.run('blendMake');
        else U.toast('블렌드 단계: ' + app.blendOpts.steps);
      }
    });
  };

  /* ---------- 아트웍 재색상화 ---------- */
  Dlg.recolor = function (app) {
    if (!app.sel.length) { U.toast('오브젝트를 먼저 선택하세요'); return; }
    var palette = E.collectColors(app);
    if (!palette.length) { U.toast('색이 있는 오브젝트를 선택하세요'); return; }
    palette = palette.slice(0, 12);
    var snap = app.sel.map(function (it) { return U.deepCopy(it); });
    function restore() {
      app.sel.forEach(function (it, i) {
        var src = snap[i];
        Object.keys(src).forEach(function (k) {
          if (k === 'id' || k === 'm') return;
          it[k] = U.deepCopy(src[k]);
        });
      });
    }
    var fields = palette.map(function (c, i) {
      return { id: 'c' + i, label: c.color + ' (' + c.count + ')', type: 'color', value: c.color };
    });
    fields.push({ type: 'sep' });
    fields.push({ id: 'hue', label: '색조 회전', type: 'num', value: 0, unit: '°', step: 5 });
    fields.push({ id: 'sat', label: '채도', type: 'num', value: 0, unit: '%', step: 5 });
    fields.push({ id: 'light', label: '밝기', type: 'num', value: 0, unit: '%', step: 5 });
    fields.push({ type: 'sep' });
    fields.push({ id: 'preview', label: '미리 보기', type: 'check', value: true });

    function mapOf(v) {
      var map = {};
      palette.forEach(function (c, i) {
        var nv = String(v['c' + i] || c.color).toLowerCase();
        if (nv !== c.color) map[c.color] = nv;
      });
      return map;
    }
    function adjOf(v) { return { hue: v.hue || 0, sat: v.sat || 0, light: v.light || 0 }; }

    D.open({
      title: '아트웍 재색상화',
      fields: fields,
      buttons: [{ id: 'random', label: '무작위' }, { id: 'cancel', label: '취소' }, { id: 'ok', label: '확인', primary: true }],
      onChange: function (v) {
        restore();
        if (v.preview !== false) E.recolor(app, mapOf(v), adjOf(v));
        app.invalidate();
      },
      onDone: function (v, btn) {
        restore();
        if (btn === 'random') {
          /* 색조만 무작위로 돌려 변주를 만든다 */
          var rmap = {};
          palette.forEach(function (c) {
            var rgb = AI.color.hexToRgb(c.color);
            var hsb = AI.color.rgbToHsb(rgb.r, rgb.g, rgb.b);
            var o = AI.color.hsbToRgb((hsb.h + Math.random() * 360) % 360, hsb.s, hsb.b);
            rmap[c.color] = AI.color.rgbToHex(o.r, o.g, o.b);
          });
          app.history.begin('재색상화', app.doc);
          E.recolor(app, rmap, {});
          app.history.commit();
        } else {
          app.history.begin('재색상화', app.doc);
          if (!E.recolor(app, mapOf(v), adjOf(v))) app.history.abort();
          else app.history.commit();
        }
        app.invalidate();
        AI.ui.syncAll(app);
      },
      onCancel: function () { restore(); app.invalidate(); AI.ui.syncAll(app); }
    });
  };

  /* ---------- 패턴 옵션 ---------- */
  Dlg.patternOptions = function (app) {
    AI.assets.ensure(app.doc);
    var cur = null;
    app.sel.forEach(function (it) {
      if (!cur && it.fill && it.fill.type === 'pattern') cur = it.fill;
      if (!cur && it.stroke && it.stroke.type === 'pattern') cur = it.stroke;
    });
    if (!cur) { U.toast('패턴으로 칠한 오브젝트를 선택하세요'); return; }
    var snap = { scale: cur.scale, angle: cur.angle };
    D.open({
      title: '패턴 옵션',
      fields: [
        { id: 'scale', label: '비율', type: 'num', value: cur.scale == null ? 100 : cur.scale, unit: '%', step: 5 },
        { id: 'angle', label: '각도', type: 'num', value: cur.angle || 0, unit: '°', step: 5 },
        { type: 'sep' },
        { id: 'preview', label: '미리 보기', type: 'check', value: true }
      ],
      onChange: function (v) {
        if (v.preview === false) { cur.scale = snap.scale; cur.angle = snap.angle; }
        else { cur.scale = U.clamp(v.scale, 1, 1000); cur.angle = v.angle; }
        app.invalidate();
      },
      onDone: function (v) {
        cur.scale = snap.scale; cur.angle = snap.angle;
        app.history.begin('패턴 옵션', app.doc);
        cur.scale = U.clamp(v.scale, 1, 1000);
        cur.angle = v.angle;
        app.history.commit();
        app.invalidate();
        AI.ui.syncAll(app);
      },
      onCancel: function () { cur.scale = snap.scale; cur.angle = snap.angle; app.invalidate(); }
    });
  };

  /* ---------- 브러시 정의 (서예 · 산포) ---------- */
  Dlg.brushOptions = function (app) {
    D.open({
      title: '브러시 옵션',
      fields: [
        { id: 'kind', label: '종류', type: 'radio', value: 'calligraphic',
          options: [['calligraphic', '서예'], ['scatter', '산포'], ['art', '아트'], ['pattern', '패턴'], ['none', '없음']] },
        { type: 'sep' },
        { id: 'angle', label: '펜촉 각도', type: 'num', value: (app.brushOpts && app.brushOpts.angle) || 30, unit: '°', step: 5 },
        { id: 'roundness', label: '납작함', type: 'num', value: (app.brushOpts && app.brushOpts.roundness) || 20, unit: '%', step: 5 },
        { type: 'sep' },
        { id: 'width', label: '브러시 폭 (아트 · 패턴)', type: 'num', value: (app.brushOpts && app.brushOpts.width) || 100, unit: '%' },
        { id: 'flipAlong', label: '길이 방향 뒤집기', type: 'check', value: !!(app.brushOpts && app.brushOpts.flipAlong) },
        { id: 'flipAcross', label: '폭 방향 뒤집기', type: 'check', value: !!(app.brushOpts && app.brushOpts.flipAcross) },
        { id: 'keepPath', label: '원본 패스 남기기', type: 'check', value: !!(app.brushOpts && app.brushOpts.keepPath) },
        { type: 'sep' },
        { id: 'spacing', label: '산포 간격', type: 'num', value: (app.brushOpts && app.brushOpts.spacing) || 30, unit: 'pt' },
        { id: 'sizeJitter', label: '크기 변화', type: 'num', value: (app.brushOpts && app.brushOpts.sizeJitter) || 20, unit: '%' },
        { id: 'rotationJitter', label: '회전 변화', type: 'num', value: (app.brushOpts && app.brushOpts.rotationJitter) || 15, unit: '°' },
        { id: 'offsetJitter', label: '간격 변화', type: 'num', value: (app.brushOpts && app.brushOpts.offsetJitter) || 6, unit: 'pt' },
        { id: 'follow', label: '패스 방향 따라 회전', type: 'check', value: true },
        { type: 'sep' },
        { id: 'info', label: '산포 · 아트 · 패턴은 맨 앞 오브젝트를 브러시 아트웍으로 씁니다', type: 'info' }
      ],
      onDone: function (v) {
        app.brushOpts = {
          angle: v.angle, roundness: v.roundness, spacing: v.spacing,
          sizeJitter: v.sizeJitter, rotationJitter: v.rotationJitter, offsetJitter: v.offsetJitter,
          width: v.width, flipAlong: v.flipAlong, flipAcross: v.flipAcross, keepPath: v.keepPath
        };
        if (v.kind === 'calligraphic' || v.kind === 'none') {
          app.history.begin('브러시', app.doc);
          app.sel.forEach(function (it) {
            (function rec(o) {
              if (o.type === 'group') { o.children.forEach(rec); return; }
              if (!o.stroke) return;
              if (v.kind === 'none') delete o.stroke.brush;
              else o.stroke.brush = { type: 'calligraphic', angle: v.angle, roundness: v.roundness };
              AI.appearance.pushDown(o);
            })(it);
          });
          app.history.commit();
          U.toast(v.kind === 'none' ? '브러시 제거' : '서예 브러시 적용');
        } else {
          if (app.sel.length < 2) { U.toast('브러시 아트웍과 경로를 함께 선택하세요 (맨 앞이 아트웍)'); return; }
          var ordered = [];
          Model.walk(app.doc, function (it) { if (app.sel.indexOf(it) >= 0) ordered.push(it); });
          var art = ordered[ordered.length - 1];
          var NAME = { scatter: '산포 브러시', art: '아트 브러시', pattern: '패턴 브러시' };
          app.history.begin(NAME[v.kind], app.doc);
          AI.sel.set(app, ordered.slice(0, -1));
          var ok;
          if (v.kind === 'scatter') {
            ok = E.scatterAlongPath(app, art, {
              spacing: v.spacing, sizeJitter: v.sizeJitter,
              rotationJitter: v.rotationJitter, offsetJitter: v.offsetJitter, follow: v.follow
            });
          } else {
            ok = E.artBrushAlongPath(app, art, {
              mode: v.kind, width: v.width,
              flipAlong: v.flipAlong, flipAcross: v.flipAcross, keepPath: !!v.keepPath
            });
          }
          if (ok === false) app.history.abort(); else app.history.commit();
        }
        app.invalidate();
        AI.ui.syncAll(app);
      }
    });
  };
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
