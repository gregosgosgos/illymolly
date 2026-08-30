/* =========================================================================
   app.js — 애플리케이션 부트스트랩 / 이벤트 라우팅 / 렌더 루프
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, M = AI.mat, R = AI.rect, Model = AI.model, T = AI.tools, Rn = AI.render, Col = AI.color, C = AI.commands;

  var app = AI.app = {
    doc: null,
    view: { scale: 1, tx: 0, ty: 0 },
    dpr: Math.max(1, window.devicePixelRatio || 1),
    tool: 'select',
    sel: [], selPts: [],
    marquee: null, smart: [],
    isolation: [],
    fill: Col.solid('#ffffff'),
    stroke: Col.solid('#000000'),
    strokeWidth: 1, strokeCap: 'butt', strokeJoin: 'miter', strokeDash: [],
    brushWidth: 3, eraserWidth: 20,
    fillFocus: true,
    lockRatio: false,
    alignTo: 'selection',
    hideEdges: false,
    dirty: false,
    prefs: {
      rulers: true, grid: false, guides: true, smart: true, snapGrid: false,
      outline: false, bbox: true, centerPoint: false, previewBounds: false,
      keyIncrement: 1, unit: 'pt', gridSize: 72, gridDiv: 8, scaleStrokes: false
    },
    refPoint: 0
  };

  app.history = new AI.History(150);

  app.invalidate = function () { app.needsDraw = true; };

  app.setDoc = function (doc) {
    var ids = app.sel.map(function (i) { return i.id; });
    var ptRefs = app.selPts.map(function (s) { return { id: s.it.id, si: s.si, pi: s.pi }; });
    app.doc = doc;
    app.sel = [];
    app.selPts = [];
    ids.forEach(function (id) {
      var it = Model.find(doc, id);
      if (it) app.sel.push(it);
    });
    ptRefs.forEach(function (r) {
      var it = Model.find(doc, r.id);
      if (it && it.subs && it.subs[r.si] && it.subs[r.si].pts[r.pi]) app.selPts.push({ it: it, si: r.si, pi: r.pi });
    });
    app.isolation = [];
    /* 현재 탭이 가리키는 문서도 함께 바꿔 준다 (실행 취소 · 되돌리기) */
    if (app.docs && app.docs[app.docIndex]) app.docs[app.docIndex].doc = doc;
    app.invalidate();
    AI.ui && AI.ui.syncAll && AI.ui.syncAll(app);
  };

  /* ---------------- 캔버스 ---------------- */
  var canvas, ctx;

  app.resize = function () {
    if (!canvas) return;
    var w = canvas.clientWidth, h = canvas.clientHeight;
    var dpr = app.dpr = Math.max(1, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    app.invalidate();
  };

  function draw() {
    if (app.needsDraw) {
      app.needsDraw = false;
      Rn.scene(ctx, app);
      Rn.ui(ctx, app);
      Rn.loupe(ctx, app);
      AI.viewT.drawRulers(app);
      if (app.editingText) T.syncTextBox(app);
    }
    requestAnimationFrame(draw);
  }

  /* ---------------- 입력 ----------------
     마우스와 터치를 하나의 경로로 모은다. 터치는 손가락 수로 갈라진다.
       1개 — 현재 도구
       2개 — 캔버스 이동/확대 (도구와 무관, Guiard 의 양손 비대칭 모델)
       2개 탭 — 실행 취소 / 3개 탭 — 다시 실행 (Procreate 관례)                */
  var startPt = { x: 0, y: 0 }, down = false;

  function mk(clientX, clientY, mods, isDown) {
    var r = canvas.getBoundingClientRect();
    var x = clientX - r.left, y = clientY - r.top;
    if (isDown) startPt = { x: x, y: y };
    return {
      x: x, y: y, sx: startPt.x, sy: startPt.y,
      shift: !!mods.shiftKey, alt: !!mods.altKey,
      ctrl: U.isMac ? !!mods.metaKey : !!mods.ctrlKey,
      meta: !!mods.metaKey, button: mods.button || 0,
      down: down, orig: mods
    };
  }
  function evt(ev, isDown) { return mk(ev.clientX, ev.clientY, ev, isDown); }

  /* 정밀 조작이 필요한 도구에서만 터치 루페(Shift, Vogel & Baudisch 2007)를 띄운다 */
  var PRECISE = ['select', 'groupselect', 'directselect', 'pen', 'addanchor', 'delanchor',
    'convert', 'scissors', 'gradient', 'freetransform', 'rotate', 'scale', 'reflect'];

  /* 잠금이 풀린 안내선은 캔버스에서 직접 끌어 옮길 수 있다 (일러스트레이터와 동일) */
  var guideDrag = null;
  function guideAt(e) {
    if (!app.prefs.guides || app.prefs.guidesLocked !== false) return null;
    var best = null, bd = 4;
    app.doc.guides.forEach(function (g) {
      var sp = AI.viewT.toScreen(app, g.axis === 'v' ? g.pos : 0, g.axis === 'h' ? g.pos : 0);
      var d = g.axis === 'v' ? Math.abs(sp.x - e.x) : Math.abs(sp.y - e.y);
      if (d < bd) { bd = d; best = g; }
    });
    return best;
  }

  function toolDown(e) {
    AI.ui.closeMenus && AI.ui.closeMenus();
    var cm = document.getElementById('contextmenu');
    if (cm) cm.hidden = true;
    canvas.focus();
    var g = guideAt(e);
    if (g) {
      down = true;
      e.down = true;
      guideDrag = g;
      app.history.begin('안내선 이동', app.doc);
      return;
    }
    down = true;
    e.down = true;
    var t = T.current(app);
    if (t && t.onDown) t.onDown(app, e);
    app.dirty = true;
  }
  function toolMove(e) {
    e.down = down;
    if (guideDrag && down) {
      var d0 = AI.viewT.toDoc(app, e.x, e.y);
      guideDrag.pos = guideDrag.axis === 'v' ? d0.x : d0.y;
      app.invalidate();
      return;
    }
    var hoverGuide = down ? null : guideAt(e);
    var t = T.current(app);
    var inCanvas = e.x >= 0 && e.y >= 0 && e.x <= canvas.clientWidth && e.y <= canvas.clientHeight;
    if (down || inCanvas) { if (t && t.onMove) t.onMove(app, e); }
    /* 도구가 커서를 정한 뒤에 덮어써야 안내선 위 커서가 유지된다 */
    if (hoverGuide) canvas.style.cursor = hoverGuide.axis === 'v' ? 'ew-resize' : 'ns-resize';
    if (inCanvas) {
      var d = AI.viewT.toDoc(app, e.x, e.y);
      var co = document.getElementById('st-coords');
      var un = app.prefs.unit || 'pt';
      var ro = app.doc.rulerOrigin || { x: 0, y: 0 };
      if (co) co.textContent = U.fmtUnit(d.x + ro.x, un) + ' , ' + U.fmtUnit(d.y + ro.y, un) + ' ' + un;
    }
    if (down && app.touchInput && PRECISE.indexOf(app.tool) >= 0) app.loupe = { x: e.x, y: e.y };
  }
  function toolUp(e) {
    if (!down) return;
    down = false;
    e.down = false;
    if (guideDrag) {
      /* 캔버스 밖으로 끌어내면 삭제 — 눈금자에서 만들 때와 같은 규칙 */
      if (e.x < 0 || e.y < 0) {
        var gi = app.doc.guides.indexOf(guideDrag);
        if (gi >= 0) app.doc.guides.splice(gi, 1);
      }
      app.history.commit();
      guideDrag = null;
      app.invalidate();
      AI.ui.syncAll(app);
      return;
    }
    var t = T.current(app);
    if (t && t.onUp) t.onUp(app, e);
    app.loupe = null;
    app.invalidate();
    AI.ui.syncAll(app);
  }
  /* 손가락이 하나 더 얹히면 진행 중이던 도구 작업을 없던 일로 되돌린다.
     undo 를 부르면 직전의 다른 작업까지 지워질 수 있으므로,
     드래그 시작 시점의 스냅샷과 히스토리 깊이로 정확히 복원한다. */
  var dragSnap = null;
  function snapForDrag() {
    dragSnap = {
      doc: U.deepCopy(app.doc),
      depth: app.history.stack.length,
      index: app.history.index,
      sel: app.sel.map(function (i) { return i.id; })
    };
  }
  app.cancelDrag = function (restore) {
    if (!down) return;
    down = false;
    if (guideDrag) { app.history.abort(); guideDrag = null; app.invalidate(); return; }
    var t = T.current(app);
    if (t && t.onUp) t.onUp(app, mk(0, 0, {}, false));
    if (restore && dragSnap) {
      app.history.abort();
      if (app.history.stack.length > dragSnap.depth) {
        app.history.stack.length = dragSnap.depth;
        app.history.index = Math.min(dragSnap.index, app.history.stack.length - 1);
      }
      app.setDoc(dragSnap.doc);
      app.sel = dragSnap.sel.map(function (id) { return Model.find(app.doc, id); }).filter(Boolean);
    }
    dragSnap = null;
    app.loupe = null;
    app.invalidate();
  };

  function bindCanvas() {
    /* 펜 태블릿(Wacom 등) 필압 — 마우스 이벤트보다 먼저 도착한다 */
    U.on(canvas, 'pointerdown', function (ev) {
      app.pressure = (ev.pointerType === 'pen' && ev.pressure > 0) ? ev.pressure : 1;
    });
    U.on(canvas, 'pointermove', function (ev) {
      if (ev.pointerType === 'pen' && ev.pressure > 0) app.pressure = ev.pressure;
    });

    U.on(canvas, 'mousedown', function (ev) {
      if (ev.button === 2 || app.touchInput) return;
      toolDown(evt(ev, true));
      ev.preventDefault();
    });
    U.on(window, 'mousemove', function (ev) {
      if (!canvas || app.touchInput) return;
      toolMove(evt(ev, false));
    });
    U.on(window, 'mouseup', function (ev) {
      if (app.touchInput) return;
      toolUp(evt(ev, false));
    });

    /* ---------------- 터치 ---------------- */
    var touch = null;   /* {mode:'tool'|'canvas', …} */
    var tapInfo = null; /* 멀티 손가락 탭 판정용 */

    function pts(ev) {
      var r = canvas.getBoundingClientRect(), out = [];
      for (var i = 0; i < ev.touches.length; i++) {
        var t = ev.touches[i];
        out.push({ x: t.clientX - r.left, y: t.clientY - r.top, id: t.identifier });
      }
      return out;
    }
    /* 스타일러스 필압 — Touch.force (iOS) / PointerEvent.pressure.
       지원하지 않는 기기는 1 로 두어 예전과 같게 동작한다. */
    function pressureOf(t) {
      if (!t) return 1;
      if (typeof t.force === 'number' && t.force > 0) {
        var max = (typeof t.__maxForce === 'number' && t.__maxForce) || 1;
        return U.clamp(t.force / max, 0.05, 1);
      }
      return 1;
    }

    function centroid(list) {
      var c = { x: 0, y: 0 };
      list.forEach(function (p) { c.x += p.x; c.y += p.y; });
      c.x /= list.length; c.y /= list.length;
      return c;
    }
    function spread(list, c) {
      var d = 0;
      list.forEach(function (p) { d += U.dist(p.x, p.y, c.x, c.y); });
      return d / list.length;
    }

    U.on(canvas, 'touchstart', function (ev) {
      app.touchInput = true;
      document.body.classList.add('touch');
      var list = pts(ev);
      if (list.length === 1) {
        touch = { mode: 'tool' };
        var t0 = ev.touches[0];
        snapForDrag();
        app.pressure = pressureOf(t0);
        toolDown(mk(t0.clientX, t0.clientY, {}, true));
        tapInfo = { n: 1, t: Date.now(), moved: false };
      } else {
        /* 두 손가락 이상 = 캔버스 조작. 진행 중이던 도구 작업은 없던 일로 */
        var wasDrawing = down || (tapInfo && tapInfo.moved);
        if (down) app.cancelDrag(true);
        var c = centroid(list);
        touch = {
          mode: 'canvas', c: c, d: spread(list, c), scale: app.view.scale, n: list.length,
          ang: list.length >= 2 ? Math.atan2(list[1].y - list[0].y, list[1].x - list[0].x) : 0,
          rotated: 0
        };
        /* 그리다가 손가락을 얹은 경우는 탭이 아니다 — 취소 위에 실행 취소가 겹치면 안 된다 */
        tapInfo = {
          n: Math.max(tapInfo ? tapInfo.n : 0, list.length),
          t: Date.now(),
          moved: !!wasDrawing
        };
        app.loupe = null;
      }
      ev.preventDefault();
    }, { passive: false });

    U.on(canvas, 'touchmove', function (ev) {
      var list = pts(ev);
      if (!touch) return;
      if (touch.mode === 'tool' && list.length === 1) {
        var t0 = ev.touches[0];
        app.pressure = pressureOf(t0);
        toolMove(mk(t0.clientX, t0.clientY, {}, false));
        if (tapInfo && U.dist(startPt.x, startPt.y, list[0].x, list[0].y) > 8) tapInfo.moved = true;
      } else if (touch.mode === 'canvas' && list.length >= 2) {
        var c = centroid(list), d = spread(list, c);
        if (tapInfo && (U.dist(c.x, c.y, touch.c.x, touch.c.y) > 8 || Math.abs(d - touch.d) > 8)) tapInfo.moved = true;
        AI.viewT.pan(app, c.x - touch.c.x, c.y - touch.c.y);
        if (touch.d > 12 && d > 12) {
          var k = d / touch.d;
          AI.viewT.setZoom(app, app.view.scale * k, c.x, c.y);
        }
        /* 두 손가락 비틀기 = 화면 회전. 15° 를 넘겨야 시작해 확대와 섞이지 않는다 */
        if (list.length >= 2 && app.prefs.rotateGesture !== false) {
          var ang = Math.atan2(list[1].y - list[0].y, list[1].x - list[0].x);
          var da = ang - touch.ang;
          while (da > Math.PI) da -= Math.PI * 2;
          while (da < -Math.PI) da += Math.PI * 2;
          touch.rotated += Math.abs(da);
          if (touch.rotated > 0.26) AI.viewT.rotateView(app, da, c.x, c.y);
          touch.ang = ang;
        }
        touch.c = c; touch.d = d;
      }
      ev.preventDefault();
    }, { passive: false });

    function endTouch(ev) {
      var remaining = ev.touches.length;
      if (remaining === 0) {
        /* 멀티 손가락 탭 = 실행 취소 / 다시 실행 */
        if (tapInfo && !tapInfo.moved && Date.now() - tapInfo.t < 400 && tapInfo.n >= 2) {
          AI.commands.run(tapInfo.n === 2 ? 'undo' : 'redo');
          U.toast(tapInfo.n === 2 ? '실행 취소' : '다시 실행');
        } else if (touch && touch.mode === 'tool') {
          var ct = ev.changedTouches[0];
          toolUp(mk(ct.clientX, ct.clientY, {}, false));
          dragSnap = null;
        }
        if (down) app.cancelDrag(true);
        dragSnap = null;
        touch = null; tapInfo = null;
        app.loupe = null;
        app.invalidate();
        AI.ui.syncAll(app);
      } else if (touch && touch.mode === 'canvas') {
        var list = pts(ev);
        var c = centroid(list);
        touch.c = c; touch.d = spread(list, c); touch.n = list.length;
      }
      ev.preventDefault();
    }
    U.on(canvas, 'touchend', endTouch, { passive: false });
    U.on(canvas, 'touchcancel', endTouch, { passive: false });

    U.on(canvas, 'dblclick', function (ev) {
      var e = evt(ev, false);
      var t = T.current(app);
      if (t && t.onDblClick) t.onDblClick(app, e);
    });

    U.on(canvas, 'contextmenu', function (ev) {
      ev.preventDefault();
      AI.ui.showContext(app, ev.clientX, ev.clientY);
    });

    U.on(canvas, 'wheel', function (ev) {
      ev.preventDefault();
      var r = canvas.getBoundingClientRect();
      var cx = ev.clientX - r.left, cy = ev.clientY - r.top;
      var ctrl = U.isMac ? ev.metaKey : ev.ctrlKey;
      if (ctrl || ev.altKey) {
        var f = Math.pow(1.0015, -ev.deltaY);
        AI.viewT.setZoom(app, app.view.scale * f, cx, cy);
      } else if (ev.shiftKey) {
        AI.viewT.pan(app, -ev.deltaY, 0);
      } else {
        AI.viewT.pan(app, -ev.deltaX, -ev.deltaY);
      }
    }, { passive: false });

    /* 미들 버튼 = 임시 손 */
    U.on(canvas, 'auxclick', function (ev) { if (ev.button === 1) ev.preventDefault(); });
  }

  /* 눈금자 코너에서 드래그 -> 눈금자 원점 이동 (더블클릭하면 초기화) */
  function bindRulerCorner() {
    var el = document.getElementById('ruler-corner');
    if (!el) return;
    U.on(el, 'mousedown', function (ev) {
      ev.preventDefault();
      app.history.begin('눈금자 원점', app.doc);
      var rect = canvas.getBoundingClientRect();
      function move(e) {
        var d = AI.viewT.toDoc(app, e.clientX - rect.left, e.clientY - rect.top);
        app.doc.rulerOrigin = { x: -d.x, y: -d.y };
        AI.viewT.drawRulers(app);
        app.invalidate();
      }
      function up() {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        app.history.commit();
        AI.ui.syncStatus(app);
      }
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
    U.on(el, 'dblclick', function () {
      app.history.begin('눈금자 원점 초기화', app.doc);
      app.doc.rulerOrigin = { x: 0, y: 0 };
      app.history.commit();
      AI.viewT.drawRulers(app);
      app.invalidate();
      U.toast('눈금자 원점 초기화');
    });
  }

  /* 눈금자에서 드래그 -> 안내선 */
  function bindRulers() {
    ['ruler-h', 'ruler-v'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      U.on(el, 'mousedown', function (ev) {
        ev.preventDefault();
        var axis = (id === 'ruler-h') ? 'h' : 'v';
        var guide = { axis: axis, pos: 0 };
        app.history.begin('안내선', app.doc);
        app.doc.guides.push(guide);
        var rect = canvas.getBoundingClientRect();
        function move(e) {
          var x = e.clientX - rect.left, y = e.clientY - rect.top;
          var d = AI.viewT.toDoc(app, x, y);
          guide.pos = axis === 'h' ? d.y : d.x;
          app.prefs.guides = true;
          app.invalidate();
        }
        function up(e) {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          var x = e.clientX - rect.left, y = e.clientY - rect.top;
          if (x < 0 || y < 0) {
            app.doc.guides.pop();
            app.history.abort();
          } else app.history.commit();
          app.invalidate();
        }
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
        move(ev);
      });
    });
  }

  /* ---------------- 시작 ---------------- */
  function boot() {
    canvas = app.canvas = document.getElementById('view');
    ctx = canvas.getContext('2d');
    app.doc = Model.newDoc(800, 600);
    app.history.reset(app.doc, '새 문서');
    AI.docs.init(app);          /* 첫 문서를 첫 탭으로 등록 */

    C.bind(app);
    T.buildToolbar(app);
    AI.ui.init(app);
    AI.keymap.install(app);
    bindCanvas();
    bindRulers();
    bindRulerCorner();

    U.on(window, 'resize', function () { app.resize(); });
    new ResizeObserver(function () { app.resize(); }).observe(document.getElementById('canvas-wrap'));

    U.on(window, 'beforeunload', function (ev) {
      /* 열려 있는 문서 중 하나라도 저장되지 않았으면 확인한다 */
      if (!AI.docs.anyDirty(app)) return;
      ev.preventDefault();
      ev.returnValue = '';
    });

    app.resize();
    T.setTool(app, 'select', true);
    AI.ui.syncAll(app);
    AI.mobile.init(app);        /* 레이아웃이 확정된 뒤 */
    app.resize();
    AI.viewT.fitArtboard(app);
    app.invalidate();
    draw();

    /* 자동화 / AI 에이전트 진입점 — 사람이 쓰는 GUI 와 같은 문서를 공유한다 */
    window.illy = AI.api.create(app);
    AI.bridge.install(window.illy, window);

    /* 자동 저장 — 남은 복구 기록이 있으면 물어본다 */
    AI.autosave.init(app);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
