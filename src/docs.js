/* =========================================================================
   docs.js — 다중 문서 (문서 탭)
   -------------------------------------------------------------------------
   일러스트레이터처럼 여러 문서를 한 창에서 탭으로 열어 둔다.

   한 문서에 딸린 것은 문서 자체만이 아니다. 실행 취소 스택 · 화면 위치와
   배율 · 선택 · 격리 모드 · 수정 여부가 모두 문서마다 따로 있어야 하므로
   이것들을 한 덩어리(세션)로 묶어 두고 탭을 바꿀 때 통째로 갈아 끼운다.

     app.docs      [ {doc, history, view, sel, selPts, isolation, dirty}, … ]
     app.docIndex  현재 세션

   app.doc / app.history / app.view … 는 그대로 두므로 나머지 코드는
   다중 문서를 전혀 몰라도 된다.
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, Model = AI.model;
  var DC = AI.docs = {};

  /* 현재 app 상태를 세션 하나로 담아 둔다 */
  function capture(app) {
    return {
      doc: app.doc,
      history: app.history,
      view: app.view,
      sel: app.sel,
      selPts: app.selPts,
      isolation: app.isolation,
      dirty: app.dirty,
      tool: app.tool
    };
  }

  function apply(app, s) {
    app.doc = s.doc;
    app.history = s.history;
    app.view = s.view;
    app.sel = s.sel;
    app.selPts = s.selPts;
    app.isolation = s.isolation || [];
    app.dirty = !!s.dirty;
  }

  /* 부팅 시 이미 만들어져 있는 문서를 첫 세션으로 등록한다 */
  DC.init = function (app) {
    if (app.docs && app.docs.length) return;
    app.docs = [capture(app)];
    app.docIndex = 0;
  };

  DC.list = function (app) { return app.docs || []; };
  DC.count = function (app) { return (app.docs || []).length; };
  DC.current = function (app) { return (app.docs || [])[app.docIndex || 0] || null; };

  /* 현재 app 상태를 세션에 되쓴다 — 탭을 바꾸기 직전과 UI 갱신 전에 부른다 */
  DC.sync = function (app) {
    if (!app.docs || !app.docs.length) return;
    app.docs[app.docIndex] = capture(app);
  };

  /* 이름 충돌을 피한다: 무제-1, 무제-2 … */
  DC.uniqueName = function (app, base) {
    var name = base || '무제-1';
    var taken = DC.list(app).map(function (s) { return s.doc.name; });
    if (taken.indexOf(name) < 0) return name;
    var m = /^(.*?)(\d+)$/.exec(name);
    var stem = m ? m[1] : name + '-', n = m ? +m[2] : 1;
    while (taken.indexOf(stem + n) >= 0) n++;
    return stem + n;
  };

  /* 새 문서를 새 탭으로 연다 */
  DC.add = function (app, doc, opt) {
    opt = opt || {};
    DC.init(app);
    DC.sync(app);
    doc.name = DC.uniqueName(app, doc.name);
    var hist = new AI.History(app.history ? app.history.limit : 150);
    hist.reset(doc, opt.label || '새 문서');
    app.docs.push({
      doc: doc, history: hist,
      view: { scale: 1, tx: 0, ty: 0 },
      sel: [], selPts: [], isolation: [], dirty: false
    });
    DC.switchTo(app, app.docs.length - 1, opt.fit !== false);
    return doc;
  };

  DC.switchTo = function (app, i, fit) {
    DC.init(app);
    if (i < 0 || i >= app.docs.length || i === app.docIndex) {
      if (i === app.docIndex) DC.refresh(app);
      return false;
    }
    /* 편집 중인 텍스트는 문서를 떠나기 전에 확정한다 */
    if (AI.tools && AI.tools.commitText) AI.tools.commitText(app);
    DC.sync(app);
    app.docIndex = i;
    apply(app, app.docs[i]);
    if (fit) AI.viewT.fitArtboard(app);
    DC.refresh(app);
    return true;
  };

  DC.next = function (app, dir) {
    var n = DC.count(app);
    if (n < 2) return false;
    return DC.switchTo(app, ((app.docIndex + (dir || 1)) % n + n) % n);
  };

  /* 탭 닫기 — 수정된 문서는 확인을 받는다 */
  DC.close = function (app, i, force) {
    DC.init(app);
    if (i == null) i = app.docIndex;
    var s = app.docs[i];
    if (!s) return false;
    if (i === app.docIndex) DC.sync(app), s = app.docs[i];
    if (s.dirty && !force && U.hasDOM && typeof window !== 'undefined' && window.confirm) {
      if (!window.confirm('"' + s.doc.name + '" 의 변경 내용을 저장하지 않고 닫을까요?')) return false;
    }
    app.docs.splice(i, 1);
    if (!app.docs.length) {
      /* 마지막 문서를 닫으면 일러스트레이터처럼 빈 새 문서가 남는다 */
      var d = Model.newDoc(800, 600);
      d.name = '무제-1';
      var h = new AI.History(150);
      h.reset(d, '새 문서');
      app.docs.push({ doc: d, history: h, view: { scale: 1, tx: 0, ty: 0 }, sel: [], selPts: [], isolation: [], dirty: false });
      app.docIndex = 0;
      apply(app, app.docs[0]);
      AI.viewT.fitArtboard(app);
      DC.refresh(app);
      return true;
    }
    if (app.docIndex >= app.docs.length) app.docIndex = app.docs.length - 1;
    else if (i < app.docIndex) app.docIndex--;
    apply(app, app.docs[app.docIndex]);
    DC.refresh(app);
    return true;
  };

  /* 저장되지 않은 문서가 하나라도 있는가 (창을 닫을 때 물어보려고) */
  DC.anyDirty = function (app) {
    DC.sync(app);
    return DC.list(app).some(function (s) { return s.dirty; });
  };

  DC.refresh = function (app) {
    app.invalidate();
    if (AI.ui && AI.ui.syncDocTabs) AI.ui.syncDocTabs(app);
    if (AI.ui && AI.ui.syncAll) AI.ui.syncAll(app);
  };
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
