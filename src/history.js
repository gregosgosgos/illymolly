/* =========================================================================
   history.js — 실행 취소 / 다시 실행 (스냅샷 방식)
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util;

  function History(limit) {
    this.limit = limit || 120;
    this.stack = [];
    this.index = -1;
    this.pending = null;
  }
  History.prototype = {
    reset: function (state, label) {
      this.stack = [{ label: label || '문서 열기', state: U.deepCopy(state) }];
      this.index = 0;
      this.pending = null;
    },
    /* 변경 직전에 호출 — 같은 이름으로 연속 호출되면 첫 스냅샷만 유지 */
    begin: function (label, state) {
      if (this.pending) return;
      this.pending = { label: label, state: U.deepCopy(state) };
    },
    /* 변경 후 확정 */
    commit: function () {
      if (!this.pending) return;
      this.stack.length = this.index + 1;
      this.stack.push(this.pending);
      /* stack[i] 는 "i 번째 동작 직후" 가 아니라 "직전" 이므로
         현재 상태는 별도 push 되지 않고 undo 시 top 을 꺼내 쓴다. */
      this.index = this.stack.length - 1;
      if (this.stack.length > this.limit) { this.stack.shift(); this.index--; }
      this.redoStack = [];
      this.pending = null;
    },
    abort: function () { this.pending = null; },

    canUndo: function () { return this.index >= 0; },
    canRedo: function () { return this.redoStack && this.redoStack.length > 0; },

    undoLabel: function () { return this.index >= 0 ? this.stack[this.index].label : null; },
    redoLabel: function () { return (this.redoStack && this.redoStack.length) ? this.redoStack[this.redoStack.length - 1].label : null; },

    undo: function (current) {
      if (this.index < 0) return null;
      var entry = this.stack[this.index--];
      (this.redoStack || (this.redoStack = [])).push({ label: entry.label, state: U.deepCopy(current) });
      return U.deepCopy(entry.state);
    },
    redo: function (current) {
      if (!this.redoStack || !this.redoStack.length) return null;
      var entry = this.redoStack.pop();
      this.stack[++this.index] = { label: entry.label, state: U.deepCopy(current) };
      this.stack.length = this.index + 1;
      return U.deepCopy(entry.state);
    },
    clearRedo: function () { this.redoStack = []; }
  };

  AI.History = History;
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
