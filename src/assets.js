/* =========================================================================
   assets.js — 심볼 · 패턴 (문서에 저장되는 재사용 자산)
   -------------------------------------------------------------------------
     doc.symbols  = [ { id, name, item } ]        // item 은 정의(원본) 아트웍
     doc.patterns = [ { id, name, item, w, h } ]  // 타일 하나의 아트웍과 크기

   심볼 인스턴스는 { type:'symbol', symbolId, m } 아이템이다.
   정의를 고치면 모든 인스턴스가 함께 바뀐다 (일러스트레이터와 동일).

   패턴은 페인트로 쓴다: { type:'pattern', patternId, scale, angle }
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, M = AI.mat, R = AI.rect, Model = AI.model, Col = AI.color;
  var AS = AI.assets = {};

  function ensure(doc) {
    if (!doc.symbols) doc.symbols = [];
    if (!doc.patterns) doc.patterns = [];
  }
  AS.ensure = ensure;

  /* ---------------- 심볼 ---------------- */
  AS.findSymbol = function (doc, id) {
    ensure(doc);
    for (var i = 0; i < doc.symbols.length; i++) if (doc.symbols[i].id === id) return doc.symbols[i];
    return null;
  };

  /* 선택 아트웍을 심볼로 등록하고, 원본 자리는 인스턴스로 바꾼다 */
  AS.defineSymbol = function (app, name) {
    ensure(app.doc);
    if (!app.sel.length) return null;
    var ordered = [];
    Model.walk(app.doc, function (it) { if (app.sel.indexOf(it) >= 0) ordered.push(it); });
    if (!ordered.length) return null;

    /* 정의는 (0,0) 기준으로 정규화해 담는다 */
    var r = R.empty();
    ordered.forEach(function (it) { r = R.union(r, AI.render.worldBounds(app.doc, it, false)); });
    if (R.isEmpty(r)) return null;

    var kids = ordered.map(function (it) {
      var c = U.deepCopy(it);
      c.id = U.uid(it.type);
      c.m = M.mul(M.translate(-r.x, -r.y), Model.worldMatrix(app.doc, it));
      return c;
    });
    var def = {
      id: U.uid('SYM'),
      name: name || ('심볼 ' + (app.doc.symbols.length + 1)),
      item: kids.length === 1 ? kids[0] : Model.newGroup(kids)
    };
    if (kids.length > 1) def.item.m = M.ident();
    app.doc.symbols.push(def);

    /* 원본을 인스턴스로 교체 */
    var anchor = Model.locate(app.doc, ordered[ordered.length - 1]);
    var list = anchor ? anchor.list : Model.activeLayer(app.doc).children;
    var at = anchor ? anchor.index : list.length;
    ordered.forEach(function (it) {
      var l = Model.locate(app.doc, it);
      if (l) { l.list.splice(l.index, 1); if (l.list === list && l.index < at) at--; }
    });
    var inst = AS.newInstance(def, r.x, r.y);
    list.splice(Math.min(at + 1, list.length), 0, inst);
    AI.sel.set(app, [inst]);
    return def;
  };

  AS.newInstance = function (def, x, y) {
    var it = {
      id: U.uid('symbol'), type: 'symbol', name: def.name,
      visible: true, locked: false, opacity: 1, blend: 'normal',
      m: M.translate(x || 0, y || 0),
      symbolId: def.id
    };
    return it;
  };

  AS.placeSymbol = function (app, id, x, y) {
    var def = AS.findSymbol(app.doc, id);
    if (!def) return null;
    var it = AS.newInstance(def, x, y);
    Model.activeLayer(app.doc).children.push(it);
    AI.sel.set(app, [it]);
    return it;
  };

  /* 인스턴스를 실제 아트웍으로 (심볼 링크 끊기) */
  AS.breakLink = function (app) {
    var made = [], any = false;
    app.sel.slice().forEach(function (it) {
      if (it.type !== 'symbol') { made.push(it); return; }
      var def = AS.findSymbol(app.doc, it.symbolId);
      if (!def) { made.push(it); return; }
      var c = U.deepCopy(def.item);
      reid(c);
      c.m = M.mul(it.m, c.m);
      c.opacity = it.opacity;
      c.blend = it.blend;
      c.name = def.name;
      var loc = Model.locate(app.doc, it);
      if (loc) loc.list.splice(loc.index, 1, c);
      else Model.activeLayer(app.doc).children.push(c);
      made.push(c);
      any = true;
    });
    if (!any) return false;
    AI.sel.set(app, made);
    return true;
  };

  /* 선택한 인스턴스의 현재 모습으로 심볼 정의를 갱신한다 */
  AS.redefineFromSelection = function (app, id) {
    var def = AS.findSymbol(app.doc, id);
    if (!def || app.sel.length !== 1) return false;
    var it = app.sel[0];
    if (it.type === 'symbol') return false;
    var b = AI.render.worldBounds(app.doc, it, false);
    var c = U.deepCopy(it);
    reid(c);
    c.m = M.mul(M.translate(-b.x, -b.y), Model.worldMatrix(app.doc, it));
    def.item = c;
    return true;
  };

  AS.removeSymbol = function (app, id) {
    ensure(app.doc);
    var used = 0;
    Model.walk(app.doc, function (it) { if (it.type === 'symbol' && it.symbolId === id) used++; });
    if (used) return used;                       /* 쓰이는 중이면 지우지 않는다 */
    app.doc.symbols = app.doc.symbols.filter(function (s) { return s.id !== id; });
    return 0;
  };

  function reid(it) {
    it.id = U.uid(it.type);
    if (it.children) it.children.forEach(reid);
  }
  AS.reid = reid;

  /* ---------------- 패턴 ---------------- */
  AS.findPattern = function (doc, id) {
    ensure(doc);
    for (var i = 0; i < doc.patterns.length; i++) if (doc.patterns[i].id === id) return doc.patterns[i];
    return null;
  };

  AS.definePattern = function (app, name) {
    ensure(app.doc);
    if (!app.sel.length) return null;
    var ordered = [];
    Model.walk(app.doc, function (it) { if (app.sel.indexOf(it) >= 0) ordered.push(it); });
    var r = R.empty();
    ordered.forEach(function (it) { r = R.union(r, AI.render.worldBounds(app.doc, it, false)); });
    if (R.isEmpty(r)) return null;

    var kids = ordered.map(function (it) {
      var c = U.deepCopy(it);
      reid(c);
      c.m = M.mul(M.translate(-r.x, -r.y), Model.worldMatrix(app.doc, it));
      return c;
    });
    var def = {
      id: U.uid('PAT'),
      name: name || ('패턴 ' + (app.doc.patterns.length + 1)),
      item: kids.length === 1 ? kids[0] : Model.newGroup(kids),
      w: Math.max(1, R.w(r)), h: Math.max(1, R.h(r))
    };
    if (kids.length > 1) def.item.m = M.ident();
    app.doc.patterns.push(def);
    return def;
  };

  AS.patternPaint = function (def, opt) {
    opt = opt || {};
    return {
      type: 'pattern', patternId: def.id,
      scale: opt.scale == null ? 100 : opt.scale,
      angle: opt.angle || 0,
      alpha: opt.alpha == null ? 1 : opt.alpha
    };
  };

  /* 타일을 캔버스로 굽는다 — 렌더러가 createPattern 에 넘긴다 */
  var tileCache = Object.create(null);
  var baking = 0;
  AS.tileCanvas = function (app, def, scale) {
    if (!U.hasDOM) return null;
    if (baking > 2) return null;      /* 패턴 안의 패턴이 무한히 겹치지 않게 */
    var k = def.id + '@' + U.round(scale, 3) + '#' + (def.__rev || 0);
    var hit = tileCache[k];
    if (hit) return hit;
    var w = Math.max(1, Math.round(def.w * scale)), h = Math.max(1, Math.round(def.h * scale));
    if (w > 2048 || h > 2048) {
      var k2 = Math.min(2048 / w, 2048 / h);
      w = Math.max(1, Math.round(w * k2)); h = Math.max(1, Math.round(h * k2));
      scale = scale * k2;
    }
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d');
    var fake = { doc: app.doc, view: { scale: scale, tx: 0, ty: 0 }, prefs: app.prefs, dpr: 1, sel: [], selPts: [], isolation: null };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    baking++;
    try { AI.render.item(ctx, fake, def.item, M.scale(scale, scale), 1, undefined); }
    finally { baking--; }
    tileCache[k] = cv;
    /* 캐시가 무한정 자라지 않게 */
    var keys = Object.keys(tileCache);
    if (keys.length > 40) delete tileCache[keys[0]];
    return cv;
  };
  AS.invalidateTiles = function () { tileCache = Object.create(null); };
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
