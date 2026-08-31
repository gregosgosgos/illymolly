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

  /* ---------------- 라이브 모퉁이 위젯 ----------------
     선택 도구와 직접 선택 도구가 똑같이 쓰므로 여기에 둔다.
     직접 선택 도구에서 앵커를 일부만 골랐다면 그 모퉁이만 바뀐다. */
  T.cornerDown = function (app, e, hit) {
    var U2 = AI.util, E = AI.edit;
    var it = hit.item;
    var targets = E.cornerTargets(app, it);
    /* Alt+클릭 — 둥글게 → 둥글게(내부) → 모따기 순으로 돌린다 (일러스트레이터와 같다) */
    if (e.alt) {
      app.history.begin('모퉁이 종류', app.doc);
      var kind = E.setCornerKind(it, targets, null);
      app.history.commit();
      app.invalidate();
      AI.ui && AI.ui.syncAll && AI.ui.syncAll(app);
      U2.toast('모퉁이: ' + AI.model.CORNER_LABEL[kind] +
        (targets.length < 4 ? ' (' + targets.length + '개)' : ''));
      return null;
    }
    app.history.begin('모퉁이 반경', app.doc);
    return {
      kind: 'corner', it: it, pt: hit.pt, targets: targets, moved: false,
      r0: AI.model.rectRadii(it.shape)[hit.pt.i] || 0
    };
  };

  T.cornerDrag = function (app, st, e) {
    var U2 = AI.util, M2 = AI.mat, E = AI.edit;
    st.moved = true;
    var it = st.it;
    var inv = M2.invert(AI.model.worldMatrix(app.doc, it));
    var d0 = AI.viewT.toDoc(app, e.x, e.y);
    var lp = M2.apply(inv, d0.x, d0.y);
    /* 모퉁이 점에서 얼마나 안쪽으로 끌었는가 — 두 축 중 작은 쪽이 반경이다 */
    var r = Math.min(Math.abs(lp.x - st.pt.cx), Math.abs(lp.y - st.pt.cy));
    if (e.shift) r = Math.round(r);
    var applied = E.setCornerRadius(it, st.targets, r);
    app.hudText = '반경 ' + U2.fmt(applied) + (st.targets.length < 4 ? ' · 모퉁이 ' + st.targets.length + '개' : '');
    app.invalidate();
    AI.ui && AI.ui.buildToolOptions && AI.ui.buildToolOptions(app);
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
