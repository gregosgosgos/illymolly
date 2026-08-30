/* =========================================================================
   color.js — 색상 변환 / 페인트(칠·획) 정의
   ========================================================================= */
(function (AI) {
  'use strict';
  var C = AI.color = {};

  C.hexToRgb = function (h) {
    h = String(h || '#000').trim();
    if (h[0] === '#') h = h.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length !== 6 || /[^0-9a-f]/i.test(h)) return { r: 0, g: 0, b: 0 };
    var n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };
  C.rgbToHex = function (r, g, b) {
    function h(v) { v = Math.round(AI.util.clamp(v, 0, 255)); return (v < 16 ? '0' : '') + v.toString(16); }
    return '#' + h(r) + h(g) + h(b);
  };
  C.rgbToHsb = function (r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, h = 0;
    if (d) {
      if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h: h, s: mx ? d / mx : 0, b: mx };
  };
  C.hsbToRgb = function (h, s, v) {
    h = ((h % 360) + 360) % 360;
    var c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c, r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
  };
  C.toCss = function (hex, alpha) {
    var c = C.hexToRgb(hex);
    if (alpha == null || alpha >= 1) return hex;
    return 'rgba(' + Math.round(c.r) + ',' + Math.round(c.g) + ',' + Math.round(c.b) + ',' + AI.util.round(alpha, 3) + ')';
  };
  C.mix = function (h1, h2, t) {
    var a = C.hexToRgb(h1), b = C.hexToRgb(h2);
    return C.rgbToHex(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t);
  };

  /* ---------------- Paint ----------------
     {type:'none'}
     {type:'solid', color:'#rrggbb', alpha:1}
     {type:'linear'|'radial', stops:[{t,color,alpha}], angle, ...}          */
  C.none = function () { return { type: 'none' }; };
  C.solid = function (hex, alpha) { return { type: 'solid', color: hex || '#000000', alpha: alpha == null ? 1 : alpha }; };
  C.gradient = function (kind, a, b) {
    return {
      type: kind || 'linear',
      stops: [{ t: 0, color: a || '#ffffff', alpha: 1 }, { t: 1, color: b || '#000000', alpha: 1 }],
      angle: 0, /* 도 단위 (linear) */
      cx: 0.5, cy: 0.5, r: 0.5 /* radial: 바운딩박스 정규화 좌표 */
    };
  };
  C.isPaint = function (p) { return p && p.type && p.type !== 'none'; };
  C.paintPreviewCss = function (p) {
    if (!p || p.type === 'none') return 'linear-gradient(45deg,transparent 45%,#f00 45%,#f00 55%,transparent 55%),#fff';
    if (p.type === 'solid') return C.toCss(p.color, p.alpha);
    var s = p.stops.map(function (st) { return C.toCss(st.color, st.alpha) + ' ' + (st.t * 100) + '%'; }).join(',');
    if (p.type === 'radial') return 'radial-gradient(circle,' + s + ')';
    return 'linear-gradient(' + (90 + (p.angle || 0)) + 'deg,' + s + ')';
  };

  C.SWATCHES = [
    '#000000', '#ffffff', '#7f7f7f', '#c0c0c0',
    '#ff0000', '#ff7f00', '#ffff00', '#00ff00',
    '#00ffff', '#0000ff', '#7f00ff', '#ff00ff',
    '#e6194b', '#f58231', '#ffe119', '#3cb44b',
    '#46f0f0', '#4363d8', '#911eb4', '#f032e6',
    '#800000', '#9a6324', '#808000', '#469990',
    '#000075', '#fabebe', '#ffd8b1', '#aaffc3'
  ];
})(window.AI);
