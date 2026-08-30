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
      keyIncrement: 1
    }
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
      AI.viewT.drawRulers(app);
      if (app.editingText) T.syncTextBox(app);
    }
    requestAnimationFrame(draw);
  }

  /* ---------------- 이벤트 ---------------- */
  var startPt = { x: 0, y: 0 }, down = false, downButton = 0;

  function evt(ev, isDown) {
    var r = canvas.getBoundingClientRect();
    var x = ev.clientX - r.left, y = ev.clientY - r.top;
    if (isDown) startPt = { x: x, y: y };
    return {
      x: x, y: y, sx: startPt.x, sy: startPt.y,
      shift: ev.shiftKey, alt: ev.altKey,
      ctrl: U.isMac ? ev.metaKey : ev.ctrlKey,
      meta: ev.metaKey, button: ev.button,
      down: down, orig: ev
    };
  }

  function bindCanvas() {
    U.on(canvas, 'mousedown', function (ev) {
      if (ev.button === 2) return;
      AI.ui.closeMenus && AI.ui.closeMenus();
      document.getElementById('contextmenu').hidden = true;
      canvas.focus();
      down = true; downButton = ev.button;
      var e = evt(ev, true);
      e.down = true;
      var t = T.current(app);
      if (t && t.onDown) t.onDown(app, e);
      app.dirty = true;
      ev.preventDefault();
    });

    U.on(window, 'mousemove', function (ev) {
      if (!canvas) return;
      var e = evt(ev, false);
      e.down = down;
      var t = T.current(app);
      var inCanvas = e.x >= 0 && e.y >= 0 && e.x <= canvas.clientWidth && e.y <= canvas.clientHeight;
      if (down || inCanvas) { if (t && t.onMove) t.onMove(app, e); }
      if (inCanvas) {
        var d = AI.viewT.toDoc(app, e.x, e.y);
        var co = document.getElementById('st-coords');
        if (co) co.textContent = U.fmt(d.x) + ' , ' + U.fmt(d.y);
      }
    });

    U.on(window, 'mouseup', function (ev) {
      if (!down) return;
      down = false;
      var e = evt(ev, false);
      e.down = false;
      var t = T.current(app);
      if (t && t.onUp) t.onUp(app, e);
      AI.ui.syncAll(app);
    });

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

    C.bind(app);
    T.buildToolbar(app);
    AI.ui.init(app);
    AI.keymap.install(app);
    bindCanvas();
    bindRulers();

    U.on(window, 'resize', function () { app.resize(); });
    new ResizeObserver(function () { app.resize(); }).observe(document.getElementById('canvas-wrap'));

    U.on(window, 'beforeunload', function (ev) {
      if (!app.dirty) return;
      ev.preventDefault();
      ev.returnValue = '';
    });

    app.resize();
    AI.viewT.fitArtboard(app);
    T.setTool(app, 'select', true);
    AI.ui.syncAll(app);
    app.invalidate();
    draw();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.AI);
