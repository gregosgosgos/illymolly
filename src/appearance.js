/* =========================================================================
   appearance.js — 모양(Appearance) 스택
   -------------------------------------------------------------------------
   일러스트레이터의 [모양] 패널에 대응한다. 한 오브젝트가 칠과 획을 여러 겹
   가질 수 있고, 겹의 순서가 그리는 순서(배열 0 = 맨 아래)다.

     it.appearance = [
       { kind:'fill',   paint:{...} },
       { kind:'stroke', stroke:{...} },
       { kind:'stroke', stroke:{...} }     // 위에 겹친 두 번째 획
     ]

   appearance 가 없으면 it.fill / it.stroke 로부터 (칠 아래, 획 위) 기본 2겹을
   합성한다 — 즉 기존 문서는 그대로 동작한다.

   appearance 가 있을 때도 it.fill 은 **맨 아래 칠**, it.stroke 는 **맨 위 획**을
   그대로 비춘다. 색상 패널 · 스포이드 · 패스파인더 · 히트 테스트 · API 처럼
   "대표 칠/획" 하나만 보는 코드가 계속 옳게 동작하도록 하기 위해서다.
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, Col = AI.color, Model = AI.model;
  var AP = AI.appearance = {};

  function isPaint(p) { return !!p && p.type && p.type !== 'none'; }

  /* 이 아이템이 모양 스택을 쓸 수 있는가 (그룹·이미지는 칠/획을 갖지 않는다) */
  AP.supports = function (it) {
    return !!it && (it.type === 'path' || it.type === 'text');
  };

  /* 사용자가 직접 스택을 편집한 상태인가 */
  AP.isCustom = function (it) {
    return !!(it && it.appearance && it.appearance.length);
  };

  /* 그리기용 정규화 목록 — 항상 아래→위 순서 */
  AP.list = function (it) {
    if (!it) return [];
    if (AP.isCustom(it)) return it.appearance;
    var out = [];
    if (isPaint(it.fill)) out.push({ kind: 'fill', paint: it.fill });
    if (it.stroke && it.stroke.type !== 'none' && it.stroke.width > 0) {
      out.push({ kind: 'stroke', stroke: it.stroke });
    }
    return out;
  };

  AP.fills = function (it) {
    return AP.list(it).filter(function (e) { return e.kind === 'fill'; });
  };
  AP.strokes = function (it) {
    return AP.list(it).filter(function (e) { return e.kind === 'stroke'; });
  };

  /* 획 두께의 최댓값 — 바운딩 여백 계산에 쓴다 */
  AP.maxStrokeWidth = function (it) {
    var w = 0;
    AP.strokes(it).forEach(function (e) {
      if (e.stroke && e.stroke.type !== 'none') w = Math.max(w, e.stroke.width || 0);
    });
    return w;
  };

  /* 히트 테스트용 — 스택 어딘가에 칠이 있으면 내부를 잡는다 */
  AP.hasFill = function (it) {
    return AP.list(it).some(function (e) { return e.kind === 'fill' && isPaint(e.paint); });
  };

  /* ---------------- 편집 ---------------- */
  /* 기존 fill/stroke 를 스택으로 물질화한다 (편집 시작 시 1회) */
  function materialize(it) {
    if (AP.isCustom(it)) return it.appearance;
    /* 실제로 그려지는 겹만 담는다 — '없음' 획이 유령 행으로 남지 않게 */
    var arr = AP.list(it).map(function (e) {
      return e.kind === 'fill'
        ? { kind: 'fill', paint: U.deepCopy(e.paint) }
        : { kind: 'stroke', stroke: U.deepCopy(e.stroke) };
    });
    if (!arr.length) arr.push({ kind: 'fill', paint: U.deepCopy(it.fill || Col.none()) });
    it.appearance = arr;
    return arr;
  }
  AP.materialize = materialize;

  /* 스택을 바꾼 뒤 대표 칠/획을 다시 맞춘다 */
  AP.sync = function (it) {
    if (!AP.isCustom(it)) return;
    var arr = it.appearance;
    var bottomFill = null, topStroke = null;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].kind === 'fill' && !bottomFill) bottomFill = arr[i];
      if (arr[i].kind === 'stroke') topStroke = arr[i];
    }
    it.fill = bottomFill ? bottomFill.paint : Col.none();
    it.stroke = topStroke ? topStroke.stroke : Model.defaultStroke();
    /* 기본 구성(칠 1 [+ 획 1])으로 되돌아왔으면 스택을 없애 문서를 가볍게 유지 */
    if (arr.length === 1 && arr[0].kind === 'fill') delete it.appearance;
    else if (arr.length === 2 && arr[0].kind === 'fill' && arr[1].kind === 'stroke') delete it.appearance;
  };

  /* 대표 칠/획이 밖에서 바뀌었을 때 스택에 반영 (색상 패널 · 스포이드 등) */
  AP.pushDown = function (it) {
    if (!AP.isCustom(it)) return;
    var arr = it.appearance, i;
    for (i = 0; i < arr.length; i++) {
      if (arr[i].kind === 'fill') { arr[i].paint = U.deepCopy(it.fill || Col.none()); break; }
    }
    for (i = arr.length - 1; i >= 0; i--) {
      if (arr[i].kind === 'stroke') { arr[i].stroke = U.deepCopy(it.stroke || Model.defaultStroke()); break; }
    }
  };

  AP.addFill = function (it, paint) {
    var arr = materialize(it);
    /* 새 칠은 기존 칠 바로 위에 — 일러스트레이터도 선택한 겹 위에 추가한다 */
    var at = 0;
    for (var i = 0; i < arr.length; i++) if (arr[i].kind === 'fill') at = i + 1;
    arr.splice(at, 0, { kind: 'fill', paint: U.deepCopy(paint || it.fill || Col.solid('#cccccc')) });
    AP.sync(it);
    return arr;
  };

  AP.addStroke = function (it, stroke) {
    var arr = materialize(it);
    var base = stroke || (it.stroke && it.stroke.type !== 'none' ? it.stroke : Model.mkStroke('#000000', 1));
    arr.push({ kind: 'stroke', stroke: U.deepCopy(base) });
    AP.sync(it);
    return arr;
  };

  AP.removeAt = function (it, i) {
    var arr = materialize(it);
    if (arr.length <= 1) return false;
    arr.splice(i, 1);
    AP.sync(it);
    return true;
  };

  AP.moveAt = function (it, i, dir) {
    var arr = materialize(it);
    var j = i + dir;
    if (j < 0 || j >= arr.length) return false;
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    AP.sync(it);
    return true;
  };

  AP.entry = function (it, i) {
    var arr = AP.list(it);
    return arr[i] || null;
  };

  AP.label = function (e) {
    if (e.kind === 'fill') {
      var p = e.paint;
      if (!p || p.type === 'none') return '칠: 없음';
      if (p.type === 'solid') return '칠: ' + p.color;
      return '칠: 그레이디언트';
    }
    var s = e.stroke;
    if (!s || s.type === 'none') return '획: 없음';
    return '획: ' + s.color + ' · ' + U.fmt(s.width) + 'pt';
  };

  /* ---------------- 모양 확장 ---------------- */
  /* 스택의 각 겹을 실제 오브젝트로 펼친다 (오브젝트 > 모양 확장).
     결과는 아래→위 순서의 아이템 배열이며, 원본의 변환을 그대로 물려받는다. */
  AP.expand = function (it) {
    if (!AP.supports(it) || !AP.isCustom(it)) return null;
    var arr = AP.list(it);
    if (arr.length < 2) return null;
    var out = arr.map(function (e) {
      var c = U.deepCopy(it);
      c.id = U.uid(it.type);
      delete c.appearance;
      delete c.effects;
      if (e.kind === 'fill') {
        c.fill = U.deepCopy(e.paint);
        c.stroke = Model.defaultStroke();
        c.name = '칠';
      } else {
        c.fill = Col.none();
        c.stroke = U.deepCopy(e.stroke);
        c.name = '획';
      }
      return c;
    });
    return out;
  };
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
