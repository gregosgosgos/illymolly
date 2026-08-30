/* =========================================================================
   cursors.js — Illustrator 스타일 커서 (SVG data-URI)
   ========================================================================= */
(function (AI) {
  'use strict';
  var C = AI.cursors = {};
  var cache = Object.create(null);

  function mk(body, hx, hy, size) {
    var s = size || 24;
    var key = body + '|' + hx + '|' + hy + '|' + s;
    if (cache[key]) return cache[key];
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + s + '" height="' + s + '" viewBox="0 0 ' + s + ' ' + s + '">' + body + '</svg>';
    var v = 'url("data:image/svg+xml;utf8,' + encodeURIComponent(svg) + '") ' + hx + ' ' + hy + ', default';
    cache[key] = v;
    return v;
  }

  /* 검은 채움 + 흰 외곽 = 어떤 배경에서도 보이는 Illustrator 방식 */
  function ol(d, fill) {
    return '<path d="' + d + '" fill="' + (fill || '#000') + '" stroke="#fff" stroke-width="1.4" stroke-linejoin="round" paint-order="stroke"/>';
  }
  function badge(g) {
    return '<g transform="translate(14.5,1.5)">' +
      '<path d="M0 0h9v9H0z" fill="#fff" opacity="0"/>' + g + '</g>';
  }
  function bStroke(d) {
    return '<path d="' + d + '" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="' + d + '" fill="none" stroke="#000" stroke-width="1.4" stroke-linecap="round"/>';
  }

  var ARROW = 'M4 2.5 L4 18.5 L8.1 14.4 L10.9 20.4 L13.4 19.2 L10.7 13.5 L16 13.1 Z';
  var CROSS = 'M12 3 V21 M3 12 H21';

  /* ---------- 기본 커서 ---------- */
  C.arrow = function () { return mk(ol(ARROW, '#000'), 4, 2); };
  C.arrowWhite = function () { return mk(ol(ARROW, '#fff'), 4, 2); };
  C.arrowPlus = function () { return mk(ol(ARROW, '#000') + badge(bStroke('M4.5 0.5v8 M0.5 4.5h8')), 4, 2); };
  C.arrowGroup = function () {
    return mk(ol(ARROW, '#fff') + '<path d="M15 15h6v6h-6z" fill="#fff" stroke="#000" stroke-width="1.2"/>', 4, 2);
  };

  function crosshair(extra) {
    return mk('<path d="' + CROSS + '" stroke="#fff" stroke-width="3.4" fill="none"/>' +
      '<path d="' + CROSS + '" stroke="#000" stroke-width="1.3" fill="none"/>' + (extra || ''), 12, 12);
  }
  C.cross = function () { return crosshair(); };
  C.crossShape = function (glyph) { return crosshair(glyph); };

  var GL = {
    rect: '<rect x="15" y="15" width="8" height="6" fill="#fff" stroke="#000" stroke-width="1.1"/>',
    ellipse: '<ellipse cx="19" cy="18" rx="4" ry="3" fill="#fff" stroke="#000" stroke-width="1.1"/>',
    polygon: '<path d="M19 14.5l4 3-1.6 4.5h-4.8L15 17.5z" fill="#fff" stroke="#000" stroke-width="1.1"/>',
    star: '<path d="M19 14l1.2 2.6 2.8.3-2.1 1.9.6 2.8L19 20.2 16.5 21.6l.6-2.8L15 16.9l2.8-.3z" fill="#fff" stroke="#000" stroke-width="1"/>',
    line: '<path d="M15 22 L23 14" stroke="#fff" stroke-width="3"/><path d="M15 22 L23 14" stroke="#000" stroke-width="1.2"/>'
  };

  /* ---------- 펜 ---------- */
  var NIB = 'M2.2 21.8 L5 13.2 L11.6 4.2 L15.4 7.1 L9.6 17.2 Z';
  C.pen = function (state) {
    var b = '';
    if (state === 'new') b = badge(bStroke('M0.6 0.6l7.8 7.8 M8.4 0.6l-7.8 7.8'));
    else if (state === 'add') b = badge(bStroke('M4.5 0.5v8 M0.5 4.5h8'));
    else if (state === 'del') b = badge(bStroke('M0.5 4.5h8'));
    else if (state === 'close') b = badge('<circle cx="4.5" cy="4.5" r="3.4" fill="none" stroke="#fff" stroke-width="3"/><circle cx="4.5" cy="4.5" r="3.4" fill="none" stroke="#000" stroke-width="1.3"/>');
    else if (state === 'join') b = badge(bStroke('M7.5 0.8L1.5 8.2'));
    return mk(ol(NIB) + '<path d="M2.2 21.8 L4 19" stroke="#fff" stroke-width="1"/>' + b, 2, 22);
  };

  /* ---------- 문자 ---------- */
  C.type = function () {
    return mk('<path d="M12 4v16 M9 4h6 M9 20h6" stroke="#fff" stroke-width="3.4" fill="none"/>' +
      '<path d="M12 4v16 M9 4h6 M9 20h6" stroke="#000" stroke-width="1.3" fill="none"/>', 12, 12);
  };

  /* ---------- 브러시 / 연필 / 지우개 ---------- */
  C.brush = function () {
    return mk(ol('M2 22 C6 22 6.5 18.5 8.4 16.6 L12 20.2 C10.1 22.1 6 22 2 22 Z') +
      ol('M9.6 15.4 L18.4 5.4 L21 8 L11.4 17.2 Z'), 2, 22);
  };
  C.pencil = function () {
    return mk(ol('M2 22 L3.4 17.6 L16.4 4.6 L19.4 7.6 L6.4 20.6 Z') +
      '<path d="M14.6 6.4 L17.6 9.4" stroke="#fff" stroke-width="1.2"/>', 2, 22);
  };
  C.eraser = function () {
    return mk(ol('M7.4 21 L2 15.6 L13.6 4 L19 9.4 Z') +
      '<path d="M7.4 21 H20" stroke="#fff" stroke-width="3"/><path d="M7.4 21 H20" stroke="#000" stroke-width="1.3"/>', 2, 16);
  };
  C.scissors = function () {
    return mk('<g stroke="#fff" stroke-width="3" fill="none"><circle cx="5.5" cy="19" r="2.6"/><circle cx="14.5" cy="19" r="2.6"/><path d="M7.4 17 L18 4 M12.6 17 L2 4"/></g>' +
      '<g stroke="#000" stroke-width="1.3" fill="none"><circle cx="5.5" cy="19" r="2.6"/><circle cx="14.5" cy="19" r="2.6"/><path d="M7.4 17 L18 4 M12.6 17 L2 4"/></g>', 10, 4);
  };

  /* ---------- 변형 ---------- */
  C.rotate = function () {
    return crosshair('<g transform="translate(14,14)">' +
      '<path d="M0.5 7 A6.5 6.5 0 1 1 7 8.5" fill="none" stroke="#fff" stroke-width="3"/>' +
      '<path d="M0.5 7 A6.5 6.5 0 1 1 7 8.5" fill="none" stroke="#000" stroke-width="1.3"/>' +
      '</g>');
  };
  C.scaleT = function () {
    return crosshair('<g><path d="M15 22 L22 15 M22 15 h-4 M22 15 v4" stroke="#fff" stroke-width="3" fill="none"/>' +
      '<path d="M15 22 L22 15 M22 15 h-4 M22 15 v4" stroke="#000" stroke-width="1.3" fill="none"/></g>');
  };
  C.reflectT = function () {
    return crosshair('<g><path d="M19 13 v10 M15.5 15 l-2.5 3 2.5 3 M22.5 15 l2.5 3 -2.5 3" stroke="#fff" stroke-width="3" fill="none"/>' +
      '<path d="M19 13 v10 M15.5 15 l-2.5 3 2.5 3 M22.5 15 l2.5 3 -2.5 3" stroke="#000" stroke-width="1.2" fill="none"/></g>');
  };

  /* ---------- 기타 ---------- */
  C.eyedropper = function () {
    return mk(ol('M2 22 L3 18.4 L12.6 8.8 L15.2 11.4 L5.6 21 Z') +
      ol('M13.6 7.8 L17.4 4 A2.2 2.2 0 0 1 20.5 7.1 L16.6 10.8 Z'), 2, 22);
  };
  C.gradientT = function () {
    return crosshair('<g><rect x="14" y="15" width="9" height="7" fill="#fff" stroke="#000" stroke-width="1"/>' +
      '<rect x="14.6" y="15.6" width="7.8" height="5.8" fill="url(%23g)"/></g>' +
      '<defs><linearGradient id="g"><stop offset="0" stop-color="%23fff"/><stop offset="1" stop-color="%23000"/></linearGradient></defs>');
  };
  C.zoomIn = function () {
    return mk('<g fill="none" stroke="#fff" stroke-width="3.4"><circle cx="10" cy="10" r="6.4"/><path d="M14.8 14.8 L21 21"/><path d="M10 7v6 M7 10h6"/></g>' +
      '<g fill="none" stroke="#000" stroke-width="1.4"><circle cx="10" cy="10" r="6.4"/><path d="M14.8 14.8 L21 21"/><path d="M10 7v6 M7 10h6"/></g>', 10, 10);
  };
  C.zoomOut = function () {
    return mk('<g fill="none" stroke="#fff" stroke-width="3.4"><circle cx="10" cy="10" r="6.4"/><path d="M14.8 14.8 L21 21"/><path d="M7 10h6"/></g>' +
      '<g fill="none" stroke="#000" stroke-width="1.4"><circle cx="10" cy="10" r="6.4"/><path d="M14.8 14.8 L21 21"/><path d="M7 10h6"/></g>', 10, 10);
  };
  C.hand = function (grab) {
    var d = grab
      ? 'M5 14 V9.6 a1.5 1.5 0 0 1 3 0 V8.4 a1.5 1.5 0 0 1 3 0 V8.8 a1.5 1.5 0 0 1 3 0 V9.6 a1.5 1.5 0 0 1 3 0 V15 c0 3.4-2.6 6-6 6H11 c-1.6 0-2.6-.6-3.6-1.8 L5 16z'
      : 'M5 16 V7 a1.6 1.6 0 0 1 3.2 0 V4.6 a1.6 1.6 0 0 1 3.2 0 V7 a1.6 1.6 0 0 1 3.2 0 V8.4 a1.6 1.6 0 0 1 3.2 0 V15 c0 3.6-2.6 6.4-6.2 6.4H11 c-1.8 0-2.8-.8-3.8-2.2 L5 17.4z';
    return mk(ol(d, '#fff'), 12, 12);
  };
  C.artboard = function () { return crosshair(GL.rect); };
  C.wand = function () {
    return mk(ol('M3 21 L14 10 L16 12 L5 23 Z') +
      '<g stroke="#fff" stroke-width="2.6" fill="none"><path d="M16 2v5 M13.5 4.5h5 M19 8l2 2"/></g>' +
      '<g stroke="#000" stroke-width="1.2" fill="none"><path d="M16 2v5 M13.5 4.5h5 M19 8l2 2"/></g>', 3, 21);
  };

  /* ---------- 도구별 매핑 ---------- */
  var MAP = {
    select: C.arrow, groupselect: C.arrowGroup, directselect: C.arrowWhite,
    magicwand: C.wand,
    pen: function () { return C.pen('new'); },
    addanchor: function () { return C.pen('add'); },
    delanchor: function () { return C.pen('del'); },
    convert: function () { return C.pen('close'); },
    type: C.type, typearea: C.type,
    line: function () { return C.crossShape(GL.line); },
    rect: function () { return C.crossShape(GL.rect); },
    roundrect: function () { return C.crossShape(GL.rect); },
    ellipse: function () { return C.crossShape(GL.ellipse); },
    polygon: function () { return C.crossShape(GL.polygon); },
    star: function () { return C.crossShape(GL.star); },
    brush: C.brush, blob: C.brush, pencil: C.pencil, smooth: C.pencil,
    eraser: C.eraser, scissors: C.scissors,
    rotate: C.rotate, scale: C.scaleT, reflect: C.reflectT, shear: C.scaleT,
    freetransform: C.arrow,
    gradient: C.gradientT, eyedropper: C.eyedropper,
    artboard: C.artboard, zoom: C.zoomIn, hand: C.hand
  };

  C.forTool = function (id) { return MAP[id] ? MAP[id]() : null; };

  /* 현재 커서 지정 (중복 대입 방지) */
  C.set = function (app, css) {
    if (!css) css = 'default';
    if (app.__cursor === css) return;
    app.__cursor = css;
    app.canvas.style.cursor = css;
  };

  /* 바운딩 박스 핸들 방향에 맞춘 크기 조절/회전 커서 */
  C.resizeAt = function (angleDeg) {
    var a = ((angleDeg % 180) + 180) % 180;
    if (a < 22.5 || a >= 157.5) return 'ew-resize';
    if (a < 67.5) return 'nwse-resize';
    if (a < 112.5) return 'ns-resize';
    return 'nesw-resize';
  };
  C.rotateAt = function (angleDeg) {
    var body = '<g transform="rotate(' + (angleDeg || 0) + ' 12 12)">' +
      '<path d="M6 15 A7 7 0 0 1 18 15" fill="none" stroke="#fff" stroke-width="3.4"/>' +
      '<path d="M6 15 A7 7 0 0 1 18 15" fill="none" stroke="#000" stroke-width="1.4"/>' +
      '<path d="M4.4 12.4 L6.2 16.4 L9.6 14.2 Z" fill="#000" stroke="#fff" stroke-width="1"/>' +
      '<path d="M19.6 12.4 L17.8 16.4 L14.4 14.2 Z" fill="#000" stroke="#fff" stroke-width="1"/>' +
      '</g>';
    return mk(body, 12, 12);
  };
})(window.AI);
