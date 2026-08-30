/* =========================================================================
   autosave.js — 자동 저장 · 복구
   -------------------------------------------------------------------------
   일러스트레이터의 [환경 설정 > 파일 처리 > 복구 정보 자동 저장] 에 대응한다.
   브라우저가 닫히거나 탭이 사라져도 마지막 작업이 남도록, 열려 있는 문서를
   주기적으로 localStorage 에 적어 둔다. 다음에 열면 복구할지 물어본다.

   저장을 누른 문서(수정 없음)만 남아 있으면 기록을 지운다 — 복구할 것이
   없는데 물어보는 것만큼 성가신 일이 없다.
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, Model = AI.model;
  var AS = AI.autosave = {};

  AS.KEY = 'illymolly.autosave.v1';
  AS.DEFAULT_MIN = 2;          /* 기본 2분 — 일러스트레이터와 같다 */
  var timer = null, lastJson = null, disabled = false;

  function store() {
    try {
      if (typeof localStorage === 'undefined') return null;
      return localStorage;
    } catch (e) { return null; }        /* 쿠키·저장소 차단 */
  }

  /* ---------------- 쓰기 ---------------- */
  /* 이미지 데이터 URL 은 통째로 담기엔 너무 클 수 있다.
     용량이 넘치면 이미지를 빼고 다시 시도한다 (모양은 남고 그림만 빠진다). */
  function snapshot(app, dropImages) {
    var list = AI.docs ? AI.docs.list(app) : [{ doc: app.doc, dirty: app.dirty }];
    return {
      v: 1, at: Date.now(), index: app.docIndex || 0, trimmed: !!dropImages,
      docs: list.map(function (s) {
        var d = s.doc;
        if (dropImages) {
          d = U.deepCopy(d);
          (function walk(items) {
            items.forEach(function (it) {
              if (it.type === 'image' && it.src && it.src.length > 2048) it.src = '';
              if (it.children) walk(it.children);
            });
          })(d.layers);
        }
        return { doc: d, dirty: !!s.dirty };
      })
    };
  }

  AS.save = function (app, force) {
    var ls = store();
    if (!ls || disabled) return false;
    AI.docs && AI.docs.sync(app);
    var list = AI.docs ? AI.docs.list(app) : [{ doc: app.doc, dirty: app.dirty }];
    var anyDirty = list.some(function (s) { return s.dirty; });
    if (!anyDirty) { AS.clear(); return false; }

    var json;
    try { json = JSON.stringify(snapshot(app, false)); }
    catch (e) { return false; }
    if (!force && json === lastJson) return false;    /* 달라진 게 없으면 건너뛴다 */

    try {
      ls.setItem(AS.KEY, json);
      lastJson = json;
      return true;
    } catch (e) {
      /* 용량 초과 — 이미지를 빼고 한 번 더 */
      try {
        var lite = JSON.stringify(snapshot(app, true));
        ls.setItem(AS.KEY, lite);
        lastJson = null;
        return true;
      } catch (e2) {
        disabled = true;
        U.toast('문서가 너무 커서 자동 저장을 멈춥니다 — 직접 저장해 주세요');
        try { ls.removeItem(AS.KEY); } catch (e3) { }
        return false;
      }
    }
  };

  AS.clear = function () {
    var ls = store();
    lastJson = null;
    if (ls) { try { ls.removeItem(AS.KEY); } catch (e) { } }
  };

  AS.read = function () {
    var ls = store();
    if (!ls) return null;
    try {
      var raw = ls.getItem(AS.KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.docs || !o.docs.length) return null;
      return o;
    } catch (e) { return null; }
  };

  /* ---------------- 타이머 ---------------- */
  AS.intervalMs = function (app) {
    var m = (app.prefs && app.prefs.autoSaveMin) || AS.DEFAULT_MIN;
    return Math.max(10, m * 60) * 1000;
  };

  AS.start = function (app) {
    AS.stop();
    if (app.prefs && app.prefs.autoSave === false) return;
    timer = setInterval(function () { AS.save(app); }, AS.intervalMs(app));
  };
  AS.stop = function () {
    if (timer) clearInterval(timer);
    timer = null;
  };
  AS.restart = function (app) { AS.start(app); };

  /* ---------------- 복구 ---------------- */
  AS.recover = function (app, snap) {
    var docs = snap.docs.filter(function (s) { return s.doc && s.doc.layers; });
    if (!docs.length) return 0;
    docs.forEach(function (s, i) {
      var d = s.doc;
      if (AI.io && AI.io.normalizeDoc) AI.io.normalizeDoc(d);
      d.name = (d.name || '무제-1') + (/\[복구됨\]$/.test(d.name || '') ? '' : ' [복구됨]');
      if (i === 0 && !docHasContent(app.doc) && AI.docs.count(app) === 1) {
        /* 비어 있는 첫 문서는 복구본으로 대신한다 */
        app.setDoc(d);
        app.history.reset(d, '복구');
        AI.viewT.fitArtboard(app);
      } else {
        AI.docs.add(app, d, { label: '복구' });
      }
      app.dirty = true;                 /* 복구본은 아직 저장되지 않았다 */
      if (AI.docs.current(app)) AI.docs.current(app).dirty = true;
    });
    AI.docs.refresh(app);
    return docs.length;
  };

  function docHasContent(doc) {
    if (!doc || !doc.layers) return false;
    return doc.layers.some(function (l) { return l.children && l.children.length; });
  }

  /* 부팅 시 한 번 — 남은 기록이 있으면 물어보고, 없으면 그냥 타이머만 건다 */
  AS.init = function (app) {
    var snap = AS.read();
    AS.start(app);

    /* 탭을 떠날 때는 마지막 상태를 반드시 남긴다 */
    if (typeof window !== 'undefined') {
      U.on(window, 'beforeunload', function () { AS.save(app, true); });
      U.on(document, 'visibilitychange', function () {
        if (document.visibilityState === 'hidden') AS.save(app, true);
      });
    }
    if (!snap) return false;

    var names = snap.docs.map(function (s) { return (s.doc && s.doc.name) || '무제'; });
    var when = new Date(snap.at || Date.now());
    AI.dialog.open({
      title: '문서 복구',
      fields: [
        { id: 'i1', type: 'info', label: '저장되지 않은 문서가 남아 있습니다 (' + names.length + '개).' },
        { id: 'i2', type: 'info', label: names.join(' · ') },
        { id: 'i3', type: 'info', label: '마지막 자동 저장: ' + when.toLocaleString() +
            (snap.trimmed ? ' (용량 때문에 이미지는 빠졌습니다)' : '') }
      ],
      buttons: [
        { id: 'discard', label: '버리기' },
        { id: 'ok', label: '복구', primary: true }
      ],
      onDone: function (v, btn) {
        if (btn === 'discard') { AS.clear(); U.toast('복구 기록을 버렸습니다'); return; }
        var n = AS.recover(app, snap);
        AS.clear();
        U.toast(n + '개 문서를 복구했습니다 — 다른 이름으로 저장해 두세요');
      },
      onCancel: function () { AS.clear(); }
    });
    return true;
  };
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
