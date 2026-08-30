/* =========================================================================
   tools/base.js — 도구 공통 기반
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util;
  var T = AI.tools = AI.tools || {};
  T.list = {};
  T.order = [];

  T.define = function (def) {
    T.list[def.id] = def;
    T.order.push(def.id);
    return def;
  };
  T.get = function (id) { return T.list[id]; };
  T.current = function (app) { return T.list[app.tool]; };

  T.setTool = function (app, id, silent) {
    if (!T.list[id]) return;
    if (app.tool === id) return;
    var prev = T.list[app.tool];
    if (prev && prev.deactivate) prev.deactivate(app);
    app.prevTool = app.tool;
    app.tool = id;
    var t = T.list[id];
    if (t.activate) t.activate(app);
    AI.cursors.set(app, AI.cursors.forTool(id) || t.cursor || 'default');
    /* 숨은 도구를 골라도 툴바 슬롯이 항상 현재 도구를 보여주도록 */
    if (T.syncSlotFor && T.buildToolbar) { T.syncSlotFor(app, id); T.buildToolbar(app); }
    AI.ui && AI.ui.syncTool && AI.ui.syncTool(app);
    app.invalidate();
    if (!silent) U.toast(t.name);
  };

  /* 기본 도구 동작 (no-op) */
  T.base = {
    cursor: 'default',
    onDown: function () { }, onMove: function () { }, onUp: function () { },
    onDblClick: function () { }, drawUI: null
  };

  T.mk = function (def) {
    var o = Object.create(T.base);
    for (var k in def) if (Object.prototype.hasOwnProperty.call(def, k)) o[k] = def[k];
    return T.define(o);
  };

  /* Shift 각도 제한 */
  T.constrainAngle = function (ax, ay, bx, by, stepDeg) {
    var step = U.rad(stepDeg || 45);
    var a = Math.atan2(by - ay, bx - ax);
    var d = U.dist(ax, ay, bx, by);
    a = Math.round(a / step) * step;
    return { x: ax + Math.cos(a) * d, y: ay + Math.sin(a) * d };
  };
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
