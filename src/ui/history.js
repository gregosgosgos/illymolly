/* =========================================================================
   ui/history.js — 작업 내역 패널
   -------------------------------------------------------------------------
   Ctrl+Z 를 몇 번 눌렀는지 세고 있는 사람은 없다. 어디까지 되돌렸는지 눈으로
   보고, 아무 지점이나 눌러 그리로 갈 수 있어야 마음 놓고 되돌린다.
   (일러스트레이터 25.3 의 [작업 내역] 패널과 같은 자리다.)

   History 의 stack[i] 는 "i 번째 동작 직전" 의 문서다. 그래서 목록의 r 번째
   줄에 서 있다는 것은 r 번째 동작까지 마친 상태를 뜻하고, 지금 자리(index)
   보다 위면 그 차이만큼 되돌리고, 아래면 그만큼 다시 실행하면 된다.
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util;
  var UI = AI.ui = AI.ui || {};

  /* 화면에 보일 줄들 — 되돌린 뒤 아직 살아 있는 "앞으로 갈 수 있는" 것도 함께 */
  UI.historyRows = function (a) {
    var h = a.history;
    var rows = [];
    for (var i = 0; i <= h.index && i < h.stack.length; i++) {
      rows.push({ r: i, label: h.stack[i].label, ahead: false });
    }
    for (var k = 1; k <= h.redoStack.length; k++) {
      rows.push({ r: h.index + k, label: h.redoStack[h.redoStack.length - k].label, ahead: true });
    }
    return rows;
  };

  /* r 번째 줄로 간다 — 모자란 만큼 되돌리거나 다시 실행한다 */
  UI.historyGoTo = function (a, r) {
    var h = a.history, n = 0;
    while (h.index > r && h.canUndo()) {
      var s = h.undo(a.doc);
      if (!s) break;
      a.setDoc(s); n++;
    }
    while (h.index < r && h.canRedo()) {
      var s2 = h.redo(a.doc);
      if (!s2) break;
      a.setDoc(s2); n++;
    }
    if (!n) return 0;
    a.invalidate();
    UI.syncAll(a);
    return n;
  };

  UI.buildHistory = function (a) {
    var p = document.getElementById('p-history');
    if (!p) return;
    var rows = UI.historyRows(a);
    var here = a.history.index;
    var st = a.history.stats();

    p.innerHTML =
      '<div class="hist-list">' +
      rows.map(function (o) {
        return '<div class="hist' + (o.r === here ? ' now' : '') + (o.ahead ? ' ahead' : '') +
          '" data-r="' + o.r + '" title="여기로 되돌리기">' +
          '<span class="hist-n">' + o.r + '</span>' +
          '<span class="hist-l">' + U.esc(o.label || '동작') + '</span></div>';
      }).join('') +
      '</div>' +
      '<div class="hist-foot">' + st.steps + '단계 · 약 ' + st.approxMB + 'MB' +
      (st.redo ? ' · 앞으로 ' + st.redo + '단계' : '') + '</div>';

    U.qa('.hist', p).forEach(function (el) {
      U.on(el, 'click', function () {
        var n = UI.historyGoTo(a, +el.dataset.r);
        if (n) U.toast(n + '단계 ' + (+el.dataset.r < here ? '되돌림' : '다시 실행'));
      });
    });

    /* 지금 자리가 목록 밖이면 그리로 스크롤 */
    UI.scrollIntoPanel(p.querySelector('.hist.now'));
  };
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
