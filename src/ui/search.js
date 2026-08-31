/* =========================================================================
   ui/search.js — 명령 검색 (일러스트레이터 앱 바의 [검색])
   -------------------------------------------------------------------------
   메뉴가 열두 갈래에 명령이 백 몇 개다. 어디 있는지 알면 빠르지만, 모르면
   메뉴를 하나씩 열어 봐야 한다. 그래서 이름 몇 글자로 바로 찾아 실행한다.

   찾을 수 있는 것: 명령 · 도구 · 패널.
   결과에는 **어느 메뉴 밑에 있는지**와 **지금 먹히는 단축키**를 함께 적는다.
   한 번 쓰고 끝내는 게 아니라 다음엔 메뉴에서 바로 찾게 하려는 것이다.

   한글 초성(ㄱㄴㄷ)으로도 찾는다 — "ㅋㅍㅍ" 로 [컴파운드 패스] 가 나온다.
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, C = AI.commands, T = AI.tools;
  var UI = AI.ui = AI.ui || {};

  var app = null, box = null, input = null, list = null;
  var items = null, shown = [], cursor = 0, recent = [];
  var MAX = 9;

  /* ---------------- 한글 초성 ---------------- */
  var CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ',
    'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
  function initials(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xAC00 && c <= 0xD7A3) out += CHO[Math.floor((c - 0xAC00) / 588)];
      else out += s[i];
    }
    return out;
  }

  /* ---------------- 찾을 거리 모으기 ---------------- */
  /* 명령이 어느 메뉴에 들어 있는지 — 결과에 길을 적어 준다 */
  function menuPaths() {
    var path = {};
    (C.MENUS || []).forEach(function (m) {
      (m.items || []).forEach(function (id) {
        if (id === '-') return;
        if (id && typeof id === 'object' && id.items) {
          id.items.forEach(function (sub) {
            if (sub !== '-') path[sub] = m.title + ' > ' + id.label;
          });
          return;
        }
        path[id] = m.title;
      });
    });
    return path;
  }

  function build() {
    var path = menuPaths();
    var out = [];
    Object.keys(C.defs).forEach(function (id) {
      var d = C.defs[id];
      if (!d.label) return;
      out.push({
        kind: 'cmd', id: id,
        label: (d.label2 ? d.label2(app) : d.label).replace(/\.\.\.$/, ''),
        where: path[id] || '명령',
        key: d.key || null,
        run: function () { C.run(id); }
      });
    });
    Object.keys(T.list || {}).forEach(function (id) {
      var t = T.list[id];
      if (!t.name) return;
      out.push({
        kind: 'tool', id: 'tool:' + id,
        label: t.name, where: '도구',
        key: t.key ? String(t.key).toUpperCase() : null,
        run: function () { T.setTool(app, id); }
      });
    });
    out.forEach(function (o) {
      o.lc = o.label.toLowerCase();
      o.ini = initials(o.label);
    });
    return out;
  }

  /* ---------------- 점수 ----------------
     앞에서 맞을수록 위로. 그다음이 "지금 쓸 수 있는가" — 쓸 수 없는 것이
     먼저 나오면 헛걸음이 된다. 길이는 마지막 저울일 뿐이다. */
  function match(o, q, qi) {
    var i = o.lc.indexOf(q);
    if (i === 0) return 1000;
    if (i > 0) return 700 - i * 4;
    var j = o.ini.indexOf(qi);
    if (qi.length > 1 && j === 0) return 520;
    if (qi.length > 1 && j > 0) return 380 - j * 4;
    /* 띄엄띄엄이라도 순서대로 들어 있으면 (fuzzy) */
    var k = 0;
    for (var n = 0; n < o.lc.length && k < q.length; n++) if (o.lc[n] === q[k]) k++;
    return k === q.length ? 120 : -1;
  }
  function usable(o) {
    if (o.kind !== 'cmd') return true;
    var d = C.defs[o.id];
    return !(d && d.enabled && !d.enabled(app));
  }
  function score(o, q, qi) {
    var m = match(o, q, qi);
    if (m < 0) return -1;
    /* 최근에 쓴 것을 조금 올린다 — 손에 익은 순서가 된다 */
    var r = recent.indexOf(o.id);
    return m * 4 + (usable(o) ? 300 : 0) + (r >= 0 ? 60 - r * 5 : 0) - o.label.length;
  }

  function search(q) {
    if (!items) items = build();
    q = String(q || '').trim().toLowerCase();
    if (!q) {
      /* 빈 칸이면 최근에 쓴 것 — 없으면 자주 쓰는 것 몇 개 */
      var seed = recent.length ? recent : ['group', 'ungroup', 'undo', 'clipMake', 'compoundMake', 'exportPng'];
      return seed.map(function (id) {
        return items.filter(function (o) { return o.id === id; })[0];
      }).filter(Boolean).slice(0, MAX);
    }
    var qi = initials(q);
    return items.map(function (o) { return { o: o, s: score(o, q, qi) }; })
      .filter(function (r) { return r.s > 0; })
      .sort(function (a, b) { return b.s - a.s; })
      .slice(0, MAX)
      .map(function (r) { return r.o; });
  }

  /* ---------------- 그리기 ---------------- */
  function render() {
    if (!shown.length) {
      list.innerHTML = '<div class="cs-empty">찾는 것이 없습니다</div>';
      list.hidden = false;
      return;
    }
    list.innerHTML = shown.map(function (o, i) {
      var d = o.kind === 'cmd' ? C.defs[o.id] : null;
      var off = d && d.enabled && !d.enabled(app);
      var key = o.key ? '<span class="cs-key">' + U.esc(AI.keymap.display(o.key)) + '</span>' : '';
      return '<div class="cs-row' + (i === cursor ? ' on' : '') + (off ? ' off' : '') + '" data-i="' + i + '">' +
        '<span class="cs-label">' + U.esc(o.label) + '</span>' +
        '<span class="cs-where">' + U.esc(o.where) + '</span>' + key + '</div>';
    }).join('');
    list.hidden = false;
    U.qa('.cs-row', list).forEach(function (el) {
      U.on(el, 'mouseenter', function () { cursor = +el.dataset.i; paint(); });
      U.on(el, 'mousedown', function (ev) { ev.preventDefault(); pick(+el.dataset.i); });
    });
  }
  function paint() {
    U.qa('.cs-row', list).forEach(function (el, i) { el.classList.toggle('on', i === cursor); });
  }

  function pick(i) {
    var o = shown[i];
    if (!o) return;
    var d = o.kind === 'cmd' ? C.defs[o.id] : null;
    if (d && d.enabled && !d.enabled(app)) {
      U.toast('"' + o.label + '" 은(는) 지금 쓸 수 없습니다' +
        (app.sel.length ? '' : ' — 오브젝트를 먼저 선택해 보세요'));
      return;
    }
    recent = [o.id].concat(recent.filter(function (x) { return x !== o.id; })).slice(0, MAX);
    close();
    o.run();
    /* 어디 있는 명령인지 알려 준다 — 다음엔 메뉴에서 바로 찾도록 */
    if (o.where && o.where !== '도구') U.toast(o.label + ' — [' + o.where + ']');
  }

  UI.openSearch = function (a) {
    app = a || app;
    if (!input) return;
    items = null;                       /* 라벨·단축키가 달라졌을 수 있다 */
    input.value = '';
    input.focus();
    shown = search('');
    cursor = 0;
    render();
  };
  function close() {
    if (!list) return;
    list.hidden = true;
    input.value = '';
    input.blur();
  }
  UI.closeSearch = close;

  UI.initSearch = function (a) {
    app = a;
    box = document.getElementById('cmdsearch');
    input = document.getElementById('cs-input');
    list = document.getElementById('cs-list');
    if (!box || !input) return;

    U.on(input, 'focus', function () { UI.openSearch(app); });
    U.on(input, 'input', function () {
      shown = search(input.value);
      cursor = 0;
      render();
    });
    U.on(input, 'keydown', function (ev) {
      if (ev.key === 'ArrowDown') { cursor = Math.min(cursor + 1, shown.length - 1); paint(); ev.preventDefault(); }
      else if (ev.key === 'ArrowUp') { cursor = Math.max(cursor - 1, 0); paint(); ev.preventDefault(); }
      else if (ev.key === 'Enter') { pick(cursor); ev.preventDefault(); }
      else if (ev.key === 'Escape') { close(); ev.preventDefault(); }
      ev.stopPropagation();
    });
    U.on(input, 'blur', function () { setTimeout(function () { if (list) list.hidden = true; }, 120); });
  };
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
