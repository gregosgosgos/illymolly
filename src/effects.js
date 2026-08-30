/* =========================================================================
   effects.js — 효과 (비파괴)
   -------------------------------------------------------------------------
   Illustrator 의 [효과] 메뉴에 대응한다. 아이템에 effects 배열로 쌓이며
   렌더 시점에 적용되고, 원본 패스는 그대로 남는다.

     it.effects = [
       { type:'blur',   radius:6 },                                  // 가우시안 흐림
       { type:'shadow', dx:4, dy:4, blur:6, color:'#000', alpha:.5 }, // 그림자 만들기
       { type:'glow',   blur:10, color:'#ffcc00', alpha:.8 }          // 광선 (외부)
     ]
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, Col = AI.color;
  var FX = AI.effects = {};

  FX.DEFS = {
    blur: {
      name: '가우시안 흐림', menu: '흐림 효과',
      make: function () { return { type: 'blur', radius: 6 }; },
      label: function (e) { return '가우시안 흐림 ' + U.fmt(e.radius) + 'pt'; }
    },
    shadow: {
      name: '그림자 만들기', menu: '스타일화',
      make: function () { return { type: 'shadow', dx: 4, dy: 4, blur: 5, color: '#000000', alpha: 0.5 }; },
      label: function (e) { return '그림자 ' + U.fmt(e.dx) + ',' + U.fmt(e.dy) + ' / ' + U.fmt(e.blur) + 'pt'; }
    },
    glow: {
      name: '외부 광선', menu: '스타일화',
      make: function () { return { type: 'glow', blur: 10, color: '#ffd166', alpha: 0.9 }; },
      label: function (e) { return '외부 광선 ' + U.fmt(e.blur) + 'pt'; }
    }
  };

  FX.create = function (type) {
    var d = FX.DEFS[type];
    return d ? d.make() : null;
  };
  FX.label = function (e) {
    var d = FX.DEFS[e.type];
    return d ? d.label(e) : e.type;
  };

  FX.list = function (it) { return (it && it.effects) || []; };
  FX.has = function (it) { return !!(it && it.effects && it.effects.length); };

  /* 효과가 그림을 얼마나 밖으로 밀어내는가 (문서 단위) */
  FX.padding = function (it) {
    var p = 0;
    FX.list(it).forEach(function (e) {
      if (e.type === 'blur') p = Math.max(p, e.radius * 3);
      else if (e.type === 'shadow') p = Math.max(p, e.blur * 3 + Math.abs(e.dx) + Math.abs(e.dy));
      else if (e.type === 'glow') p = Math.max(p, e.blur * 3);
    });
    return p;
  };

  /* canvas ctx.filter / CSS filter 문자열 — scale 은 화면 배율 */
  FX.filterString = function (it, scale) {
    var s = scale == null ? 1 : scale;
    var out = [];
    FX.list(it).forEach(function (e) {
      if (e.type === 'blur') {
        out.push('blur(' + U.round(e.radius * s, 3) + 'px)');
      } else if (e.type === 'shadow') {
        out.push('drop-shadow(' + U.round(e.dx * s, 3) + 'px ' + U.round(e.dy * s, 3) + 'px ' +
          U.round(e.blur * s, 3) + 'px ' + Col.toCss(e.color, e.alpha) + ')');
      } else if (e.type === 'glow') {
        out.push('drop-shadow(0px 0px ' + U.round(e.blur * s, 3) + 'px ' + Col.toCss(e.color, e.alpha) + ')');
      }
    });
    return out.join(' ');
  };

  /* SVG <filter> 정의 — io.js 가 defs 에 넣는다 */
  FX.svgFilter = function (it, id) {
    var list = FX.list(it);
    if (!list.length) return null;
    var body = [], src = 'SourceGraphic';
    var pad = FX.padding(it);
    list.forEach(function (e, i) {
      if (e.type === 'blur') {
        body.push('<feGaussianBlur in="' + src + '" stdDeviation="' + U.round(e.radius / 2, 3) + '" result="f' + i + '"/>');
        src = 'f' + i;
      } else if (e.type === 'shadow') {
        body.push('<feDropShadow in="' + src + '" dx="' + U.round(e.dx, 3) + '" dy="' + U.round(e.dy, 3) +
          '" stdDeviation="' + U.round(e.blur / 2, 3) + '" flood-color="' + e.color +
          '" flood-opacity="' + U.round(e.alpha, 3) + '" result="f' + i + '"/>');
        src = 'f' + i;
      } else if (e.type === 'glow') {
        body.push('<feDropShadow in="' + src + '" dx="0" dy="0" stdDeviation="' + U.round(e.blur / 2, 3) +
          '" flood-color="' + e.color + '" flood-opacity="' + U.round(e.alpha, 3) + '" result="f' + i + '"/>');
        src = 'f' + i;
      }
    });
    if (!body.length) return null;
    /* 효과가 잘리지 않도록 필터 영역을 넉넉히 */
    return '<filter id="' + id + '" x="-50%" y="-50%" width="200%" height="200%" ' +
      'filterUnits="objectBoundingBox" color-interpolation-filters="sRGB">' + body.join('') + '</filter>';
  };

  /* 아이템에 효과 추가 / 제거 / 갱신 */
  FX.add = function (it, type) {
    var e = FX.create(type);
    if (!e) return null;
    it.effects = it.effects || [];
    it.effects.push(e);
    return e;
  };
  FX.removeAt = function (it, i) {
    if (!it.effects) return;
    it.effects.splice(i, 1);
    if (!it.effects.length) delete it.effects;
  };
  FX.clear = function (it) { delete it.effects; };
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
