/* =========================================================================
   edit.js — 오브젝트 편집 연산 (변형 / 정렬 / 순서 / 패스파인더 …)
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, M = AI.mat, R = AI.rect, G = AI.geom, Model = AI.model, Rn = AI.render, Col = AI.color;
  var E = AI.edit = {};

  /* ---------------- 변형 ---------------- */
  /* 월드 좌표계 행렬 W 를 아이템에 적용 */
  E.applyWorld = function (doc, it, W) {
    var loc = Model.locate(doc, it);
    var P = M.ident();
    if (loc && loc.parent) P = Model.worldMatrix(doc, loc.parent);
    it.m = M.mulAll(M.invert(P), W, P, it.m);
  };

  E.transformSelection = function (app, W) {
    app.sel.forEach(function (it) { E.applyWorld(app.doc, it, W); });
  };

  E.move = function (app, dx, dy) {
    E.transformSelection(app, M.translate(dx, dy));
  };

  /* 선택 포인트만 이동 (직접 선택) */
  E.movePoints = function (app, dx, dy) {
    var byItem = {};
    app.selPts.forEach(function (s) { (byItem[s.it.id] || (byItem[s.it.id] = { it: s.it, pts: [] })).pts.push(s); });
    Object.keys(byItem).forEach(function (k) {
      var it = byItem[k].it;
      var wm = Model.worldMatrix(app.doc, it), inv = M.invert(wm);
      var d = M.applyV(inv, dx, dy);
      Model.expandShape(it);
      byItem[k].pts.forEach(function (s) {
        var p = it.subs[s.si] && it.subs[s.si].pts[s.pi];
        if (!p) return;
        p.x += d.x; p.y += d.y;
        if (p.ix != null) { p.ix += d.x; p.iy += d.y; }
        if (p.ox != null) { p.ox += d.x; p.oy += d.y; }
      });
    });
  };

  /* 선택 영역의 바운딩을 원하는 값으로 */
  /* 기준점(ref 0..8) 기준으로 위치/크기 지정 — Illustrator 변형 패널과 동일 */
  E.refPointOf = function (b, ref) {
    var xs = [b.x, R.cx(b), b.x2], ys = [b.y, R.cy(b), b.y2];
    ref = ref == null ? 0 : ref;
    return { x: xs[ref % 3], y: ys[Math.floor(ref / 3)] };
  };

  E.setBounds = function (app, nx, ny, nw, nh, ref) {
    var b = Rn.selectionBounds(app, app.prefs.previewBounds ? false : true);
    if (R.isEmpty(b)) return;
    ref = ref == null ? (app.refPoint || 0) : ref;
    var anchor = E.refPointOf(b, ref);
    var w = R.w(b) || 1, h = R.h(b) || 1;
    var sx = nw == null ? 1 : nw / w, sy = nh == null ? 1 : nh / h;
    /* 기준점을 고정한 채 크기 조절 */
    var W = M.around(M.scale(sx || 1e-6, sy || 1e-6), anchor.x, anchor.y);
    /* 그다음 기준점 자체를 원하는 좌표로 이동 */
    var dx = nx == null ? 0 : nx - anchor.x;
    var dy = ny == null ? 0 : ny - anchor.y;
    if (dx || dy) W = M.mul(M.translate(dx, dy), W);
    E.transformSelection(app, W);
  };

  /* 선택 회전 (도) — 기준점 = 바운딩 중심 */
  E.rotate = function (app, deg, cx, cy) {
    var b = Rn.selectionBounds(app, true);
    if (R.isEmpty(b)) return;
    if (cx == null) { cx = R.cx(b); cy = R.cy(b); }
    E.transformSelection(app, M.around(M.rotate(U.rad(deg)), cx, cy));
  };
  E.scale = function (app, sx, sy, cx, cy) {
    var b = Rn.selectionBounds(app, true);
    if (R.isEmpty(b)) return;
    if (cx == null) { cx = R.cx(b); cy = R.cy(b); }
    E.transformSelection(app, M.around(M.scale(sx, sy), cx, cy));
  };
  E.reflect = function (app, axis, cx, cy) {
    var b = Rn.selectionBounds(app, true);
    if (R.isEmpty(b)) return;
    if (cx == null) { cx = R.cx(b); cy = R.cy(b); }
    E.transformSelection(app, M.around(axis === 'v' ? M.scale(-1, 1) : M.scale(1, -1), cx, cy));
  };
  E.shear = function (app, ax, ay, cx, cy) {
    var b = Rn.selectionBounds(app, true);
    if (R.isEmpty(b)) return;
    if (cx == null) { cx = R.cx(b); cy = R.cy(b); }
    E.transformSelection(app, M.around(M.skew(U.rad(ax || 0), U.rad(ay || 0)), cx, cy));
  };

  /* ---------------- 순서 ---------------- */
  E.arrange = function (app, mode) {
    app.sel.forEach(function (it) {
      var loc = Model.locate(app.doc, it);
      if (!loc) return;
      var list = loc.list, i = loc.index;
      list.splice(i, 1);
      if (mode === 'front') list.push(it);
      else if (mode === 'back') list.unshift(it);
      else if (mode === 'forward') list.splice(Math.min(i + 1, list.length), 0, it);
      else list.splice(Math.max(i - 1, 0), 0, it);
    });
  };

  /* ---------------- 그룹 ---------------- */
  E.group = function (app) {
    if (app.sel.length < 1) return;
    /* 문서 순서(뒤->앞)대로 정렬 */
    var ordered = [];
    Model.walk(app.doc, function (it) { if (app.sel.indexOf(it) >= 0) ordered.push(it); });
    var last = Model.locate(app.doc, ordered[ordered.length - 1]);
    if (!last) return;
    var target = last.list, at = last.index;
    ordered.forEach(function (it) {
      var loc = Model.locate(app.doc, it);
      if (loc) { loc.list.splice(loc.index, 1); if (loc.list === target && loc.index < at) at--; }
    });
    var g = Model.newGroup(ordered);
    target.splice(Math.min(at + 1, target.length), 0, g);
    AI.sel.set(app, [g]);
  };

  E.ungroup = function (app) {
    var next = [];
    app.sel.slice().forEach(function (it) {
      if (it.type !== 'group') { next.push(it); return; }
      var loc = Model.locate(app.doc, it);
      if (!loc) return;
      var kids = it.children.slice();
      kids.forEach(function (c) { c.m = M.mul(it.m, c.m); if (it.opacity !== 1) c.opacity = (c.opacity == null ? 1 : c.opacity) * it.opacity; });
      Array.prototype.splice.apply(loc.list, [loc.index, 1].concat(kids));
      next = next.concat(kids);
    });
    AI.sel.set(app, next);
  };

  /* ---------------- 복제 / 삭제 ---------------- */
  function cloneItem(it) {
    var c = U.deepCopy(it);
    (function reid(o) {
      o.id = U.uid(o.type);
      if (o.children) o.children.forEach(reid);
    })(c);
    return c;
  }
  E.cloneItem = cloneItem;

  E.duplicate = function (app, dx, dy) {
    var copies = [];
    var ordered = [];
    Model.walk(app.doc, function (it) { if (app.sel.indexOf(it) >= 0) ordered.push(it); });
    ordered.forEach(function (it) {
      var loc = Model.locate(app.doc, it);
      if (!loc) return;
      var c = cloneItem(it);
      if (dx || dy) c.m = M.mul(M.translate(dx, dy), c.m);
      loc.list.splice(loc.index + 1, 0, c);
      copies.push(c);
    });
    AI.sel.set(app, copies);
    return copies;
  };

  E.remove = function (app) {
    app.sel.forEach(function (it) {
      var loc = Model.locate(app.doc, it);
      if (loc) loc.list.splice(loc.index, 1);
    });
    AI.sel.clear(app);
  };

  /* 선택된 앵커 삭제 */
  E.deleteAnchors = function (app) {
    var byItem = {};
    app.selPts.forEach(function (s) { (byItem[s.it.id] || (byItem[s.it.id] = { it: s.it, list: [] })).list.push(s); });
    Object.keys(byItem).forEach(function (k) {
      var o = byItem[k], it = o.it;
      Model.expandShape(it);
      var grouped = {};
      o.list.forEach(function (s) { (grouped[s.si] || (grouped[s.si] = [])).push(s.pi); });
      Object.keys(grouped).forEach(function (si) {
        var idxs = grouped[si].sort(function (a, b) { return b - a; });
        idxs.forEach(function (pi) { it.subs[si].pts.splice(pi, 1); });
      });
      it.subs = it.subs.filter(function (s) { return s.pts.length > 1; });
      if (!it.subs.length) { var loc = Model.locate(app.doc, it); if (loc) loc.list.splice(loc.index, 1); }
    });
    app.selPts = [];
    app.sel = app.sel.filter(function (it) { return !!Model.locate(app.doc, it); });
  };

  /* ---------------- 잠금 / 숨기기 ---------------- */
  E.lock = function (app) { app.sel.forEach(function (it) { it.locked = true; }); AI.sel.clear(app); };
  E.unlockAll = function (app) {
    var found = [];
    app.doc.layers.forEach(function (l) { l.locked = false; });
    Model.walk(app.doc, function (it) { if (it.locked) { it.locked = false; found.push(it); } });
    AI.sel.set(app, found);
  };
  E.hide = function (app) { app.sel.forEach(function (it) { it.visible = false; }); AI.sel.clear(app); };
  E.showAll = function (app) {
    var found = [];
    app.doc.layers.forEach(function (l) { l.visible = true; });
    Model.walk(app.doc, function (it) { if (!it.visible) { it.visible = true; found.push(it); } });
    AI.sel.set(app, found);
  };

  /* ---------------- 정렬 ---------------- */
  E.align = function (app, mode, to) {
    var items = app.sel;
    if (!items.length) return;
    var ref;
    if (to === 'artboard') {
      var ab = app.doc.artboards[app.doc.activeArtboard];
      ref = { x: ab.x, y: ab.y, x2: ab.x + ab.w, y2: ab.y + ab.h };
    } else if (to === 'key' && app.keyObject && items.indexOf(app.keyObject) >= 0) {
      ref = Rn.worldBounds(app.doc, app.keyObject);
    } else {
      if (items.length < 2) {
        var ab2 = app.doc.artboards[app.doc.activeArtboard];
        ref = { x: ab2.x, y: ab2.y, x2: ab2.x + ab2.w, y2: ab2.y + ab2.h };
      } else ref = Rn.selectionBounds(app, true);
    }
    items.forEach(function (it) {
      var b = Rn.worldBounds(app.doc, it), dx = 0, dy = 0;
      if (mode === 'left') dx = ref.x - b.x;
      else if (mode === 'hcenter') dx = R.cx(ref) - R.cx(b);
      else if (mode === 'right') dx = ref.x2 - b.x2;
      else if (mode === 'top') dy = ref.y - b.y;
      else if (mode === 'vcenter') dy = R.cy(ref) - R.cy(b);
      else if (mode === 'bottom') dy = ref.y2 - b.y2;
      if (dx || dy) E.applyWorld(app.doc, it, M.translate(dx, dy));
    });
  };

  E.distribute = function (app, axis) {
    var items = app.sel.slice();
    if (items.length < 3) return;
    var info = items.map(function (it) { return { it: it, b: Rn.worldBounds(app.doc, it) }; });
    info.sort(function (a, b) { return axis === 'h' ? R.cx(a.b) - R.cx(b.b) : R.cy(a.b) - R.cy(b.b); });
    var first = info[0], last = info[info.length - 1];
    var start = axis === 'h' ? R.cx(first.b) : R.cy(first.b);
    var end = axis === 'h' ? R.cx(last.b) : R.cy(last.b);
    var step = (end - start) / (info.length - 1);
    info.forEach(function (o, i) {
      if (i === 0 || i === info.length - 1) return;
      var cur = axis === 'h' ? R.cx(o.b) : R.cy(o.b);
      var want = start + step * i, d = want - cur;
      E.applyWorld(app.doc, o.it, axis === 'h' ? M.translate(d, 0) : M.translate(0, d));
    });
  };

  E.distributeSpacing = function (app, axis, gap) {
    var items = app.sel.slice();
    if (items.length < 2) return;
    var info = items.map(function (it) { return { it: it, b: Rn.worldBounds(app.doc, it) }; });
    info.sort(function (a, b) { return axis === 'h' ? a.b.x - b.b.x : a.b.y - b.b.y; });
    if (gap == null) {
      var total = axis === 'h' ? (info[info.length - 1].b.x2 - info[0].b.x) : (info[info.length - 1].b.y2 - info[0].b.y);
      var used = 0;
      info.forEach(function (o) { used += axis === 'h' ? R.w(o.b) : R.h(o.b); });
      gap = (total - used) / (info.length - 1);
    }
    var cursor = axis === 'h' ? info[0].b.x2 : info[0].b.y2;
    for (var i = 1; i < info.length; i++) {
      var o = info[i], want = cursor + gap;
      var d = want - (axis === 'h' ? o.b.x : o.b.y);
      E.applyWorld(app.doc, o.it, axis === 'h' ? M.translate(d, 0) : M.translate(0, d));
      cursor = want + (axis === 'h' ? R.w(o.b) : R.h(o.b));
    }
  };

  /* ---------------- 스타일 ---------------- */
  E.applyPaint = function (app, paint, which) {
    var targets = app.sel.length ? app.sel : [];
    targets.forEach(function (it) {
      (function rec(o) {
        if (o.type === 'group') { o.children.forEach(rec); return; }
        if (o.type === 'image') return;
        if (which === 'stroke') {
          var s = o.stroke || Model.defaultStroke();
          if (paint.type === 'none') s.type = 'none';
          else if (paint.type === 'solid') { s.type = 'solid'; s.color = paint.color; s.alpha = paint.alpha; }
          else { Object.keys(paint).forEach(function (k) { s[k] = U.deepCopy(paint[k]); }); }
          o.stroke = s;
        } else {
          o.fill = U.deepCopy(paint);
        }
      })(it);
    });
  };
  E.applyStrokeProp = function (app, key, value) {
    app.sel.forEach(function (it) {
      (function rec(o) {
        if (o.type === 'group') { o.children.forEach(rec); return; }
        o.stroke = o.stroke || Model.defaultStroke();
        o.stroke[key] = value;
        if (key === 'width' && o.stroke.type === 'none') o.stroke.type = 'solid';
      })(it);
    });
  };
  E.setOpacity = function (app, v) { app.sel.forEach(function (it) { it.opacity = U.clamp(v, 0, 1); }); };
  E.swapFillStroke = function (app) {
    app.sel.forEach(function (it) {
      (function rec(o) {
        if (o.type === 'group') { o.children.forEach(rec); return; }
        var f = o.fill || Col.none(), s = o.stroke || Model.defaultStroke();
        var nf = (s.type === 'none') ? Col.none() : (s.type === 'solid' ? Col.solid(s.color, s.alpha) : U.deepCopy(s));
        var ns = Model.defaultStroke();
        ns.width = s.width; ns.cap = s.cap; ns.join = s.join; ns.dash = s.dash;
        if (f.type === 'none') ns.type = 'none';
        else if (f.type === 'solid') { ns.type = 'solid'; ns.color = f.color; ns.alpha = f.alpha; }
        else { Object.keys(f).forEach(function (k) { ns[k] = U.deepCopy(f[k]); }); }
        o.fill = nf; o.stroke = ns;
      })(it);
    });
  };

  /* 선택된 라이브 셰이프의 속성 변경 (모퉁이 반경, 변 수, 별 비율 …) */
  E.updateShape = function (app, kinds, key, value) {
    var any = false;
    app.sel.forEach(function (it) {
      (function rec(o) {
        if (o.type === 'group') { o.children.forEach(rec); return; }
        if (o.type !== 'path' || !o.shape) return;
        if (kinds.indexOf(o.shape.kind) < 0) return;
        if (key === 'ratio') o.shape.r2 = o.shape.r * value;
        else o.shape[key] = value;
        Model.buildShape(o);
        any = true;
      })(it);
    });
    return any;
  };

  /* ---------------- 클리핑 마스크 ---------------- */
  E.makeClipMask = function (app) {
    if (app.sel.length < 2) { U.toast('클리핑 마스크는 2개 이상 선택이 필요합니다'); return; }
    var ordered = [];
    Model.walk(app.doc, function (it) { if (app.sel.indexOf(it) >= 0) ordered.push(it); });
    E.group(app);
    var g = app.sel[0];
    if (g && g.type === 'group') {
      g.clip = true;
      g.name = '클립 그룹';
      var cp = g.children[g.children.length - 1];
      if (cp) { cp.fill = Col.none(); cp.stroke = Model.defaultStroke(); }
    }
  };
  E.releaseClipMask = function (app) {
    app.sel.forEach(function (it) { if (it.type === 'group' && it.clip) { it.clip = false; it.name = '그룹'; } });
  };

  /* ---------------- 패스파인더 ---------------- */
  function itemRings(app, it) {
    var wm = Model.worldMatrix(app.doc, it);
    var out = [];
    (function rec(o, m) {
      if (o.type === 'group') { o.children.forEach(function (c) { rec(c, M.mul(m, c.m)); }); return; }
      if (o.type !== 'path') return;
      G.flattenItem(o, 0.2, m).forEach(function (p) { if (p.pts.length > 2) out.push(p.pts); });
    })(it, wm);
    return AI.pathfinder.normalize(out);
  }

  function ringsToItem(app, rings, style) {
    var it = Model.newPath(rings.map(function (r) {
      return { closed: true, pts: r.map(function (p) { return { x: p.x, y: p.y }; }) };
    }));
    it.m = M.ident();
    it.fill = U.deepCopy(style.fill);
    it.stroke = U.deepCopy(style.stroke);
    it.opacity = style.opacity;
    return it;
  }

  E.itemRings = itemRings;
  E.ringsToItem = ringsToItem;

  E.pathfinder = function (app, op) {
    var items = [];
    Model.walk(app.doc, function (it) { if (app.sel.indexOf(it) >= 0) items.push(it); });
    if (items.length < 1) { U.toast('오브젝트를 선택하세요'); return false; }
    var front = items[items.length - 1], back = items[0];
    var styleFront = { fill: front.fill || Col.solid('#000'), stroke: front.stroke || Model.defaultStroke(), opacity: front.opacity };
    var styleBack = { fill: back.fill || Col.solid('#000'), stroke: back.stroke || Model.defaultStroke(), opacity: back.opacity };
    var sets = items.map(function (it) { return itemRings(app, it); });
    var res = null, style = styleBack, produced = [];

    if (op === 'unite') { res = AI.pathfinder.uniteAll(sets); style = styleFront; }
    else if (op === 'intersect') {
      res = sets[0];
      for (var i = 1; i < sets.length; i++) res = AI.pathfinder.boolean(res, sets[i], 'intersect');
      style = styleFront;
    } else if (op === 'exclude') {
      res = sets[0];
      for (i = 1; i < sets.length; i++) res = AI.pathfinder.boolean(res, sets[i], 'exclude');
      style = styleFront;
    } else if (op === 'minusFront') {
      res = sets[0];
      for (i = 1; i < sets.length; i++) res = AI.pathfinder.boolean(res, sets[i], 'minus');
      style = styleBack;
    } else if (op === 'minusBack') {
      res = sets[sets.length - 1];
      for (i = sets.length - 2; i >= 0; i--) res = AI.pathfinder.boolean(res, sets[i], 'minus');
      style = styleFront;
    } else if (op === 'divide' || op === 'trim' || op === 'crop' || op === 'merge') {
      var faces = AI.pathfinder.faces(sets);
      var top = sets[sets.length - 1];
      var pieces = [];
      faces.forEach(function (f) {
        var rp = AI.pathfinder.repPoint(f);
        var owner = -1;
        for (var k = sets.length - 1; k >= 0; k--) {
          if (AI.pathfinder.pointInRings(sets[k], rp.x, rp.y)) { owner = k; break; }
        }
        if (owner < 0) return;                       /* 바깥 영역·구멍 */
        if (op === 'crop' && !AI.pathfinder.pointInRings(top, rp.x, rp.y)) return;
        pieces.push({ ring: f, owner: owner });
      });
      if (op === 'merge') {
        /* 같은 칠을 가진 조각끼리 합친다 */
        var groups = {}, order = [];
        pieces.forEach(function (p) {
          var src = items[p.owner];
          var k = paintKey(src.fill);
          if (!groups[k]) { groups[k] = { src: src, rings: [] }; order.push(k); }
          groups[k].rings.push([p.ring]);
        });
        order.forEach(function (k) {
          var gset = groups[k];
          var merged = AI.pathfinder.uniteAll(gset.rings.map(function (r) { return AI.pathfinder.normalize(r); }));
          if (!merged.length) return;
          produced.push(ringsToItem(app, merged, {
            fill: gset.src.fill || Col.solid('#000'),
            stroke: Model.defaultStroke(), opacity: gset.src.opacity
          }));
        });
      } else {
        pieces.forEach(function (p) {
          var src = items[p.owner];
          var st = {
            fill: src.fill || Col.solid('#000'),
            stroke: (op === 'divide' ? (src.stroke || Model.defaultStroke()) : Model.defaultStroke()),
            opacity: src.opacity
          };
          produced.push(ringsToItem(app, AI.pathfinder.normalize([p.ring]), st));
        });
      }
    } else if (op === 'outline') {
      items.forEach(function (it) {
        var rings = itemRings(app, it);
        rings.forEach(function (r) {
          var st = { fill: Col.none(), stroke: Model.mkStroke(colorOf(it.fill), 0.5), opacity: 1 };
          produced.push(ringsToItem(app, [r], st));
        });
      });
    }

    function colorOf(p) { return p && p.type === 'solid' ? p.color : (p && p.stops ? p.stops[0].color : '#000000'); }
    function paintKey(p) {
      if (!p || p.type === 'none') return 'none';
      if (p.type === 'solid') return 'solid:' + p.color + ':' + (p.alpha == null ? 1 : p.alpha);
      return p.type + ':' + p.stops.map(function (s) { return s.t + s.color; }).join('|');
    }

    if (res) {
      if (!res.length) { U.toast('결과가 비어 있습니다'); return false; }
      produced = [ringsToItem(app, res, style)];
    }
    if (!produced.length) { U.toast('결과가 비어 있습니다'); return false; }

    var loc = Model.locate(app.doc, items[items.length - 1]);
    var list = loc ? loc.list : Model.activeLayer(app.doc).children;
    var at = loc ? loc.index : list.length;
    items.forEach(function (it) {
      var l = Model.locate(app.doc, it);
      if (l) { l.list.splice(l.index, 1); if (l.list === list && l.index < at) at--; }
    });
    var insertAt = Math.min(at + 1, list.length);
    if (produced.length > 1 && (op === 'divide' || op === 'trim' || op === 'crop' || op === 'merge')) {
      var g = Model.newGroup(produced);
      list.splice(insertAt, 0, g);
      AI.sel.set(app, [g]);
    } else {
      Array.prototype.splice.apply(list, [insertAt, 0].concat(produced));
      AI.sel.set(app, produced);
    }
    return true;
  };

  /* ---------------- 패스 명령 ---------------- */
  E.joinPath = function (app) {
    /* 선택된 열린 서브패스의 끝점 2개를 연결 */
    var pts = app.selPts;
    if (pts.length === 2 && pts[0].it === pts[1].it) {
      var it = pts[0].it;
      var a = pts[0], b = pts[1];
      if (a.si === b.si) {
        var sub = it.subs[a.si];
        var n = sub.pts.length;
        var ends = [0, n - 1];
        if (ends.indexOf(a.pi) >= 0 && ends.indexOf(b.pi) >= 0 && a.pi !== b.pi) { sub.closed = true; return true; }
      } else {
        var s1 = it.subs[a.si], s2 = it.subs[b.si];
        if (a.pi === 0) s1.pts.reverse();
        if (b.pi !== 0) s2.pts.reverse();
        s1.pts = s1.pts.concat(s2.pts);
        it.subs.splice(b.si, 1);
        return true;
      }
    }
    /* 서로 다른 두 오브젝트의 열린 패스 연결 */
    var open = app.sel.filter(function (it) { return it.type === 'path' && it.subs.length === 1 && !it.subs[0].closed; });
    if (open.length === 2) {
      var A = open[0], B = open[1];
      var wa = Model.worldMatrix(app.doc, A), wb = Model.worldMatrix(app.doc, B);
      var inv = M.invert(wa);
      var bp = B.subs[0].pts.map(function (p) {
        var q = M.apply(M.mul(inv, wb), p.x, p.y);
        var o = { x: q.x, y: q.y };
        if (p.ix != null) { var i2 = M.apply(M.mul(inv, wb), p.ix, p.iy); o.ix = i2.x; o.iy = i2.y; }
        if (p.ox != null) { var o2 = M.apply(M.mul(inv, wb), p.ox, p.oy); o.ox = o2.x; o.oy = o2.y; }
        return o;
      });
      var ap = A.subs[0].pts;
      var last = ap[ap.length - 1], first = bp[0], lastB = bp[bp.length - 1];
      if (U.dist(last.x, last.y, lastB.x, lastB.y) < U.dist(last.x, last.y, first.x, first.y)) bp.reverse();
      A.subs[0].pts = ap.concat(bp);
      Model.expandShape(A);
      var lb = Model.locate(app.doc, B); if (lb) lb.list.splice(lb.index, 1);
      AI.sel.set(app, [A]);
      return true;
    }
    U.toast('연결할 두 끝점 또는 두 개의 열린 패스를 선택하세요');
    return false;
  };

  E.averagePoints = function (app, axis) {
    if (app.selPts.length < 2) return false;
    var sum = { x: 0, y: 0 }, n = 0, world = [];
    app.selPts.forEach(function (s) {
      var p = s.it.subs[s.si] && s.it.subs[s.si].pts[s.pi];
      if (!p) return;
      var wm = Model.worldMatrix(app.doc, s.it);
      var w = M.apply(wm, p.x, p.y);
      world.push({ s: s, p: p, w: w, wm: wm });
      sum.x += w.x; sum.y += w.y; n++;
    });
    if (!n) return false;
    sum.x /= n; sum.y /= n;
    world.forEach(function (o) {
      var target = { x: axis === 'v' ? sum.x : o.w.x, y: axis === 'h' ? sum.y : o.w.y };
      if (axis === 'both') { target.x = sum.x; target.y = sum.y; }
      var inv = M.invert(o.wm);
      var lp = M.apply(inv, target.x, target.y);
      var dx = lp.x - o.p.x, dy = lp.y - o.p.y;
      Model.expandShape(o.s.it);
      o.p.x += dx; o.p.y += dy;
      if (o.p.ix != null) { o.p.ix += dx; o.p.iy += dy; }
      if (o.p.ox != null) { o.p.ox += dx; o.p.oy += dy; }
    });
    return true;
  };

  /* 앵커 유형 변환 */
  E.toCorner = function (app) {
    app.selPts.forEach(function (s) {
      var p = s.it.subs[s.si].pts[s.pi];
      Model.expandShape(s.it);
      delete p.ix; delete p.iy; delete p.ox; delete p.oy;
    });
  };
  E.toSmooth = function (app) {
    app.selPts.forEach(function (s) {
      var it = s.it, sub = it.subs[s.si], p = sub.pts[s.pi], n = sub.pts.length;
      Model.expandShape(it);
      var prev = sub.pts[s.pi - 1] || (sub.closed ? sub.pts[n - 1] : null);
      var next = sub.pts[s.pi + 1] || (sub.closed ? sub.pts[0] : null);
      if (!prev && !next) return;
      var a = prev || p, b = next || p;
      var tx = (b.x - a.x) / 4, ty = (b.y - a.y) / 4;
      if (prev) { p.ix = p.x - tx; p.iy = p.y - ty; }
      if (next) { p.ox = p.x + tx; p.oy = p.y + ty; }
    });
  };

  /* 윤곽선 만들기 (텍스트 -> 패스) : 근사 (사각 경로) */
  E.outlineStroke = function (app) {
    U.toast('획 윤곽선은 패스파인더 > 윤곽선 을 사용하세요');
  };

  /* ---------------- 스냅 / 스마트 가이드 ---------------- */
  E.collectSnapTargets = function (app, exclude) {
    var xs = [], ys = [];
    function push(arr, v, b, kind) { arr.push({ v: v, b: b, kind: kind }); }
    var ab = app.doc.artboards[app.doc.activeArtboard];
    if (ab) {
      var abb = { x: ab.x, y: ab.y, x2: ab.x + ab.w, y2: ab.y + ab.h };
      push(xs, abb.x, abb, '대지'); push(xs, R.cx(abb), abb, '대지 중심'); push(xs, abb.x2, abb, '대지');
      push(ys, abb.y, abb, '대지'); push(ys, R.cy(abb), abb, '대지 중심'); push(ys, abb.y2, abb, '대지');
    }
    app.doc.guides.forEach(function (g) {
      push(g.axis === 'v' ? xs : ys, g.pos, null, '안내선');
    });
    Model.walkWorld(app.doc, function (it, info) {
      if (exclude.indexOf(it) >= 0) return false;
      var b = Rn.boundsM(it, info.m, true, 1);
      if (R.isEmpty(b)) return;
      push(xs, b.x, b, '가장자리'); push(xs, R.cx(b), b, '중심'); push(xs, b.x2, b, '가장자리');
      push(ys, b.y, b, '가장자리'); push(ys, R.cy(b), b, '중심'); push(ys, b.y2, b, '가장자리');
      if (it.type === 'group') return false;
    }, { skipHidden: true });
    return { xs: xs, ys: ys };
  };

  /* 이동 중 스냅: bounds 를 받아 dx,dy 보정값 반환 */
  E.snapBounds = function (app, b, targets, tolDoc) {
    var res = { dx: 0, dy: 0, guides: [] };
    if (app.prefs.snapGrid) {
      var g = (app.prefs.gridSize || 72) / (app.prefs.gridDiv || 8);
      res.dx = Math.round(b.x / g) * g - b.x;
      res.dy = Math.round(b.y / g) * g - b.y;
      return res;
    }
    if (!app.prefs.smart) return res;

    var candX = [{ v: b.x, k: '가장자리' }, { v: R.cx(b), k: '중심' }, { v: b.x2, k: '가장자리' }];
    var candY = [{ v: b.y, k: '가장자리' }, { v: R.cy(b), k: '중심' }, { v: b.y2, k: '가장자리' }];
    var bestX = null, bestY = null;

    candX.forEach(function (c) {
      targets.xs.forEach(function (t) {
        var d = t.v - c.v;
        if (Math.abs(d) <= tolDoc && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d: d, t: t, c: c };
      });
    });
    candY.forEach(function (c) {
      targets.ys.forEach(function (t) {
        var d = t.v - c.v;
        if (Math.abs(d) <= tolDoc && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d: d, t: t, c: c };
      });
    });

    function label(best) {
      if (best.t.kind === '안내선') return '안내선';
      if (best.t.kind.indexOf('대지') === 0) return best.t.kind;
      if (best.c.k === '중심' && best.t.kind === '중심') return '중심';
      return best.t.kind === '중심' ? '중심 정렬' : '가장자리';
    }
    if (bestX) {
      res.dx = bestX.d;
      res.guides.push({ axis: 'v', pos: bestX.t.v, label: label(bestX), src: bestX.t.b, moving: b, dx: bestX.d, dy: 0 });
    }
    if (bestY) {
      res.dy = bestY.d;
      res.guides.push({ axis: 'h', pos: bestY.t.v, label: label(bestY), src: bestY.t.b, moving: b, dx: 0, dy: bestY.d });
    }
    return res;
  };

})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
