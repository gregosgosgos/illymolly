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
        app.setDoc(doc);
        app.history.reset(app.doc, '새 문서');
        app.dirty = false;
        AI.viewT.fitArtboard(app);
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
      { id: 'h', label: '높이', type: 'num', value: o.h || 100, unit: 'pt' }
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
      len: o.lastLen, angle: o.lastAngle
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
          it = Model.newEllipse(at.x - v.w / 2, at.y - v.h / 2, v.w, v.h);
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
})(window.AI);
