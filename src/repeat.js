/* =========================================================================
   repeat.js — 오브젝트 > 반복 (방사형 · 격자 · 미러)
   -------------------------------------------------------------------------
   일러스트레이터의 [반복] 처럼, 오브젝트 하나를 규칙에 따라 여러 벌로 늘려
   보여 준다. 사본을 실제로 만들지 않는다 — 원본을 고치면 전부 따라 바뀌고,
   개수나 간격도 언제든 다시 조절된다 (라이브).

     it.repeat = { kind:'radial'|'grid'|'mirror', … }

   구현은 간단하다. 규칙을 "부모 좌표계에서의 행렬 목록" 하나로 바꿔 두고,
   그리기 · 히트 · 바운딩 · SVG · PDF 가 그 목록을 돌며 원본을 그대로 다시
   쓴다. 그래서 문자든 이미지든 그룹이든 종류를 가리지 않는다.

   행렬 목록의 첫 번째는 언제나 항등 — 원본 자리다.
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, M = AI.mat, R = AI.rect, Model = AI.model;
  var RP = AI.repeat = {};

  RP.LABEL = { radial: '방사형', grid: '격자', mirror: '미러' };

  RP.DEFS = {
    radial: {
      name: '방사형',
      params: [
        { id: 'count', label: '개수', min: 2, max: 200, def: 8 },
        { id: 'radius', label: '반지름', min: 0, def: 120, unit: 'pt' },
        { id: 'start', label: '시작 각도', def: 0, unit: '°' },
        { id: 'span', label: '벌어진 각도', min: 1, max: 360, def: 360, unit: '°' }
      ]
    },
    grid: {
      name: '격자',
      params: [
        { id: 'cols', label: '가로 개수', min: 1, max: 100, def: 3 },
        { id: 'rows', label: '세로 개수', min: 1, max: 100, def: 3 },
        { id: 'gapX', label: '가로 간격', def: 12, unit: 'pt' },
        { id: 'gapY', label: '세로 간격', def: 12, unit: 'pt' }
      ]
    },
    mirror: {
      name: '미러',
      params: [
        { id: 'angle', label: '축 각도', def: 90, unit: '°' },
        { id: 'gap', label: '축까지 거리', min: 0, def: 40, unit: 'pt' }
      ]
    }
  };

  RP.defaults = function (kind) {
    var o = { kind: kind };
    (RP.DEFS[kind] || RP.DEFS.radial).params.forEach(function (p) { o[p.id] = p.def; });
    return o;
  };

  RP.has = function (it) { return !!(it && it.repeat && RP.DEFS[it.repeat.kind]); };

  /* 원본 한 벌의 바운딩 (부모 좌표계) — 격자 간격과 미러 축의 기준.
     반복이 걸린 자기 자신을 다시 재면 끝없이 도므로 한 벌짜리 대역을 쓴다. */
  function localBox(it) {
    var b = AI.render.boundsM(RP.one(it), it.m || M.ident(), true, 1);
    return R.isEmpty(b) ? { x: 0, y: 0, x2: 1, y2: 1 } : b;
  }

  /* 부모 좌표계에서의 인스턴스 행렬들 (첫 번째는 항등) */
  RP.matrices = function (it) {
    if (!RP.has(it)) return null;
    var r = it.repeat, b = localBox(it);
    var cx = (b.x + b.x2) / 2, cy = (b.y + b.y2) / 2;
    var out = [M.ident()];

    if (r.kind === 'radial') {
      var n = U.clamp(Math.round(r.count == null ? 8 : r.count), 2, 200);
      var rad = r.radius == null ? 120 : r.radius;
      var span = r.span == null ? 360 : r.span;
      /* 한 바퀴면 마지막이 첫 번째와 겹치므로 n 등분, 아니면 n-1 등분 */
      var step = (Math.abs(span) >= 359.999 ? span / n : span / Math.max(1, n - 1));
      /* 회전 중심은 오브젝트에서 반지름만큼 떨어진 곳 */
      var ox = cx, oy = cy + rad;
      for (var i = 1; i < n; i++) {
        var a = U.rad(step * i);
        out.push(M.around(M.rotate(a), ox, oy));
      }
      void r.start;
      /* 시작 각도는 묶음 전체를 중심 둘레로 돌린다 */
      if (r.start) {
        var s = M.around(M.rotate(U.rad(r.start)), ox, oy);
        out = out.map(function (m) { return M.mul(s, m); });
      }
      return out;
    }

    if (r.kind === 'grid') {
      var cols = U.clamp(Math.round(r.cols == null ? 3 : r.cols), 1, 100);
      var rows = U.clamp(Math.round(r.rows == null ? 3 : r.rows), 1, 100);
      var dx = (b.x2 - b.x) + (r.gapX == null ? 12 : r.gapX);
      var dy = (b.y2 - b.y) + (r.gapY == null ? 12 : r.gapY);
      out = [];
      for (var rr = 0; rr < rows; rr++) {
        for (var cc = 0; cc < cols; cc++) out.push(M.translate(cc * dx, rr * dy));
      }
      return out;
    }

    /* 미러 — 축에 대해 뒤집은 한 벌 */
    var ang = U.rad(r.angle == null ? 90 : r.angle);
    var gap = r.gap == null ? 40 : r.gap;
    /* 축은 바운딩 중심에서 gap 만큼 밀린 곳을 지난다 */
    var nx = Math.cos(ang + Math.PI / 2), ny = Math.sin(ang + Math.PI / 2);
    var px = cx + nx * gap, py = cy + ny * gap;
    out.push(M.mulAll(
      M.translate(px, py), M.rotate(ang), M.scale(1, -1), M.rotate(-ang), M.translate(-px, -py)
    ));
    return out;
  };

  /* 원본을 한 벌 그리기 위한 대역 — 반복을 다시 타지 않게 표시만 붙인다 */
  RP.one = function (it) {
    var px = Object.create(it);
    px.__norepeat = true;
    return px;
  };
  RP.isOne = function (it) { return !!it.__norepeat; };

  /* 반복까지 감싼 월드 바운딩 (선택 상자 · 대지 맞춤이 전부를 감싸게) */
  RP.boundsM = function (it, m, geo, sw) {
    var ms = RP.matrices(it);
    if (!ms) return null;
    var one = RP.one(it), r = R.empty();
    /* m 은 부모행렬·it.m 이 곱해진 값 — 인스턴스 행렬은 그 사이에 들어간다 */
    var parent = M.mul(m, M.invert(it.m || M.ident()));
    for (var i = 0; i < ms.length; i++) {
      r = R.union(r, AI.render.boundsM(one, M.mulAll(parent, ms[i], it.m || M.ident()), geo, sw));
    }
    return r;
  };

  /* 실제 오브젝트로 굳힌다 (오브젝트 > 반복 > 확장) */
  RP.expand = function (app, it) {
    var ms = RP.matrices(it);
    if (!ms) return null;
    var loc = Model.locate(app.doc, it);
    if (!loc) return null;
    var kids = ms.map(function (mi) {
      var c = AI.edit.cloneItem(it);
      delete c.repeat;
      c.m = M.mul(mi, c.m);
      return c;
    });
    var g = Model.newGroup(kids);
    g.name = (RP.LABEL[it.repeat.kind] || '반복') + ' 확장';
    loc.list.splice(loc.index, 1, g);
    return g;
  };
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
