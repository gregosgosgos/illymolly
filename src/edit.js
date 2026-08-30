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
  /* 모양 패널에서 겹을 하나 고른 상태라면 그 겹에만 색을 적용한다 */
  E.applyPaintToLayer = function (app, paint) {
    var AP = AI.appearance;
    if (app.apIndex == null || app.sel.length !== 1) return false;
    var it = app.sel[0];
    if (!AP.supports(it) || !AP.isCustom(it)) return false;
    var e = AP.entry(it, app.apIndex);
    if (!e) return false;
    if (e.kind === 'fill') e.paint = U.deepCopy(paint);
    else {
      var s = e.stroke || Model.defaultStroke();
      if (paint.type === 'none') s.type = 'none';
      else if (paint.type === 'solid') { s.type = 'solid'; s.color = paint.color; s.alpha = paint.alpha; }
      else Object.keys(paint).forEach(function (k) { s[k] = U.deepCopy(paint[k]); });
      e.stroke = s;
    }
    AP.sync(it);
    return true;
  };

  E.applyPaint = function (app, paint, which) {
    if (E.applyPaintToLayer(app, paint)) return;
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
        AI.appearance.pushDown(o);
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
        AI.appearance.pushDown(o);
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

  /* 선택한 타원의 파이 각도를 바꾼다 (둘 중 하나만 줘도 된다) */
  E.updatePie = function (app, start, end) {
    var any = false;
    app.sel.forEach(function (it) {
      (function rec(o) {
        if (o.type === 'group') { o.children.forEach(rec); return; }
        if (o.type !== 'path' || !o.shape || o.shape.kind !== 'ellipse') return;
        var pie = o.shape.pie || { start: 0, end: 360 };
        if (start != null) pie.start = start;
        if (end != null) pie.end = end;
        if (Math.abs((((pie.end - pie.start) % 360) + 360) % 360) < 0.001) delete o.shape.pie;
        else o.shape.pie = pie;
        Model.buildShape(o);
        any = true;
      })(it);
    });
    return any;
  };

  /* ---------------- 개별 변형 (Transform Each) ---------------- */
  /* 선택한 오브젝트를 각자의 기준점을 중심으로 변형한다.
     random 을 켜면 각 오브젝트마다 0~지정값 사이의 임의 값이 적용된다. */
  E.transformEach = function (app, o) {
    o = o || {};
    var anchor = o.anchor == null ? 4 : o.anchor;
    app.sel.forEach(function (it) {
      var b = Rn.worldBounds(app.doc, it, true);
      if (R.isEmpty(b)) return;
      var ref = E.refPointOf(b, anchor);
      var rnd = function () { return o.random ? Math.random() : 1; };
      var sgn = function () { return o.random ? (Math.random() * 2 - 1) : 1; };
      var sx = 1 + ((o.sx == null ? 100 : o.sx) / 100 - 1) * rnd();
      var sy = 1 + ((o.sy == null ? 100 : o.sy) / 100 - 1) * rnd();
      var mx = (o.dx || 0) * sgn(), my = (o.dy || 0) * sgn();
      var ang = U.rad(-(o.angle || 0) * sgn());
      var W = M.mulAll(
        M.translate(mx, my),
        M.around(M.rotate(ang), ref.x, ref.y),
        M.around(M.scale(sx || 1e-6, sy || 1e-6), ref.x, ref.y)
      );
      if (o.reflectX) W = M.mul(W, M.around(M.scale(-1, 1), ref.x, ref.y));
      if (o.reflectY) W = M.mul(W, M.around(M.scale(1, -1), ref.x, ref.y));
      E.applyWorld(app.doc, it, W);
    });
  };

  /* ---------------- 패스 이동 (Offset Path) ---------------- */
  /* 링을 각 꼭짓점의 각 이등분선 방향으로 밀어낸 뒤(마이터 제한 적용),
     생기는 자체 교차를 평면 분할 + 감김수(nonzero)로 정리한다.
     에지마다 불리언을 돌리는 방식보다 훨씬 빠르면서 결과는 같다. */
  function offsetRing(ring, d) {
    var n = ring.length;
    if (n < 3) return null;
    /* 링 자체 방향(넓이 부호)에 맞춰 바깥 방향을 정한다 — 구멍은 자동으로 반대가 된다 */
    var sgn = AI.pathfinder.area(ring) > 0 ? 1 : -1;
    var out = [];
    for (var i = 0; i < n; i++) {
      var p = ring[i], a = ring[(i - 1 + n) % n], b = ring[(i + 1) % n];
      var n1 = edgeNormal(a, p), n2 = edgeNormal(p, b);
      if (!n1 || !n2) continue;
      var bx = n1.x + n2.x, by = n1.y + n2.y;
      var len = Math.hypot(bx, by);
      if (len < 1e-9) continue;                 /* 180° 되돌아가는 지점은 건너뛴다 */
      bx /= len; by /= len;
      var cos = bx * n1.x + by * n1.y;          /* 이등분선과 법선 사이 각 */
      var k = cos < 1e-6 ? 1 : 1 / cos;
      if (k > 6) k = 6;                          /* 마이터 제한 — 뾰족한 곳이 폭주하지 않게 */
      out.push({ x: p.x + bx * d * sgn * k, y: p.y + by * d * sgn * k });
    }
    return out.length > 2 ? out : null;
  }
  function edgeNormal(a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy);
    if (l < 1e-9) return null;
    return { x: dy / l, y: -dx / l };            /* 시계 반대 링 기준 바깥 법선 */
  }

  /* 점에서 링 집합의 경계까지의 최단 거리 */
  function distToRings(rings, x, y) {
    var best = Infinity;
    rings.forEach(function (r) {
      for (var i = 0; i < r.length; i++) {
        var a = r[i], b = r[(i + 1) % r.length];
        var dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
        var t = l2 < 1e-12 ? 0 : U.clamp(((x - a.x) * dx + (y - a.y) * dy) / l2, 0, 1);
        var dd = U.dist(x, y, a.x + dx * t, a.y + dy * t);
        if (dd < best) best = dd;
      }
    });
    return best;
  }

  /* 링 집합을 d 만큼 오프셋한 결과 링들 */
  E.offsetRings = function (rings, d) {
    var raw = [];
    rings.forEach(function (r) {
      var o = offsetRing(r, d);
      if (o) raw.push(o);
    });
    if (!raw.length) return [];
    var PFm = AI.pathfinder;
    var faces = PFm.faces([raw]);
    var tol = Math.abs(d) * 0.15 + 1e-6;
    var keep = faces.filter(function (f) {
      var rp = PFm.repPoint(f);
      if (!PFm.pointInRings(raw, rp.x, rp.y)) return false;
      /* 이등분선 오프셋은 d 가 크면 링이 뒤집힌다.
         원본 경계까지의 거리로 "정말 그만큼 밀려난 자리인지" 확인해 걸러 낸다. */
      var inside = PFm.pointInRings(rings, rp.x, rp.y);
      var dist = distToRings(rings, rp.x, rp.y);
      if (d > 0) return inside || dist <= d + tol;
      return inside && dist >= -d - tol;
    });
    if (!keep.length) return [];
    return PFm.uniteAll(keep.map(function (f) { return PFm.normalize([f]); }));
  };

  E.offsetPath = function (app, dist, opt) {
    opt = opt || {};
    if (!app.sel.length) { U.toast('오브젝트를 먼저 선택하세요'); return false; }
    if (!dist) { U.toast('이동 거리를 0 이 아닌 값으로 지정하세요'); return false; }
    var made = [], any = false;
    app.sel.slice().forEach(function (it) {
      var rings = itemRings(app, it);
      if (!rings.length) { made.push(it); return; }
      var res = E.offsetRings(rings, dist);
      if (!res.length) { made.push(it); return; }
      var ni = ringsToItem(app, res, {
        fill: U.deepCopy(it.fill || Col.solid('#cccccc')),
        stroke: U.deepCopy(it.stroke || Model.defaultStroke()),
        opacity: it.opacity
      });
      ni.name = it.name + ' 이동';
      if (opt.replace) {
        var loc = Model.locate(app.doc, it);
        if (loc) loc.list.splice(loc.index, 1, ni); else Model.activeLayer(app.doc).children.push(ni);
      } else {
        var loc2 = Model.locate(app.doc, it);
        if (loc2) loc2.list.splice(loc2.index + 1, 0, ni);
        else Model.activeLayer(app.doc).children.push(ni);
      }
      made.push(ni);
      any = true;
    });
    if (!any) { U.toast('패스 이동 결과가 비어 있습니다'); return false; }
    AI.sel.set(app, made);
    return true;
  };

  /* ---------------- 단순화 (Simplify) ---------------- */
  /* 곡선 정밀도(%)로 평탄화 허용치를 정하고, RDP 로 앵커를 줄인 뒤
     원하면 다시 곡선으로 맞춘다. 일러스트레이터의 [단순화]와 같은 구성. */
  E.simplifyPaths = function (app, o) {
    o = o || {};
    var precision = U.clamp(o.precision == null ? 90 : o.precision, 1, 100);
    var angleThreshold = o.angle == null ? 0 : o.angle;
    var curves = o.curves !== false;
    var before = 0, after = 0, any = false;

    app.sel.forEach(function (it) {
      (function rec(node) {
        if (node.type === 'group') { node.children.forEach(rec); return; }
        if (node.type !== 'path') return;
        var b = Rn.worldBounds(app.doc, node, true);
        var diag = Math.hypot(R.w(b), R.h(b)) || 100;
        /* 정밀도 100% = 거의 그대로, 1% = 대략 대각선의 5% 까지 허용 */
        var tol = diag * 0.05 * Math.pow(1 - precision / 100, 1.5);
        node.subs = node.subs.map(function (sub) {
          var pts = G.flattenSub(sub, Math.max(tol * 0.25, 0.05));
          before += sub.pts.length;
          if (pts.length < 3) { after += sub.pts.length; return sub; }
          var simp = G.simplify(pts, Math.max(tol, 1e-4));
          /* 각도 임계값: 지정한 각보다 뾰족한 지점은 코너로 남긴다 */
          var fitted = curves ? G.fitCurve(simp, Math.max(tol, 0.05)) : simp.map(function (p) { return { x: p.x, y: p.y }; });
          if (angleThreshold > 0) markCorners(fitted, angleThreshold);
          after += fitted.length;
          any = true;
          return { closed: sub.closed, pts: fitted };
        });
        node.shape = null;                 /* 라이브 셰이프는 더 이상 유효하지 않다 */
      })(it);
    });
    if (!any) return false;
    return { before: before, after: after };
  };

  function markCorners(pts, deg) {
    var lim = Math.cos(U.rad(180 - deg));
    for (var i = 1; i < pts.length - 1; i++) {
      var a = pts[i - 1], p = pts[i], b = pts[i + 1];
      var v1 = { x: p.x - a.x, y: p.y - a.y }, v2 = { x: b.x - p.x, y: b.y - p.y };
      var l1 = Math.hypot(v1.x, v1.y), l2 = Math.hypot(v2.x, v2.y);
      if (l1 < 1e-9 || l2 < 1e-9) continue;
      var cos = (v1.x * v2.x + v1.y * v2.y) / (l1 * l2);
      if (cos < lim) { delete p.ix; delete p.iy; delete p.ox; delete p.oy; }
    }
  }

  /* ---------------- 이미지 자르기 (Crop Image) ---------------- */
  /* 이미지 + 그 위의 도형을 선택하면 도형의 바운딩으로 이미지를 자른다.
     원본 픽셀은 유지하고 표시할 영역(crop)만 기록한다. */
  E.cropImage = function (app) {
    var img = null, shape = null;
    app.sel.forEach(function (it) {
      if (it.type === 'image' && !img) img = it;
      else if (!shape) shape = it;
    });
    if (!img) { U.toast('자를 이미지를 선택하세요'); return false; }
    if (!shape) { U.toast('자를 범위가 될 도형을 이미지 위에 두고 함께 선택하세요'); return false; }

    var inv = M.invert(Model.worldMatrix(app.doc, img));
    var wb = Rn.worldBounds(app.doc, shape, true);
    var lb = R.empty();
    [[wb.x, wb.y], [wb.x2, wb.y], [wb.x2, wb.y2], [wb.x, wb.y2]].forEach(function (p) {
      var q = M.apply(inv, p[0], p[1]);
      R.add(lb, q.x, q.y);
    });
    var x0 = U.clamp(lb.x, 0, img.w), y0 = U.clamp(lb.y, 0, img.h);
    var x1 = U.clamp(lb.x2, 0, img.w), y1 = U.clamp(lb.y2, 0, img.h);
    if (x1 - x0 < 1 || y1 - y0 < 1) { U.toast('자를 영역이 이미지와 겹치지 않습니다'); return false; }

    var c = img.crop || { x: 0, y: 0, w: 1, h: 1 };
    img.crop = {
      x: c.x + (x0 / img.w) * c.w,
      y: c.y + (y0 / img.h) * c.h,
      w: ((x1 - x0) / img.w) * c.w,
      h: ((y1 - y0) / img.h) * c.h
    };
    img.m = M.mul(img.m, M.translate(x0, y0));
    img.w = x1 - x0;
    img.h = y1 - y0;

    var loc = Model.locate(app.doc, shape);
    if (loc) loc.list.splice(loc.index, 1);
    AI.sel.set(app, [img]);
    return true;
  };

  /* ---------------- 유사 항목 선택 (선택 > 동일) ----------------
     일러스트레이터의 [선택 > 동일] 서브메뉴. 기준이 되는 오브젝트에서 열쇠 값을
     뽑고, 문서 전체에서 같은 값을 가진 것을 모은다. */
  function paintKey(p2) {
    if (!p2 || p2.type === 'none') return 'none';
    if (p2.type === 'solid') return 'solid:' + p2.color + ':' + (p2.alpha == null ? 1 : p2.alpha);
    if (p2.type === 'pattern') return 'pattern:' + p2.patternId;
    if (p2.stops) return 'grad:' + p2.kind + ':' + p2.stops.map(function (st) { return st.color + '@' + U.round(st.t, 3); }).join(',');
    return p2.type;
  }
  E.paintKey = paintKey;

  var SAME = {
    fill: { name: '칠 색상', key: function (it) { return paintKey(it.fill); } },
    stroke: { name: '획 색상', key: function (it) { return paintKey(it.stroke); } },
    fillStroke: {
      name: '칠 및 획',
      key: function (it) {
        return paintKey(it.fill) + '|' + paintKey(it.stroke) + '|' +
          U.round((it.stroke && it.stroke.width) || 0, 3);
      }
    },
    strokeWeight: {
      name: '획 두께',
      key: function (it) { return String(U.round((it.stroke && it.stroke.type !== 'none' && it.stroke.width) || 0, 3)); }
    },
    opacity: { name: '불투명도', key: function (it) { return String(U.round(it.opacity == null ? 1 : it.opacity, 3)); } },
    blend: { name: '혼합 모드', key: function (it) { return it.blend || 'normal'; } },
    shape: {
      name: '도형',
      key: function (it) { return it.shape ? 'shape:' + it.shape.kind : 'type:' + it.type; }
    },
    symbol: {
      name: '심볼 인스턴스',
      key: function (it) { return it.type === 'symbol' ? 'sym:' + it.symbolId : null; }
    },
    appearance: {
      name: '모양',
      key: function (it) {
        return JSON.stringify({
          a: AI.appearance.list(it).map(function (e) {
            return e.kind === 'fill' ? ['f', paintKey(e.paint)]
              : ['s', paintKey(e.stroke), U.round(e.stroke.width || 0, 3), e.stroke.align || 'center'];
          }),
          e: (it.effects || []).map(function (e) { return e.type; }),
          o: U.round(it.opacity == null ? 1 : it.opacity, 3),
          b: it.blend || 'normal'
        });
      }
    },
    font: {
      name: '글꼴 계열',
      key: function (it) { return it.type === 'text' ? 'font:' + it.text.family : null; }
    },
    fontSize: {
      name: '글꼴 크기',
      key: function (it) { return it.type === 'text' ? 'size:' + U.round(it.text.size, 3) : null; }
    },
    charStyle: {
      name: '문자 스타일',
      key: function (it) { return it.type === 'text' && it.text.charStyle ? 'cs:' + it.text.charStyle : null; }
    }
  };
  E.SAME = SAME;

  E.selectSame = function (app, kind) {
    var def = SAME[kind];
    if (!def) return 0;
    if (!app.sel.length) { U.toast('기준이 될 오브젝트를 선택하세요'); return 0; }
    /* 선택한 것들의 열쇠 값을 모두 기준으로 삼는다 (일러스트레이터와 같다) */
    var keys = [];
    app.sel.forEach(function (it) {
      var k = def.key(it);
      if (k != null && keys.indexOf(k) < 0) keys.push(k);
    });
    if (!keys.length) { U.toast('"' + def.name + '" 기준을 뽑을 수 없는 오브젝트입니다'); return 0; }
    var found = [];
    Model.walk(app.doc, function (it, list, i, parent, layer) {
      if (it.type === 'group') return;
      if (!it.visible || it.locked) return;
      if (layer && (!layer.visible || layer.locked)) return;
      var k = def.key(it);
      if (k != null && keys.indexOf(k) >= 0) found.push(it);
    });
    AI.sel.set(app, found);
    U.toast('동일 ' + def.name + ' — ' + found.length + '개 선택됨');
    return found.length;
  };

  /* ---------------- 선택 > 오브젝트 ---------------- */
  function pickAll(app, test) {
    var out = [];
    Model.walk(app.doc, function (it, list, i, parent, layer) {
      if (it.type === 'group') return;
      if (!it.visible || it.locked) return;
      if (layer && (!layer.visible || layer.locked)) return;
      if (test(it)) out.push(it);
    });
    return out;
  }

  var OBJSEL = {
    sameLayer: {
      name: '같은 레이어의 모든 오브젝트',
      pick: function (app) {
        var out = [], want = [];
        Model.walk(app.doc, function (it, list, i, parent, layer) {
          if (app.sel.indexOf(it) >= 0 && layer && want.indexOf(layer) < 0) want.push(layer);
        });
        if (!want.length) want = [Model.activeLayer(app.doc)];
        want.forEach(function (ly) {
          if (!ly.visible || ly.locked) return;
          ly.children.forEach(function (it) { if (it.visible && !it.locked) out.push(it); });
        });
        return out;
      }
    },
    textObjects: {
      name: '텍스트 오브젝트',
      pick: function (app) { return pickAll(app, function (it) { return it.type === 'text'; }); }
    },
    strayPoints: {
      name: '분리점',
      pick: function (app) {
        return pickAll(app, function (it) {
          return it.type === 'path' && it.subs.length === 1 && it.subs[0].pts.length < 2;
        });
      }
    },
    clipMasks: {
      name: '클리핑 마스크',
      pick: function (app) {
        var out = [];
        Model.walk(app.doc, function (it) {
          if (it.type === 'group' && it.clip && it.children.length) {
            var cp = it.children[it.children.length - 1];
            if (cp.visible && !cp.locked) out.push(cp);
          }
        });
        return out;
      }
    },
    brushStrokes: {
      name: '브러시 획',
      pick: function (app) {
        return pickAll(app, function (it) {
          return it.type === 'path' && it.stroke &&
            (it.stroke.brush || (it.stroke.widthProfile && it.stroke.widthProfile.length > 1));
        });
      }
    }
  };
  E.OBJSEL = OBJSEL;

  E.selectObject = function (app, kind) {
    var def = OBJSEL[kind];
    if (!def) return 0;
    var found = def.pick(app);
    AI.sel.set(app, found);
    U.toast(def.name + ' — ' + found.length + '개 선택됨');
    return found.length;
  };

  /* ---------------- 산포 브러시 (Scatter Brush) ---------------- */
  /* 패스를 따라 심볼/도형 사본을 뿌린다. 일러스트레이터의 산포 브러시를
     "적용 즉시 확장" 형태로 구현한 것 — 결과가 평범한 아트웍이라 다루기 쉽다. */
  /* ---------------- 패스 상의 문자 ----------------
     패스를 문자 오브젝트의 기준선으로 바꾼다 (일러스트레이터처럼 원본 패스는
     문자 오브젝트가 되면서 사라진다). 기준선은 아이템 로컬 좌표로 옮겨 담는다. */
  E.makePathText = function (app, src, startAt) {
    if (!src || src.type !== 'path') return null;
    var b = Rn.worldBounds(app.doc, src, true);
    var rel = M.mul(M.translate(-b.x, -b.y), Model.worldMatrix(app.doc, src));
    var it = Model.newPathText(b.x, b.y, '', G.xformSubs(src.subs, rel));
    var o = app.typeOpts || {};
    it.text.size = o.size || 24;
    if (o.family) it.text.family = o.family;
    if (startAt != null) it.text.path.start = startAt;
    it.fill = U.deepCopy(app.textFill || Col.solid('#000000'));
    it.stroke = Model.defaultStroke();
    var loc = Model.locate(app.doc, src);
    if (loc) loc.list.splice(loc.index, 1, it);
    else Model.activeLayer(app.doc).children.push(it);
    return it;
  };

  E.scatterAlongPath = function (app, art, o) {
    o = o || {};
    var spacing = Math.max(1, o.spacing == null ? 30 : o.spacing);
    var sizeJit = (o.sizeJitter || 0) / 100;
    var rotJit = o.rotationJitter || 0;
    var offJit = o.offsetJitter || 0;
    var followPath = o.follow !== false;
    var made = [];

    app.sel.forEach(function (it) {
      if (it.type !== 'path') return;
      var wm = Model.worldMatrix(app.doc, it);
      it.subs.forEach(function (sub) {
        var pts = G.flattenSub(sub, 0.4, wm);
        if (pts.length < 2) return;
        if (sub.closed) pts = pts.concat([pts[0]]);
        var acc = [0], total = 0, i;
        for (i = 1; i < pts.length; i++) {
          total += U.dist(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
          acc.push(total);
        }
        if (total < spacing * 0.5) return;
        var n = Math.max(1, Math.floor(total / spacing));
        for (var k = 0; k <= n; k++) {
          var target = (k / n) * total;
          var seg = 1;
          while (seg < acc.length && acc[seg] < target) seg++;
          seg = Math.min(seg, acc.length - 1);
          var a0 = pts[seg - 1], b0 = pts[seg];
          var span = acc[seg] - acc[seg - 1];
          var t = span < 1e-9 ? 0 : (target - acc[seg - 1]) / span;
          var px = a0.x + (b0.x - a0.x) * t, py = a0.y + (b0.y - a0.y) * t;
          var ang = Math.atan2(b0.y - a0.y, b0.x - a0.x);

          var c = U.deepCopy(art);
          AI.assets.reid(c);
          var b = Rn.localBounds(c);
          var cx = (b.x + b.x2) / 2, cy = (b.y + b.y2) / 2;
          var sJ = 1 + (Math.random() * 2 - 1) * sizeJit;
          var rJ = U.rad((Math.random() * 2 - 1) * rotJit);
          var oJ = (Math.random() * 2 - 1) * offJit;
          var nx = -Math.sin(ang), ny = Math.cos(ang);
          c.m = M.mulAll(
            M.translate(px + nx * oJ, py + ny * oJ),
            M.rotate((followPath ? ang : 0) + rJ),
            M.scale(sJ, sJ),
            M.translate(-cx, -cy),
            c.m || M.ident()
          );
          made.push(c);
        }
      });
    });
    if (!made.length) { U.toast('뿌릴 패스를 선택하세요'); return false; }
    var g = Model.newGroup(made);
    g.name = '산포 브러시';
    Model.activeLayer(app.doc).children.push(g);
    AI.sel.set(app, [g]);
    return true;
  };

  /* ---------------- 아트 브러시 · 패턴 브러시 ----------------
     아트웍을 패스에 맞춰 **휘어 놓는다**. 아트웍의 가로(u)는 패스를 따라가는
     거리로, 세로(v)는 패스 법선 방향의 거리로 옮긴다.
       · 아트 브러시   — 아트웍 한 벌을 패스 전체 길이에 맞춰 늘린다
       · 패턴 브러시   — 같은 방식으로 여러 벌을 이어 붙여 반복한다
     일러스트레이터의 브러시와 결과가 같고, 산포 브러시처럼 적용 즉시 실제
     아트웍으로 펼친다 (다루기 쉬운 평범한 패스로 남는다).                   */

  /* 아트웍의 잎 패스들을 (누적 행렬과 함께) 모은다 */
  function leafPaths(it, m, out) {
    if (it.type === 'group') {
      it.children.forEach(function (c) { leafPaths(c, M.mul(m, c.m), out); });
      return out;
    }
    if (it.type === 'path') out.push({ it: it, m: m });
    return out;
  }

  /* 아트웍 한 벌을 패스의 [s0, s1] 구간 위로 휘어 놓는다 */
  function bendArtwork(app, art, walk, s0, s1, bb, o) {
    var leaves = leafPaths(art, Model.worldMatrix(app.doc, art), []);
    var w = R.w(bb) || 1, h = R.h(bb) || 1;
    var across = h * ((o.width == null ? 100 : o.width) / 100);
    var made = [];

    function map(x, y) {
      var u = (x - bb.x) / w;
      var v = (y - bb.y) / h - 0.5;
      if (o.flipAlong) u = 1 - u;
      if (o.flipAcross) v = -v;
      var q = walk.at(U.clamp(s0 + u * (s1 - s0), 0, walk.length));
      if (!q) return { x: x, y: y };
      var nx = -Math.sin(q.ang), ny = Math.cos(q.ang);
      return { x: q.x + nx * v * across, y: q.y + ny * v * across };
    }

    /* 휘는 변환이라 직선도 곡선이 된다. 패스를 따라가는 방향(u)으로 긴 변은
       잘게 나눠 두어야 실제로 휘어 보인다. */
    var span = Math.abs(s1 - s0);
    function densify(pts, closed) {
      var out = [], n = pts.length;
      var last = closed ? n : n - 1;
      for (var i = 0; i < last; i++) {
        var a = pts[i], b = pts[(i + 1) % n];
        var du = Math.abs(b.x - a.x) / w;
        var k = U.clamp(Math.ceil(du * span / 3), 1, 400);
        for (var j = 0; j < k; j++) {
          out.push({ x: a.x + (b.x - a.x) * j / k, y: a.y + (b.y - a.y) * j / k });
        }
      }
      if (!closed) out.push(pts[n - 1]);
      return out;
    }

    leaves.forEach(function (lf) {
      var subs = [];
      G.flattenItem(lf.it, 0.3, lf.m).forEach(function (poly) {
        if (poly.pts.length < 2) return;
        subs.push({
          closed: poly.closed,
          pts: densify(poly.pts, poly.closed).map(function (p) {
            var q = map(p.x, p.y); return { x: q.x, y: q.y };
          })
        });
      });
      if (!subs.length) return;
      var c = Model.newPath(subs);
      c.name = lf.it.name;
      c.fill = U.deepCopy(lf.it.fill);
      c.stroke = U.deepCopy(lf.it.stroke);
      if (lf.it.appearance) c.appearance = U.deepCopy(lf.it.appearance);
      c.opacity = lf.it.opacity;
      c.blend = lf.it.blend;
      made.push(c);
    });
    return made;
  }

  /* 선택한 패스들에 아트웍 브러시를 입힌다.
     mode: 'art' 한 벌 늘리기 · 'pattern' 여러 벌 이어 붙이기 */
  E.artBrushAlongPath = function (app, art, o) {
    o = o || {};
    var mode = o.mode === 'pattern' ? 'pattern' : 'art';
    var bb = Rn.worldBounds(app.doc, art, true);
    if (R.isEmpty(bb) || R.w(bb) < 1e-6) { U.toast('브러시로 쓸 아트웍이 비어 있습니다'); return false; }

    var made = [], usedPaths = [];
    app.sel.forEach(function (it) {
      if (it.type !== 'path') return;
      var wm = Model.worldMatrix(app.doc, it);
      var walk = G.walker(it.subs, 0.3, wm);
      if (!walk || walk.length < 1) return;
      usedPaths.push(it);

      if (mode === 'art') {
        made = made.concat(bendArtwork(app, art, walk, 0, walk.length, bb, o));
        return;
      }
      /* 패턴 — 타일이 딱 떨어지도록 폭을 미세 조정한다 (일러스트레이터의 기본 '늘이기 맞춤') */
      var tile = Math.max(1, R.w(bb) * ((o.width == null ? 100 : o.width) / 100));
      var n = Math.max(1, Math.round(walk.length / tile));
      var step = walk.length / n;
      for (var i = 0; i < n; i++) {
        made = made.concat(bendArtwork(app, art, walk, i * step, (i + 1) * step, bb, o));
      }
    });

    if (!made.length) { U.toast('브러시를 입힐 패스를 함께 선택하세요'); return false; }
    var g = Model.newGroup(made);
    g.name = mode === 'art' ? '아트 브러시' : '패턴 브러시';
    Model.activeLayer(app.doc).children.push(g);
    /* 원본 패스는 일러스트레이터처럼 획이 브러시로 바뀐 셈이므로 지운다 */
    if (o.keepPath === false) {
      usedPaths.forEach(function (it) {
        var loc = Model.locate(app.doc, it);
        if (loc) loc.list.splice(loc.index, 1);
      });
    }
    AI.sel.set(app, [g]);
    return true;
  };

  /* ---------------- 아트웍 재색상화 (Recolor Artwork) ---------------- */
  /* 선택 영역에 쓰인 색을 모아 팔레트로 만들고, 색끼리 바꾸거나
     색조 회전 · 채도 · 밝기를 한 번에 조정한다. */
  E.collectColors = function (app) {
    var seen = Object.create(null), out = [];
    function add(hex) {
      if (!hex) return;
      var k = hex.toLowerCase();
      if (seen[k]) { seen[k].count++; return; }
      seen[k] = { color: k, count: 1 };
      out.push(seen[k]);
    }
    var counted = [];
    function scan(p) {
      if (!p || p.type === 'none') return;
      if (counted.indexOf(p) >= 0) return;      /* 기본 스택은 같은 객체를 두 번 준다 */
      counted.push(p);
      if (p.type === 'solid') add(p.color);
      else if (p.stops) p.stops.forEach(function (st) { add(st.color); });
    }
    app.sel.forEach(function (it) {
      (function rec(o) {
        if (o.type === 'group') { o.children.forEach(rec); return; }
        scan(o.fill); scan(o.stroke);
        AI.appearance.list(o).forEach(function (e) { scan(e.kind === 'fill' ? e.paint : e.stroke); });
      })(it);
    });
    return out.sort(function (a, b) { return b.count - a.count; });
  };

  /* map: {원본hex: 새hex}, adj: {hue, sat, light} (도 / %) */
  E.recolor = function (app, map, adj) {
    map = map || {};
    adj = adj || {};
    var any = false;
    function conv(hex) {
      var out = map[String(hex).toLowerCase()] || hex;
      if (adj.hue || adj.sat != null || adj.light != null) out = adjustHex(out, adj);
      if (out !== hex) any = true;
      return out;
    }
    /* 기본 모양 스택은 it.fill / it.stroke 와 같은 객체를 돌려주므로,
       이미 손댄 페인트를 기억해 두 번 변환되지 않게 한다. */
    var seen = [];
    function once(p) {
      if (!p || p.type === 'none') return;
      if (seen.indexOf(p) >= 0) return;
      seen.push(p);
      if (p.type === 'solid') p.color = conv(p.color);
      else if (p.stops) p.stops.forEach(function (st) { st.color = conv(st.color); });
    }
    app.sel.forEach(function (it) {
      (function rec(o) {
        if (o.type === 'group') { o.children.forEach(rec); return; }
        once(o.fill); once(o.stroke);
        AI.appearance.list(o).forEach(function (e) { once(e.kind === 'fill' ? e.paint : e.stroke); });
      })(it);
    });
    return any;
  };

  function adjustHex(hex, adj) {
    var rgb = Col.hexToRgb(hex);
    var hsb = Col.rgbToHsb ? Col.rgbToHsb(rgb.r, rgb.g, rgb.b) : null;
    if (!hsb) return hex;
    var h = (hsb.h + (adj.hue || 0)) % 360;
    if (h < 0) h += 360;
    var sMul = adj.sat == null ? 1 : (100 + adj.sat) / 100;
    var bMul = adj.light == null ? 1 : (100 + adj.light) / 100;
    var s2 = U.clamp(hsb.s * sMul, 0, 100);
    var b2 = U.clamp(hsb.b * bMul, 0, 100);
    var out = Col.hsbToRgb(h, s2, b2);
    return Col.rgbToHex(out.r, out.g, out.b);
  }

  /* ---------------- 불투명도 마스크 ---------------- */
  /* 맨 앞 오브젝트가 마스크가 되고, 나머지는 내용 그룹이 된다 (투명도 패널) */
  E.makeOpacityMask = function (app) {
    if (app.sel.length < 2) { U.toast('2개 이상 선택하세요 (맨 앞이 마스크)'); return false; }
    var ordered = [];
    Model.walk(app.doc, function (it) { if (app.sel.indexOf(it) >= 0) ordered.push(it); });
    var mask = ordered[ordered.length - 1];
    var content = ordered.slice(0, -1);
    if (!content.length) return false;

    var anchor = Model.locate(app.doc, content[content.length - 1]);
    var list = anchor ? anchor.list : Model.activeLayer(app.doc).children;
    var at = anchor ? anchor.index : list.length;
    ordered.forEach(function (it) {
      var l = Model.locate(app.doc, it);
      if (l) { l.list.splice(l.index, 1); if (l.list === list && l.index < at) at--; }
    });

    var g = Model.newGroup(content);
    g.name = '불투명도 마스크';
    g.opacityMask = mask;                 /* 마스크는 그룹 좌표계에서 자기 m 을 쓴다 */
    list.splice(Math.min(at + 1, list.length), 0, g);
    AI.sel.set(app, [g]);
    return true;
  };

  E.releaseOpacityMask = function (app) {
    var any = false;
    app.sel.slice().forEach(function (it) {
      if (!it.opacityMask) return;
      var mask = it.opacityMask;
      delete it.opacityMask;
      delete it.maskInvert;
      var loc = Model.locate(app.doc, it);
      if (loc) loc.list.splice(loc.index + 1, 0, mask);
      else Model.activeLayer(app.doc).children.push(mask);
      any = true;
    });
    if (!any) { U.toast('해제할 불투명도 마스크가 없습니다'); return false; }
    return true;
  };

  /* ---------------- 블렌드 ---------------- */
  /* 두 패스를 같은 개수의 점으로 리샘플해 중간 단계를 만든다.
     칠·획 색도 함께 보간한다 (오브젝트 > 블렌드 > 만들기). */
  function resample(it, doc, n) {
    var wm = Model.worldMatrix(doc, it);
    var polys = G.flattenItem(it, 0.3, wm).filter(function (p) { return p.pts.length > 1; });
    if (!polys.length) return null;
    /* 가장 긴 서브패스 하나만 쓴다 — 블렌드는 형태 대응이 1:1 이어야 한다 */
    var best = polys[0], bestLen = 0;
    polys.forEach(function (p) {
      var L = 0;
      for (var i = 1; i < p.pts.length; i++) L += U.dist(p.pts[i - 1].x, p.pts[i - 1].y, p.pts[i].x, p.pts[i].y);
      if (L > bestLen) { bestLen = L; best = p; }
    });
    var pts = best.pts.slice();
    if (best.closed) pts.push({ x: pts[0].x, y: pts[0].y });
    var acc = [0], total = 0;
    for (var i = 1; i < pts.length; i++) {
      total += U.dist(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
      acc.push(total);
    }
    if (total < 1e-6) return null;
    var out = [];
    for (var k = 0; k < n; k++) {
      var target = (k / n) * total;
      for (var j = 1; j < acc.length; j++) {
        if (acc[j] >= target) {
          var seg = acc[j] - acc[j - 1];
          var t = seg < 1e-9 ? 0 : (target - acc[j - 1]) / seg;
          out.push({
            x: pts[j - 1].x + (pts[j].x - pts[j - 1].x) * t,
            y: pts[j - 1].y + (pts[j].y - pts[j - 1].y) * t
          });
          break;
        }
      }
    }
    while (out.length < n) out.push({ x: out[out.length - 1].x, y: out[out.length - 1].y });
    return { pts: out, closed: best.closed };
  }

  /* 두 링의 시작점을 맞춘다 — 안 맞추면 중간 단계가 꼬인다 */
  function alignStart(a, b) {
    var n = a.length, bestK = 0, bestD = Infinity;
    for (var k = 0; k < n; k++) {
      var d = 0;
      for (var i = 0; i < n; i += Math.max(1, Math.floor(n / 16))) {
        d += U.dist(a[i].x, a[i].y, b[(i + k) % n].x, b[(i + k) % n].y);
      }
      if (d < bestD) { bestD = d; bestK = k; }
    }
    return b.slice(bestK).concat(b.slice(0, bestK));
  }

  E.blend = function (app, steps) {
    if (app.sel.length < 2) { U.toast('2개 이상의 오브젝트를 선택하세요'); return false; }
    var ordered = [];
    Model.walk(app.doc, function (it) { if (app.sel.indexOf(it) >= 0) ordered.push(it); });
    steps = U.clamp(Math.round(steps == null ? 5 : steps), 1, 200);
    var N = 96;                               /* 리샘플 점 수 */
    var made = [];

    for (var s = 0; s + 1 < ordered.length; s++) {
      var A = ordered[s], B = ordered[s + 1];
      var ra = resample(A, app.doc, N), rb = resample(B, app.doc, N);
      if (!ra || !rb) continue;
      var pb = ra.closed && rb.closed ? alignStart(ra.pts, rb.pts) : rb.pts;
      var fa = colorOfPaint(A.fill), fb = colorOfPaint(B.fill);
      var sa = A.stroke && A.stroke.type !== 'none' ? A.stroke : null;
      var sb2 = B.stroke && B.stroke.type !== 'none' ? B.stroke : null;
      for (var k = 1; k <= steps; k++) {
        var t = k / (steps + 1);
        var pts = [];
        for (var i = 0; i < N; i++) {
          pts.push({ x: ra.pts[i].x + (pb[i].x - ra.pts[i].x) * t, y: ra.pts[i].y + (pb[i].y - ra.pts[i].y) * t });
        }
        var ni = Model.newPath([{ closed: ra.closed && rb.closed, pts: pts }]);
        ni.m = M.ident();
        ni.name = '블렌드 단계';
        ni.fill = (fa && fb) ? Col.solid(mixHex(fa, fb, t)) : U.deepCopy(A.fill || Col.none());
        if (sa && sb2) {
          ni.stroke = U.deepCopy(sa);
          ni.stroke.color = mixHex(sa.color, sb2.color, t);
          ni.stroke.width = sa.width + (sb2.width - sa.width) * t;
        } else ni.stroke = Model.defaultStroke();
        ni.opacity = (A.opacity == null ? 1 : A.opacity) + ((B.opacity == null ? 1 : B.opacity) - (A.opacity == null ? 1 : A.opacity)) * t;
        made.push(ni);
      }
    }
    if (!made.length) { U.toast('블렌드할 수 없는 조합입니다'); return false; }

    /* 원본은 남기고 그 사이에 단계들을 넣어 하나의 그룹으로 */
    var first = ordered[0];
    var loc = Model.locate(app.doc, first);
    var list = loc ? loc.list : Model.activeLayer(app.doc).children;
    var at = loc ? loc.index : list.length;
    ordered.forEach(function (it) {
      var l = Model.locate(app.doc, it);
      if (l) { l.list.splice(l.index, 1); if (l.list === list && l.index < at) at--; }
    });
    var kids = [ordered[0]];
    made.forEach(function (x) { kids.push(x); });
    for (var q = 1; q < ordered.length; q++) kids.push(ordered[q]);
    /* 원본의 변환을 로컬로 굳혀 그룹 안에서 그대로 보이게 한다 */
    ordered.forEach(function (it) { it.m = Model.worldMatrix(app.doc, it); });
    var g = Model.newGroup(kids);
    g.name = '블렌드';
    g.blendSpine = { steps: steps };
    list.splice(Math.max(0, Math.min(at, list.length)), 0, g);
    AI.sel.set(app, [g]);
    return true;
  };

  function colorOfPaint(p) {
    if (!p || p.type === 'none') return null;
    if (p.type === 'solid') return p.color;
    return p.stops && p.stops.length ? p.stops[0].color : null;
  }
  function mixHex(a, b, t) {
    var ca = Col.hexToRgb(a || '#000000'), cb = Col.hexToRgb(b || '#000000');
    return Col.rgbToHex(
      Math.round(ca.r + (cb.r - ca.r) * t),
      Math.round(ca.g + (cb.g - ca.g) * t),
      Math.round(ca.b + (cb.b - ca.b) * t));
  }

  /* ---------------- 레이어 ---------------- */
  /* indices 를 주면 그 레이어들만, 없으면 전부 병합한다 (가장 아래 레이어로) */
  E.mergeLayers = function (app, indices) {
    var L = app.doc.layers;
    var idx = (indices && indices.length > 1)
      ? indices.slice().filter(function (i) { return i >= 0 && i < L.length; }).sort(function (a, b) { return a - b; })
      : null;
    if (!idx && L.length < 2) return false;
    if (idx && idx.length < 2) return false;

    if (!idx) {
      var base = L[0];
      for (var i = 1; i < L.length; i++) base.children = base.children.concat(L[i].children);
      app.doc.layers = [base];
      app.doc.activeLayer = 0;
      return true;
    }
    var target = L[idx[0]];
    for (var k = 1; k < idx.length; k++) target.children = target.children.concat(L[idx[k]].children);
    var drop = idx.slice(1).sort(function (a, b) { return b - a; });
    drop.forEach(function (i2) { L.splice(i2, 1); });
    app.doc.activeLayer = U.clamp(app.doc.layers.indexOf(target), 0, app.doc.layers.length - 1);
    app.selLayers = [app.doc.activeLayer];
    return true;
  };

  /* 활성 레이어의 최상위 아이템을 각각 새 레이어로 (Release to Layers) */
  E.releaseToLayers = function (app) {
    var ly = Model.activeLayer(app.doc);
    if (ly.children.length < 2) return false;
    var idx = app.doc.layers.indexOf(ly);
    var made = ly.children.map(function (it, i) {
      var nl = Model.newLayer(ly.name + ' ' + (i + 1), app.doc.layers.length + i);
      nl.children = [it];
      return nl;
    });
    app.doc.layers.splice(idx, 1);
    Array.prototype.splice.apply(app.doc.layers, [idx, 0].concat(made));
    app.doc.activeLayer = idx;
    return true;
  };

  /* 선택 항목을 새 레이어로 모으기 */
  E.collectInNewLayer = function (app, name) {
    if (!app.sel.length) return false;
    var ordered = [];
    Model.walk(app.doc, function (it) { if (app.sel.indexOf(it) >= 0) ordered.push(it); });
    ordered.forEach(function (it) {
      var loc = Model.locate(app.doc, it);
      if (loc) loc.list.splice(loc.index, 1);
    });
    var nl = Model.newLayer(name || ('레이어 ' + (app.doc.layers.length + 1)), app.doc.layers.length);
    nl.children = ordered;
    app.doc.layers.push(nl);
    app.doc.activeLayer = app.doc.layers.length - 1;
    AI.sel.set(app, ordered);
    return true;
  };

  /* ---------------- 대지 ---------------- */
  E.fitArtboardTo = function (app, mode) {
    var r = R.empty();
    if (mode === 'selection') {
      app.sel.forEach(function (it) { r = R.union(r, Rn.worldBounds(app.doc, it)); });
      if (R.isEmpty(r)) { U.toast('오브젝트를 선택하세요'); return false; }
    } else {
      Model.walkWorld(app.doc, function (it, info) {
        r = R.union(r, Rn.boundsM(it, info.m, false, 1));
        if (it.type === 'group') return false;
      }, { skipHidden: true });
      if (R.isEmpty(r)) { U.toast('대지에 오브젝트가 없습니다'); return false; }
    }
    var ab = app.doc.artboards[app.doc.activeArtboard];
    ab.x = r.x; ab.y = r.y; ab.w = Math.max(1, R.w(r)); ab.h = Math.max(1, R.h(r));
    app.doc.width = ab.w; app.doc.height = ab.h;
    return true;
  };

  /* 대지를 격자로 재정렬 */
  E.rearrangeArtboards = function (app, cols, gap) {
    var abs = app.doc.artboards;
    cols = Math.max(1, cols || Math.ceil(Math.sqrt(abs.length)));
    gap = gap == null ? 40 : gap;
    var rowH = 0, x = 0, y = 0, i;
    for (i = 0; i < abs.length; i++) {
      if (i % cols === 0 && i) { x = 0; y += rowH + gap; rowH = 0; }
      var dx = x - abs[i].x, dy = y - abs[i].y;
      abs[i].x = x; abs[i].y = y;
      x += abs[i].w + gap;
      rowH = Math.max(rowH, abs[i].h);
    }
    return true;
  };

  /* ---------------- 안내선 ---------------- */
  /* 안내선을 선 패스로 되돌린다 (오브젝트 > 안내선 > 안내선 해제) */
  E.releaseGuides = function (app) {
    if (!app.doc.guides.length) { U.toast('안내선이 없습니다'); return false; }
    var ab = app.doc.artboards[app.doc.activeArtboard];
    var made = [];
    app.doc.guides.forEach(function (g) {
      var it = (g.axis === 'v')
        ? Model.newLine(g.pos, ab.y - 20, g.pos, ab.y + ab.h + 20)
        : Model.newLine(ab.x - 20, g.pos, ab.x + ab.w + 20, g.pos);
      it.name = '안내선';
      it.fill = Col.none();
      it.stroke = Model.mkStroke('#3ad0e0', 1);
      Model.activeLayer(app.doc).children.push(it);
      made.push(it);
    });
    app.doc.guides = [];
    AI.sel.set(app, made);
    return true;
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
      /* 구멍이 있는 면(컴파운드 패스의 살)은 바깥 링 + 구멍 링으로 함께 받는다 */
      var faces = AI.pathfinder.facesWithHoles(sets);
      var top = sets[sets.length - 1];
      var pieces = [];
      /* 오리기(Crop)에서 맨 앞 오브젝트는 잘라 내는 틀일 뿐 결과에 남지 않는다.
         따라서 칠의 주인을 찾을 때 맨 앞 오브젝트는 후보에서 뺀다. */
      var topOwner = (op === 'crop') ? sets.length - 2 : sets.length - 1;
      faces.forEach(function (f) {
        var rp = AI.pathfinder.repPointOf(f);
        if (op === 'crop' && !AI.pathfinder.pointInRings(top, rp.x, rp.y)) return;
        var owner = -1;
        for (var k = topOwner; k >= 0; k--) {
          if (AI.pathfinder.pointInRings(sets[k], rp.x, rp.y)) { owner = k; break; }
        }
        if (owner < 0) return;                       /* 바깥 영역·구멍 · 틀만 덮은 자리 */
        pieces.push({ rings: f, owner: owner });
      });
      if (op === 'merge') {
        /* 같은 칠을 가진 조각끼리 합친다 */
        var groups = {}, order = [];
        pieces.forEach(function (p) {
          var src = items[p.owner];
          var k = paintKey(src.fill);
          if (!groups[k]) { groups[k] = { src: src, rings: [] }; order.push(k); }
          groups[k].rings.push(p.rings);
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
          produced.push(ringsToItem(app, AI.pathfinder.normalize(p.rings), st));
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
