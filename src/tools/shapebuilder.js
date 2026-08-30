/* =========================================================================
   tools/shapebuilder.js — 도형 구성 도구 (Shape Builder, Shift+M)
   -------------------------------------------------------------------------
   선택한 도형들을 평면 분할해 "영역(face)" 으로 나눈 뒤,
     · 영역 위를 지나가며 드래그 → 지나간 영역을 하나로 합친다
     · Alt 를 누른 채 드래그   → 지나간 영역을 지운다
   건드리지 않은 영역은 원래 오브젝트별로 다시 합쳐져 그대로 남는다.
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, M = AI.mat, R = AI.rect, Model = AI.model, T = AI.tools,
    G = AI.geom, PF = AI.pathfinder, Col = AI.color, E = AI.edit;

  var st = null;      /* {marked:Set, path:[{x,y}], alt} */
  var cache = null;   /* {items, sets, faces:[{ring, owner}], key} */

  /* 선택 · 히스토리 상태가 바뀌면 분할 결과를 다시 계산한다 */
  function selKey(app) {
    return app.sel.map(function (it) { return it.id; }).join(',') +
      '#' + app.history.stack.length + ':' + app.history.index;
  }

  /* 선택한 패스들을 월드 좌표 링으로 만들고 평면 분할한다 */
  function build(app) {
    var items = app.sel.filter(function (it) { return it.type === 'path' || it.type === 'group'; });
    if (items.length < 2) return null;
    var sets = items.map(function (it) { return itemRings(app, it); }).filter(function (r) { return r.length; });
    if (sets.length < 2) return null;
    var faces = [];
    PF.faces(sets).forEach(function (f) {
      var rp = PF.repPoint(f);
      var owner = -1;
      for (var k = sets.length - 1; k >= 0; k--) {
        if (PF.pointInRings(sets[k], rp.x, rp.y)) { owner = k; break; }
      }
      if (owner < 0) return;                       /* 바깥 영역·구멍은 다루지 않는다 */
      faces.push({ ring: f, owner: owner, rp: rp });
    });
    if (!faces.length) return null;
    return { items: items, sets: sets, faces: faces };
  }

  function itemRings(app, it) {
    var wm = Model.worldMatrix(app.doc, it);
    var out = [];
    (function rec(o, m) {
      if (o.type === 'group') { o.children.forEach(function (c) { rec(c, M.mul(m, c.m)); }); return; }
      if (o.type !== 'path') return;
      G.flattenItem(o, 0.2, m).forEach(function (p) { if (p.pts.length > 2) out.push(p.pts); });
    })(it, wm);
    return PF.normalize(out);
  }

  function ensure(app) {
    var k = selKey(app);
    if (!cache || cache.key !== k) {
      var b = build(app);
      cache = b ? { key: k, items: b.items, sets: b.sets, faces: b.faces } : { key: k, faces: [] };
    }
    return cache;
  }
  /* 문서가 바뀌면 캐시를 버린다 */
  T.shapeBuilderInvalidate = function () { cache = null; };

  function faceAt(app, sx, sy) {
    var c = ensure(app);
    var d = AI.viewT.toDoc(app, sx, sy);
    for (var i = 0; i < c.faces.length; i++) {
      if (PF.pointInRings([c.faces[i].ring], d.x, d.y)) return i;
    }
    return -1;
  }

  function commit(app) {
    var c = cache;
    if (!c || !c.faces || !c.faces.length || !st || !st.marked.size) return false;
    var marked = [], rest = {};
    c.faces.forEach(function (f, i) {
      if (st.marked.has(i)) marked.push(f);
      else (rest[f.owner] = rest[f.owner] || []).push(f);
    });
    if (!marked.length) return false;

    var made = [];
    /* 1) 지나간 영역 — 합치기 모드일 때만 하나로 만든다 */
    if (!st.alt) {
      var merged = PF.uniteAll(marked.map(function (f) { return PF.normalize([f.ring]); }));
      if (merged.length) {
        var topOwner = Math.max.apply(null, marked.map(function (f) { return f.owner; }));
        made.push(mkItem(app, merged, c.items[topOwner]));
      }
    }
    /* 2) 남은 영역 — 원래 오브젝트별로 다시 합쳐 그대로 유지 */
    Object.keys(rest).forEach(function (k) {
      var u = PF.uniteAll(rest[k].map(function (f) { return PF.normalize([f.ring]); }));
      if (u.length) made.push(mkItem(app, u, c.items[+k]));
    });
    if (!made.length) return false;

    /* 원본을 지우고 맨 앞 원본 자리에 결과를 넣는다 */
    var anchor = Model.locate(app.doc, c.items[c.items.length - 1]);
    var list = anchor ? anchor.list : Model.activeLayer(app.doc).children;
    var at = anchor ? anchor.index : list.length;
    c.items.forEach(function (it) {
      var l = Model.locate(app.doc, it);
      if (l) { l.list.splice(l.index, 1); if (l.list === list && l.index < at) at--; }
    });
    Array.prototype.splice.apply(list, [Math.min(at + 1, list.length), 0].concat(made));
    AI.sel.set(app, made);
    cache = null;
    return true;
  }

  function mkItem(app, rings, src) {
    var it = Model.newPath(rings.map(function (r) {
      return { closed: true, pts: r.map(function (p) { return { x: p.x, y: p.y }; }) };
    }));
    it.m = M.ident();
    var leaf = src;
    while (leaf && leaf.type === 'group' && leaf.children.length) leaf = leaf.children[leaf.children.length - 1];
    it.fill = U.deepCopy((leaf && leaf.fill) || Col.solid('#cccccc'));
    it.stroke = U.deepCopy((leaf && leaf.stroke) || Model.defaultStroke());
    it.name = '도형 구성';
    return it;
  }

  T.mk({
    id: 'shapebuilder', name: '도형 구성 도구', key: null, cursor: 'crosshair',
    activate: function () { cache = null; },
    deactivate: function () { cache = null; st = null; },

    onDown: function (app, e) {
      var c = ensure(app);
      if (!c.faces.length) { U.toast('겹치는 도형을 2개 이상 선택하세요'); return; }
      st = { marked: new Set(), path: [{ x: e.x, y: e.y }], alt: !!e.alt };
      var i = faceAt(app, e.x, e.y);
      if (i >= 0) st.marked.add(i);
      app.invalidate();
    },

    onMove: function (app, e) {
      if (!st || !e.down) return;
      st.alt = st.alt || !!e.alt;
      var last = st.path[st.path.length - 1];
      /* 드래그 궤적을 촘촘히 샘플해 지나친 영역을 놓치지 않는다 */
      var steps = Math.max(1, Math.ceil(U.dist(last.x, last.y, e.x, e.y) / 4));
      for (var s = 1; s <= steps; s++) {
        var x = last.x + (e.x - last.x) * s / steps;
        var y = last.y + (e.y - last.y) * s / steps;
        var i = faceAt(app, x, y);
        if (i >= 0) st.marked.add(i);
      }
      st.path.push({ x: e.x, y: e.y });
      app.invalidate();
    },

    onUp: function (app, e) {
      if (!st) return;
      st.alt = st.alt || !!e.alt;
      var n = st.marked.size;
      if (n) {
        app.history.begin(st.alt ? '도형 구성: 삭제' : '도형 구성: 합치기', app.doc);
        if (commit(app)) {
          app.history.commit();
          U.toast((st.alt ? '영역 ' + n + '개 삭제' : '영역 ' + n + '개 합침'));
        } else app.history.abort();
      }
      st = null;
      app.invalidate();
      AI.ui.syncAll(app);
    },

    drawUI: function (ctx, app) {
      var c = cache;
      if (!c || !c.faces || !c.faces.length) return;
      var vm = AI.viewT.matrix(app);
      ctx.save();
      /* 영역 경계를 옅게 보여 준다 */
      ctx.strokeStyle = 'rgba(45,140,235,.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      c.faces.forEach(function (f) { traceRing(ctx, f.ring, vm); ctx.stroke(); });
      ctx.setLineDash([]);
      if (st && st.marked.size) {
        ctx.fillStyle = st.alt ? 'rgba(235,70,70,.30)' : 'rgba(45,140,235,.30)';
        st.marked.forEach(function (i) {
          var f = c.faces[i];
          if (f) { traceRing(ctx, f.ring, vm); ctx.fill(); }
        });
        /* 드래그 궤적 */
        if (st.path.length > 1) {
          ctx.strokeStyle = st.alt ? '#eb4646' : '#2d8ceb';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(st.path[0].x, st.path[0].y);
          for (var i2 = 1; i2 < st.path.length; i2++) ctx.lineTo(st.path[i2].x, st.path[i2].y);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  });

  function traceRing(ctx, ring, vm) {
    ctx.beginPath();
    for (var i = 0; i < ring.length; i++) {
      var p = M.apply(vm, ring[i].x, ring[i].y);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
  }
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
