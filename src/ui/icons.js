/* =========================================================================
   ui/icons.js — 패널 · 버튼용 SVG 아이콘 팩
   -------------------------------------------------------------------------
   · 모두 16×16 그리드에 그린다 (툴바 아이콘과 같은 격자).
   · 색은 currentColor 로만 지정한다 — 버튼의 hover · 선택 · 비활성 상태가
     색을 바꾸면 아이콘이 자동으로 따라오게 하기 위해서다.
   · 면으로 채우는 아이콘은 이름 뒤에 'Fill' 을 붙여 stroke 계열과 구분한다.

   쓰는 법:  UI.icon('alignLeft')          -> '<svg …>…</svg>'
             UI.iconBtn('alignLeft', {…})  -> '<button class="btn ico">…</button>'
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util;
  var UI = AI.ui = AI.ui || {};

  /* d = 스트로크 경로, f = 채움 경로 */
  var P = {
    /* ---- 정렬 ---- */
    alignLeft: { d: 'M2.5 1.5v13', f: 'M4.5 3.5h9v3.2h-9zM4.5 9.3h5.6v3.2H4.5z' },
    alignHCenter: { d: 'M8 1.5v13', f: 'M3.5 3.5h9v3.2h-9zM5.4 9.3h5.2v3.2H5.4z' },
    alignRight: { d: 'M13.5 1.5v13', f: 'M2.5 3.5h9v3.2h-9zM5.9 9.3h5.6v3.2H5.9z' },
    alignTop: { d: 'M1.5 2.5h13', f: 'M3.5 4.5h3.2v9H3.5zM9.3 4.5h3.2v5.6H9.3z' },
    alignVCenter: { d: 'M1.5 8h13', f: 'M3.5 3.5h3.2v9H3.5zM9.3 5.4h3.2v5.2H9.3z' },
    alignBottom: { d: 'M1.5 13.5h13', f: 'M3.5 2.5h3.2v9H3.5zM9.3 5.9h3.2v5.6H9.3z' },
    distH: { d: 'M1.5 1.5v13M14.5 1.5v13', f: 'M6.4 4h3.2v8H6.4z' },
    distV: { d: 'M1.5 1.5h13M1.5 14.5h13', f: 'M4 6.4h8v3.2H4z' },

    /* ---- 획: 단면 ----
       굵은 막대가 패스, 세로 파선이 패스의 '끝점'.
       끝을 어떻게 마감하느냐가 세 아이콘의 차이다. */
    capButt: {
      f: 'M1.5 6h7v4h-7z',
      extra: '<path d="M8.5 2v12" stroke-dasharray="2.4 2" stroke-width="1.1" opacity=".65"/>'
    },
    capRound: {
      f: 'M1.5 6h7a2 2 0 0 1 0 4h-7z',
      extra: '<path d="M8.5 2v12" stroke-dasharray="2.4 2" stroke-width="1.1" opacity=".65"/>'
    },
    capSquare: {
      f: 'M1.5 6h9v4h-9z',
      extra: '<path d="M8.5 2v12" stroke-dasharray="2.4 2" stroke-width="1.1" opacity=".65"/>'
    },
    /* ---- 획: 모퉁이 ---- */
    joinMiter: { d: 'M3.5 13.5V4.5h9', w: 3.4, join: 'miter', cap: 'butt' },
    joinRound: { d: 'M3.5 13.5V7.5a3 3 0 0 1 3-3h6', w: 3.4, join: 'round', cap: 'butt' },
    joinBevel: { d: 'M3.5 13.5V6.6L5.6 4.5h6.9', w: 3.4, join: 'bevel', cap: 'butt' },
    /* ---- 획: 정렬 ----
       옅은 면이 도형의 안쪽, 세로 파선이 그 경계.
       굵은 띠가 경계의 어느 쪽에 놓이는지가 세 아이콘의 차이다. */
    strokeCenter: {
      f: 'M6 4h4v8H6z',
      extra: '<path d="M8 8.5h6.5v6H8z" fill="currentColor" stroke="none" opacity=".22"/>' +
        '<path d="M8 1v14" stroke-dasharray="2.2 1.8" stroke-width="1" opacity=".85"/>'
    },
    strokeInside: {
      f: 'M8 4h4v8H8z',
      extra: '<path d="M8 8.5h6.5v6H8z" fill="currentColor" stroke="none" opacity=".22"/>' +
        '<path d="M8 1v14" stroke-dasharray="2.2 1.8" stroke-width="1" opacity=".85"/>'
    },
    strokeOutside: {
      f: 'M4 4h4v8H4z',
      extra: '<path d="M8 8.5h6.5v6H8z" fill="currentColor" stroke="none" opacity=".22"/>' +
        '<path d="M8 1v14" stroke-dasharray="2.2 1.8" stroke-width="1" opacity=".85"/>'
    },
    swapArrows: { d: 'M3 5.5h8M9 3.2l2.4 2.3L9 7.8M13 10.5H5M7 8.2 4.6 10.5 7 12.8' },

    /* ---- 모양(Appearance) ---- */
    addFill: { d: 'M12 11.5h4M14 9.5v4', f: 'M2.5 2.5h8v8h-8z' },
    addStroke: { d: 'M2.5 3h8v8h-8zM12 11.5h4M14 9.5v4', w: 1.6 },
    moveUp: { d: 'M8 12.5V4M4.5 7.5 8 4l3.5 3.5' },
    moveDown: { d: 'M8 3.5V12M4.5 8.5 8 12l3.5-3.5' },
    trash: { d: 'M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.7 9h4.6l.7-9M7 7v4M9 7v4' },
    expand: { d: 'M2.5 2.5h5v5h-5zM8.5 8.5h5v5h-5zM7.5 5h6M10.5 8V2' },

    /* ---- 효과 ---- */
    fxBlur: { d: 'M8 2.5a5.5 5.5 0 1 0 0 11', extra: '<circle cx="8" cy="8" r="5.5" stroke-dasharray="1.4 1.6"/>' },
    fxShadow: { d: 'M2.5 2.5h8v8h-8z', extra: '<path d="M5.5 5.5h8v8h-8z" fill="currentColor" opacity=".35" stroke="none"/>' },
    fxGlow: { d: 'M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5M8 1v2.2M8 12.8V15M1 8h2.2M12.8 8H15M3.4 3.4l1.6 1.6M11 11l1.6 1.6M12.6 3.4 11 5M5 11l-1.6 1.6' },
    fxRepeat: { d: 'M12.5 6.5A5 5 0 1 0 13 10M12.5 2.5v4h-4' },
    fxClear: { d: 'M2.5 2.5h8v8h-8z', extra: '<path d="M11 11l3.5 3.5M14.5 11 11 14.5" stroke-width="1.6"/>' },

    /* ---- 대지 ---- */
    plus: { d: 'M8 3.5v9M3.5 8h9' },
    duplicate: { d: 'M2.5 2.5h8v8h-8z', extra: '<path d="M5.5 5.5h8v8h-8z"/>' },
    gear: {
      d: 'M8 5.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8',
      extra: '<path d="M8 1.4l.9 1.6 1.8-.3.3 1.8 1.6.9-.9 1.6.9 1.6-1.6.9-.3 1.8-1.8-.3L8 14.6l-.9-1.6-1.8.3-.3-1.8-1.6-.9.9-1.6-.9-1.6 1.6-.9.3-1.8 1.8.3z"/>'
    },
    fitSelection: { d: 'M1.5 4V1.5H4M12 1.5h2.5V4M14.5 12v2.5H12M4 14.5H1.5V12', extra: '<path d="M5.5 5.5h5v5h-5z" stroke-dasharray="1.6 1.4"/>' },
    fitArtwork: { d: 'M1.5 1.5h13v13h-13z', extra: '<path d="M4 4h3.4v3.4H4zM8.6 8.6H12V12H8.6z" fill="currentColor" stroke="none" opacity=".8"/>' },
    rearrange: { d: 'M1.5 1.5h5.5v5.5H1.5zM9 1.5h5.5v5.5H9zM1.5 9h5.5v5.5H1.5zM9 9h5.5v5.5H9z' },
    fitAll: { d: 'M2.5 2.5h11v11h-11z', extra: '<path d="M5 5h6v6H5z" stroke-dasharray="1.6 1.4"/>' },

    /* ---- 심볼 · 패턴 ---- */
    symbol: { d: 'M8 2 9.9 6.1 14.3 6.6 11 9.6l.9 4.3L8 11.8l-3.9 2.1.9-4.3L1.7 6.6l4.4-.5z' },
    breakLink: { d: 'M6.4 9.6 4.8 11.2a2.6 2.6 0 0 1-3.7-3.7l1.6-1.6M9.6 6.4l1.6-1.6a2.6 2.6 0 0 1 3.7 3.7l-1.6 1.6', extra: '<path d="M6.8 2.2 7.4 4M2.2 6.8 4 7.4M13.8 9.2 12 8.6M9.2 13.8 8.6 12" stroke-width="1.1"/>' },
    pattern: { d: 'M1.5 1.5h13v13h-13z', extra: '<circle cx="5" cy="5" r="1.4" fill="currentColor" stroke="none"/><circle cx="11" cy="5" r="1.4" fill="currentColor" stroke="none"/><circle cx="5" cy="11" r="1.4" fill="currentColor" stroke="none"/><circle cx="11" cy="11" r="1.4" fill="currentColor" stroke="none"/>' },
    brush: { d: 'M3 13.2c2.6 0 3.2-2.2 4.4-3.6M8.6 8.2l4.8-5.4 1.4 1.4-5.4 4.8z' },

    /* ---- 레이어 ---- */
    eye: { d: 'M1.4 8S3.8 3.8 8 3.8 14.6 8 14.6 8 12.2 12.2 8 12.2 1.4 8 1.4 8', extra: '<circle cx="8" cy="8" r="1.9"/>' },
    eyeOff: { d: 'M2.6 5.4C1.9 6.3 1.4 8 1.4 8S3.8 12.2 8 12.2c1.2 0 2.2-.3 3-.8M12.2 10C13.4 9.1 14.6 8 14.6 8S12.2 3.8 8 3.8c-.6 0-1.1.1-1.6.2', extra: '<path d="M2.4 2.4l11.2 11.2"/>' },
    lock: { d: 'M3.6 7.2h8.8v6.2H3.6zM5.6 7.2V5.2a2.4 2.4 0 0 1 4.8 0v2' },
    unlock: { d: 'M3.6 7.2h8.8v6.2H3.6zM5.6 7.2V5.2a2.4 2.4 0 0 1 4.6-.8' },
    newLayer: { d: 'M2.5 5.5h7v7h-7z', extra: '<path d="M12.5 2.5v6M9.5 5.5h6"/>' },
    newSublayer: { d: 'M1.5 2h6.5v3.5H1.5z',
      extra: '<path d="M4 5.5v5h2.5" opacity=".85"/><path d="M6.5 8.5h5.5V12H6.5z"/><path d="M13.5 12.5v3M12 14h3"/>' },
    merge: { d: 'M2 3.5h4.5c2.4 0 2.6 4.5 5 4.5h2.5M2 12.5h4.5c2.4 0 2.6-4.5 5-4.5h2.5',
      extra: '<path d="M11.5 5.8 14 8l-2.5 2.2"/>' },
    target: { d: 'M8 3.2a4.8 4.8 0 1 0 0 9.6 4.8 4.8 0 0 0 0-9.6' },
    targetOn: { d: 'M8 3.2a4.8 4.8 0 1 0 0 9.6 4.8 4.8 0 0 0 0-9.6', extra: '<circle cx="8" cy="8" r="2.3" fill="currentColor" stroke="none"/>' },
    pencil: { d: 'M2.6 13.4l.6-2.6L10.4 3.6l2 2-7.2 7.2z', extra: '<path d="M9.4 4.6l2 2"/>' },
    close: { d: 'M4 4l8 8M12 4l-8 8' },
    caretDown: { f: 'M4 6.2h8L8 11z' },
    caretRight: { f: 'M6.2 4v8L11 8z' },

    /* ---- 정돈 · 이동 ---- */
    /* 겹친 두 사각형 중 진한 쪽이 앞.
       맨 앞 · 맨 뒤에는 '더 갈 데가 없다'는 뜻으로 끝선을 덧붙인다. */
    toFront: {
      d: 'M8 6.5h6.5v6.5H8z',
      extra: '<path d="M1.5 1.5h13" stroke-width="1.6"/>' +
        '<path d="M3.5 4h6.5v6.5H3.5z" fill="currentColor" stroke="none"/><path d="M3.5 4h6.5v6.5H3.5z"/>'
    },
    forward: {
      d: 'M8 7.5h6v6H8z',
      extra: '<path d="M2.5 2.5h6v6h-6z" fill="currentColor" stroke="none"/><path d="M2.5 2.5h6v6h-6z"/>'
    },
    backward: {
      d: 'M2.5 2.5h6v6h-6z',
      extra: '<path d="M8 7.5h6v6H8z" fill="currentColor" stroke="none"/><path d="M8 7.5h6v6H8z"/>'
    },
    toBack: {
      d: 'M3.5 4h6.5v6.5H3.5z',
      extra: '<path d="M1.5 14.5h13" stroke-width="1.6"/>' +
        '<path d="M8 6.5h6.5v6.5H8z" fill="currentColor" stroke="none"/><path d="M8 6.5h6.5v6.5H8z"/>'
    },
    reverse: { d: 'M3 5.5h9M9.6 3.1 12 5.5 9.6 7.9M13 10.5H4M6.4 8.1 4 10.5l2.4 2.4' },
    link: { d: 'M6.6 9.4 5 11a2.5 2.5 0 0 1-3.5-3.5l1.6-1.6M9.4 6.6 11 5a2.5 2.5 0 0 1 3.5 3.5l-1.6 1.6M6 10l4-4' },
    /* ---- 대지 이동 ---- */
    navFirst: { d: 'M3.5 3.5v9', f: 'M12.5 3.5v9L6 8z' },
    navPrev: { f: 'M11 3.5v9L4.5 8z' },
    navNext: { f: 'M5 3.5v9L11.5 8z' },
    navLast: { d: 'M12.5 3.5v9', f: 'M3.5 3.5v9L10 8z' },

    /* ---- 문단 정렬 ---- */
    textLeft: { f: 'M2 3h12v1.8H2zM2 6.6h8v1.8H2zM2 10.2h12V12H2zM2 13.8h7v1.4H2z' },
    textCenter: { f: 'M2 3h12v1.8H2zM4 6.6h8v1.8H4zM2 10.2h12V12H2zM4.5 13.8h7v1.4h-7z' },
    textRight: { f: 'M2 3h12v1.8H2zM6 6.6h8v1.8H6zM2 10.2h12V12H2zM7 13.8h7v1.4H7z' },

    /* ---- 색 ---- */
    none: { d: 'M2.5 2.5h11v11h-11z', extra: '<path d="M3 13 13 3" stroke="#e04b4b" stroke-width="1.6"/>' },

    /* ---- 패스 ---- */
    offsetPath: { d: 'M5 5h6v6H5z', extra: '<path d="M2.5 2.5h11v11h-11z" stroke-dasharray="1.8 1.4"/>' },
    simplify: { d: 'M2 12C5 3.5 11 12.5 14 4', extra: '<circle cx="2" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="14" cy="4" r="1.3" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none"/>' },
    recolor: {
      d: 'M8 1.6a6.4 6.4 0 1 0 0 12.8c.9 0 1.4-.6 1.4-1.3 0-.9-.9-1.3-.9-2 0-.6.5-1 1.1-1h1.3a3.5 3.5 0 0 0 3.5-3.5C14.4 3.6 11.5 1.6 8 1.6',
      extra: '<circle cx="5" cy="5.6" r="1" fill="currentColor" stroke="none"/><circle cx="8.4" cy="4.4" r="1" fill="currentColor" stroke="none"/><circle cx="4.2" cy="9.4" r="1" fill="currentColor" stroke="none"/>'
    }
  };

  /* 아이콘 이름 -> SVG 문자열 */
  UI.icon = function (name, size) {
    var p = P[name];
    if (!p) return '';
    var s = size || 14;
    var body = '';
    if (p.f) body += '<path d="' + p.f + '" fill="currentColor" stroke="none"/>';
    if (p.d) {
      body += '<path d="' + p.d + '"' +
        (p.w ? ' stroke-width="' + p.w + '"' : '') +
        (p.cap ? ' stroke-linecap="' + p.cap + '"' : '') +
        (p.join ? ' stroke-linejoin="' + p.join + '"' : '') + '/>';
    }
    if (p.extra) body += p.extra;
    return '<svg class="ic" viewBox="0 0 16 16" width="' + s + '" height="' + s + '" aria-hidden="true">' + body + '</svg>';
  };

  UI.hasIcon = function (name) { return !!P[name]; };

  /* 명령 id 에 붙은 단축키를 툴팁 뒤에 덧붙인다 */
  UI.tip = function (text, cmdId) {
    var d = cmdId && AI.commands.defs[cmdId];
    var k = d && d.key ? ' (' + (AI.keymap ? AI.keymap.display(d.key) : d.key) + ')' : '';
    return U.esc(text + k);
  };

  /* 버튼 마크업 헬퍼
     opt: { icon, label, cmd, data:{key:val}, cls, wide } */
  UI.btn = function (opt) {
    var attrs = [];
    if (opt.data) for (var k in opt.data) attrs.push('data-' + k + '="' + U.esc(opt.data[k]) + '"');
    if (opt.cmd) attrs.push('data-cmd="' + U.esc(opt.cmd) + '"');
    var ico = opt.icon ? UI.icon(opt.icon) : '';
    var cls = 'btn' + (opt.label ? '' : ' ico') + (opt.cls ? ' ' + opt.cls : '');
    return '<button class="' + cls + '" title="' + UI.tip(opt.title || opt.label || '', opt.cmd) + '" ' +
      attrs.join(' ') + '>' + ico + (opt.label ? '<span>' + U.esc(opt.label) + '</span>' : '') + '</button>';
  };

  /* 붙은 세그먼트 컨트롤 (일러스트레이터의 옵션 그룹) */
  UI.seg = function (items, dataKey) {
    return '<div class="seg">' + items.map(function (it) {
      return '<button class="seg-b" ' + dataKey + '="' + U.esc(it.value) + '" title="' + U.esc(it.title) + '">' +
        (it.icon ? UI.icon(it.icon) : U.esc(it.label || '')) + '</button>';
    }).join('') + '</div>';
  };
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
