/* =========================================================================
   history.js — 실행 취소 / 다시 실행 (스냅샷 방식)
   -------------------------------------------------------------------------
   동작 직전의 문서를 통째로 담아 두는 스냅샷 방식이다. 단순하고 어떤 연산에도
   빠짐없이 들어맞지만, 그대로 두면 점 하나를 옮겨도 문서 전체가 새로 복사되어
   메모리가 금방 불어난다. 두 가지로 줄인다.

     1. 구조 공유 — 직전 스냅샷과 비교해 바뀌지 않은 가지는 그대로 다시 쓴다
        (U.copyShare). 저장된 스냅샷은 절대 수정되지 않으므로 안전하다.
     2. 메모리 예산 — 스냅샷마다 새로 만든 노드 수를 세어 두고, 총합이 예산을
        넘으면 오래된 것부터 버린다. 큰 문서에서는 취소 단계가 저절로 줄어든다.
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util;

  function History(limit, budget) {
    this.limit = limit || 120;
    /* 새로 만든 노드 수의 총합 상한 — 노드 하나를 대략 80바이트로 보면 약 200MB */
    this.budget = budget || 2500000;
    this.stack = [];
    this.index = -1;
    this.pending = null;
    this.redoStack = [];
    this.last = null;      /* 가장 최근에 저장한 상태 — 구조 공유의 기준 */
    this.cost = 0;         /* 살아 있는 스냅샷들이 새로 만든 노드 수의 합 */
  }

  History.prototype = {
    /* 직전 스냅샷과 가지를 나눠 가지는 복사 */
    snap: function (state) {
      var v = U.copyShare(state, this.last);
      this.last = v;
      this.lastCost = U.copyShare.allocated;
      return v;
    },
    entry: function (label, state) {
      return { label: label, state: this.snap(state), cost: this.lastCost };
    },

    reset: function (state, label) {
      this.last = null;
      this.cost = 0;
      this.stack = [this.entry(label || '문서 열기', state)];
      this.cost = this.stack[0].cost;
      this.index = 0;
      this.pending = null;
      this.redoStack = [];
    },

    /* 변경 직전에 호출 — 같은 이름으로 연속 호출되면 첫 스냅샷만 유지 */
    begin: function (label, state) {
      if (this.pending) return;
      this.pending = this.entry(label, state);
    },

    /* 변경 후 확정 */
    commit: function () {
      if (!this.pending) return;
      /* 잘려 나가는 뒷부분의 비용을 뺀다 */
      for (var i = this.index + 1; i < this.stack.length; i++) this.cost -= this.stack[i].cost;
      this.stack.length = this.index + 1;
      this.stack.push(this.pending);
      this.cost += this.pending.cost;
      /* stack[i] 는 "i 번째 동작 직후" 가 아니라 "직전" 이므로
         현재 상태는 별도 push 되지 않고 undo 시 top 을 꺼내 쓴다. */
      this.index = this.stack.length - 1;
      this.pending = null;
      this.dropRedo();
      this.trim();
    },
    abort: function () { this.pending = null; },

    /* 개수 · 메모리 예산을 넘으면 오래된 것부터 버린다 */
    trim: function () {
      while (this.stack.length > this.limit) {
        this.cost -= this.stack[0].cost;
        this.stack.shift();
        this.index--;
      }
      /* 예산을 넘으면 더 줄인다 — 다만 최근 몇 단계는 반드시 남긴다 */
      while (this.cost > this.budget && this.stack.length > 8) {
        this.cost -= this.stack[0].cost;
        this.stack.shift();
        this.index--;
      }
      if (this.index < -1) this.index = -1;
    },

    /* 진행 중이던 작업을 없던 일로 — 깊이를 잘라 낸다 (비용도 함께 정리) */
    truncateTo: function (len, index) {
      for (var i = len; i < this.stack.length; i++) this.cost -= this.stack[i].cost;
      this.stack.length = Math.max(0, len);
      this.index = Math.min(index == null ? this.index : index, this.stack.length - 1);
      if (this.index < -1) this.index = -1;
    },

    dropRedo: function () {
      for (var i = 0; i < this.redoStack.length; i++) this.cost -= this.redoStack[i].cost;
      this.redoStack = [];
    },

    canUndo: function () { return this.index >= 0; },
    canRedo: function () { return this.redoStack.length > 0; },

    undoLabel: function () { return this.index >= 0 ? this.stack[this.index].label : null; },
    redoLabel: function () { return this.redoStack.length ? this.redoStack[this.redoStack.length - 1].label : null; },

    undo: function (current) {
      if (this.index < 0) return null;
      var entry = this.stack[this.index--];
      var e2 = this.entry(entry.label, current);
      this.redoStack.push(e2);
      this.cost += e2.cost;
      return U.deepCopy(entry.state);
    },
    redo: function (current) {
      if (!this.redoStack.length) return null;
      var entry = this.redoStack.pop();
      this.cost -= entry.cost;
      var e2 = this.entry(entry.label, current);
      this.index++;
      if (this.stack[this.index]) this.cost -= this.stack[this.index].cost;
      this.stack[this.index] = e2;
      for (var i = this.index + 1; i < this.stack.length; i++) this.cost -= this.stack[i].cost;
      this.stack.length = this.index + 1;
      this.cost += e2.cost;
      return U.deepCopy(entry.state);
    },
    clearRedo: function () { this.dropRedo(); },

    /* 진단용 — 취소 단계 수와 대략의 메모리 */
    stats: function () {
      return {
        steps: this.stack.length,
        redo: this.redoStack.length,
        nodes: this.cost,
        approxMB: Math.round(this.cost * 80 / 1048576 * 10) / 10
      };
    }
  };

  AI.History = History;
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
