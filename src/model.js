/* =========================================================================
   model.js — 문서 / 아이템 데이터 모델
   -------------------------------------------------------------------------
   item = {
     id, type: 'path' | 'text' | 'group',
     name, visible, locked, opacity, blend,
     m: [a,b,c,d,e,f]            // 부모 좌표계로의 변환
     fill, stroke                // paint 객체 (color.js)
     // path
     subs: [ { closed:bool, pts:[ {x,y, ix,iy, ox,oy} ] } ]
     shape: {kind:'rect'|'ellipse'|'polygon'|'star'|'line', ...}  // 라이브 셰이프 정보
     // text
     text: { content, family, size, weight, italic, leading, tracking, align }
     // group
     children: [item], clip:bool
   }
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, M = AI.mat, Col = AI.color;
  var Model = AI.model = {};

  /* ---------------- 기본 스타일 ---------------- */
  Model.defaultStroke = function () {
    return {
      type: 'none', color: '#000000', alpha: 1, width: 1,
      cap: 'butt', join: 'miter', miter: 10, dash: [], dashOffset: 0, align: 'center',
      arrowStart: 'none', arrowEnd: 'none', arrowScale: 100
    };
  };
  Model.mkStroke = function (hex, w) {
    var s = Model.defaultStroke();
    s.type = 'solid'; s.color = hex || '#000000'; s.width = w == null ? 1 : w;
    return s;
  };

  /* ---------------- 아이템 생성 ---------------- */
  function base(type, name) {
    return {
      id: U.uid(type), type: type, name: name || type,
      visible: true, locked: false, opacity: 1, blend: 'normal',
      m: M.ident(),
      fill: Col.solid('#cccccc'),
      stroke: Model.defaultStroke()
    };
  }

  Model.pt = function (x, y, ix, iy, ox, oy) {
    var p = { x: x, y: y };
    if (ix != null) { p.ix = ix; p.iy = iy; }
    if (ox != null) { p.ox = ox; p.oy = oy; }
    return p;
  };

  Model.newPath = function (subs) {
    var it = base('path', '패스');
    it.subs = subs || [{ closed: false, pts: [] }];
    it.shape = null;
    return it;
  };

  Model.newGroup = function (children) {
    var it = base('group', '그룹');
    it.children = children || [];
    it.clip = false;
    delete it.fill; delete it.stroke;
    return it;
  };

  Model.newImage = function (src, x, y, w, h) {
    var it = base('image', '이미지');
    it.src = src;
    it.w = w; it.h = h;
    it.m = M.translate(x, y);
    it.fill = Col.none();
    it.stroke = Model.defaultStroke();
    return it;
  };

  Model.newText = function (x, y, content) {
    var it = base('text', '텍스트');
    it.m = M.translate(x, y);
    it.text = {
      content: content == null ? '' : content,
      family: 'Noto Sans KR, sans-serif', size: 24, weight: 400, italic: false,
      leading: 1.2, tracking: 0, align: 'left'
    };
    it.fill = Col.solid('#000000');
    it.stroke = Model.defaultStroke();
    return it;
  };

  /* 패스 상의 문자 — subs 는 아이템 로컬 좌표의 기준선 패스 */
  Model.newPathText = function (x, y, content, subs) {
    var it = Model.newText(x, y, content);
    it.name = '패스 상의 문자';
    it.text.path = {
      subs: subs,
      start: 0,            /* 패스 시작점에서의 오프셋 (pt) */
      align: 'baseline',   /* 문자 맞추기: baseline · ascender · descender · center */
      flip: false          /* 패스 뒤집기 */
    };
    return it;
  };

  /* --- 라이브 셰이프: 로컬 좌표 (0,0)-(w,h) 기준으로 pts 재생성 --- */
  var K = 0.5522847498307936;

  Model.buildShape = function (it) {
    var s = it.shape; if (!s) return;
    var w, h, pts;
    if (s.kind === 'rect') {
      w = s.w; h = s.h;
      var r = Math.min(s.r || 0, Math.abs(w) / 2, Math.abs(h) / 2);
      if (r <= 0.001) {
        pts = [Model.pt(0, 0), Model.pt(w, 0), Model.pt(w, h), Model.pt(0, h)];
      } else {
        var k = r * K;
        pts = [
          { x: r, y: 0, ox: r - k, oy: 0 },
          { x: w - r, y: 0, ix: w - r + k, iy: 0 },
          { x: w, y: r, ix: w, iy: r - k, ox: w, oy: h - r + k },
          { x: w - r, y: h, ix: w - r + k, iy: h, ox: w - r + k, oy: h },
          { x: r, y: h, ix: r - k, iy: h, ox: r - k, oy: h },
          { x: 0, y: h - r, ix: 0, iy: h - r + k, ox: 0, oy: r - k }
        ];
        /* 정확한 라운드 사각형 (8 앵커) */
        pts = [
          { x: r, y: 0, ox: r - k, oy: 0 },
          { x: w - r, y: 0 },
          { x: w, y: r, ix: w, iy: r - k },
          { x: w, y: h - r },
          { x: w - r, y: h, ix: w - r + k, iy: h },
          { x: r, y: h },
          { x: 0, y: h - r, ix: 0, iy: h - r + k },
          { x: 0, y: r }
        ];
        pts[1].ox = w - r + k; pts[1].oy = 0;
        pts[3].ox = w; pts[3].oy = h - r + k;
        pts[5].ox = r - k; pts[5].oy = h;
        pts[7].ox = 0; pts[7].oy = r - k;
        pts[0].ix = r - k; pts[0].iy = 0;
        pts[2].ix = w; pts[2].iy = r - k;
        pts[4].ix = w - r + k; pts[4].iy = h;
        pts[6].ix = 0; pts[6].iy = h - r + k;
      }
      it.subs = [{ closed: true, pts: pts }];
    } else if (s.kind === 'ellipse') {
      w = s.w; h = s.h;
      var rx = w / 2, ry = h / 2, cx = rx, cy = ry, kx = rx * K, ky = ry * K;
      var span = Model.pieSpan(s);
      if (span < 359.999) {
        /* 파이 — 시작 각도에서 끝 각도까지의 부채꼴 (일러스트레이터의 원형 파이 위젯) */
        var a0 = s.pie.start * Math.PI / 180, a1 = a0 + span * Math.PI / 180;
        pts = [Model.pt(cx, cy)].concat(Model.arcPts(cx, cy, rx, ry, a0, a1));
        it.subs = [{ closed: true, pts: pts }];
      } else {
        pts = [
          { x: cx, y: 0, ix: cx - kx, iy: 0, ox: cx + kx, oy: 0 },
          { x: w, y: cy, ix: w, iy: cy - ky, ox: w, oy: cy + ky },
          { x: cx, y: h, ix: cx + kx, iy: h, ox: cx - kx, oy: h },
          { x: 0, y: cy, ix: 0, iy: cy + ky, ox: 0, oy: cy - ky }
        ];
        it.subs = [{ closed: true, pts: pts }];
      }
    } else if (s.kind === 'polygon' || s.kind === 'star') {
      var n = Math.max(3, s.n | 0), i, a, rr;
      pts = [];
      var start = -Math.PI / 2;
      if (s.kind === 'polygon') {
        for (i = 0; i < n; i++) {
          a = start + i * Math.PI * 2 / n;
          pts.push(Model.pt(s.r + Math.cos(a) * s.r, s.r + Math.sin(a) * s.r));
        }
      } else {
        for (i = 0; i < n * 2; i++) {
          a = start + i * Math.PI / n;
          rr = (i % 2 === 0) ? s.r : s.r2;
          pts.push(Model.pt(s.r + Math.cos(a) * rr, s.r + Math.sin(a) * rr));
        }
      }
      it.subs = [{ closed: true, pts: pts }];
    } else if (s.kind === 'line') {
      it.subs = [{ closed: false, pts: [Model.pt(0, 0), Model.pt(s.w, s.h)] }];
    }
  };

  /* 파이가 덮는 각도 (0 초과 360 이하). 파이 설정이 없으면 온전한 원. */
  Model.pieSpan = function (s) {
    if (!s || !s.pie) return 360;
    var d = (((s.pie.end - s.pie.start) % 360) + 360) % 360;
    return d < 0.001 ? 360 : d;
  };

  /* 타원 호를 큐빅 베지어 앵커 목록으로 — 90° 이하 조각으로 나눠 근사한다 */
  Model.arcPts = function (cx, cy, rx, ry, a0, a1) {
    var n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2)));
    var da = (a1 - a0) / n;
    var k = 4 / 3 * Math.tan(da / 4);
    var out = [];
    for (var i = 0; i <= n; i++) {
      var a = a0 + i * da;
      var x = cx + rx * Math.cos(a), y = cy + ry * Math.sin(a);
      var dx = -rx * Math.sin(a) * k, dy = ry * Math.cos(a) * k;
      var p = { x: x, y: y };
      if (i > 0) { p.ix = x - dx; p.iy = y - dy; }
      if (i < n) { p.ox = x + dx; p.oy = y + dy; }
      out.push(p);
    }
    return out;
  };

  Model.newRect = function (x, y, w, h, r) {
    var it = Model.newPath();
    it.name = r ? '둥근 사각형' : '사각형';
    it.shape = { kind: 'rect', w: w, h: h, r: r || 0 };
    it.m = M.translate(x, y);
    Model.buildShape(it);
    return it;
  };
  Model.newEllipse = function (x, y, w, h) {
    var it = Model.newPath();
    it.name = '타원';
    it.shape = { kind: 'ellipse', w: w, h: h };
    it.m = M.translate(x, y);
    Model.buildShape(it);
    return it;
  };
  Model.newPolygon = function (cx, cy, r, n) {
    var it = Model.newPath();
    it.name = '다각형';
    it.shape = { kind: 'polygon', r: r, n: n || 6 };
    it.m = M.translate(cx - r, cy - r);
    Model.buildShape(it);
    return it;
  };
  Model.newStar = function (cx, cy, r, r2, n) {
    var it = Model.newPath();
    it.name = '별';
    it.shape = { kind: 'star', r: r, r2: r2, n: n || 5 };
    it.m = M.translate(cx - r, cy - r);
    Model.buildShape(it);
    return it;
  };
  Model.newLine = function (x1, y1, x2, y2) {
    var it = Model.newPath();
    it.name = '선';
    it.shape = { kind: 'line', w: x2 - x1, h: y2 - y1 };
    it.m = M.translate(x1, y1);
    it.fill = Col.none();
    it.stroke = Model.mkStroke('#000000', 1);
    Model.buildShape(it);
    return it;
  };

  /* 라이브 셰이프 해제 (직접 편집 시) */
  Model.expandShape = function (it) {
    if (it.shape) { it.shape = null; }
  };

  /* ---------------- 레이어 / 문서 ---------------- */
  /* Illustrator 기본 레이어 색상 순서 */
  Model.LAYER_COLORS = [
    '#4ca6de', '#e04a3f', '#64b564', '#e8a33d', '#9b7fd4',
    '#3fb8af', '#d96ba0', '#8d8d8d', '#c0a02c', '#5b78d8'
  ];
  var layerSeq = 0;
  Model.newLayer = function (name, index) {
    var i = index == null ? layerSeq++ : index;
    return {
      id: U.uid('L'), type: 'layer', name: name || '레이어 1',
      visible: true, locked: false,
      color: Model.LAYER_COLORS[i % Model.LAYER_COLORS.length],
      children: []
    };
  };

  Model.newDoc = function (w, h) {
    w = w || 800; h = h || 600;
    return {
      name: '무제-1',
      width: w, height: h,
      artboards: [{ id: U.uid('AB'), name: '대지 1', x: 0, y: 0, w: w, h: h }],
      activeArtboard: 0,
      layers: [Model.newLayer('레이어 1')],
      activeLayer: 0,
      guides: [],        /* {axis:'h'|'v', pos:number} */
      charStyles: [],    /* 문자 스타일 */
      paraStyles: [],    /* 단락 스타일 */
      rulerOrigin: { x: 0, y: 0 },   /* 눈금자 0 위치 (문서 좌표의 반대 부호) */
      bg: '#ffffff'
    };
  };

  /* ---------------- 트리 순회 ---------------- */
  /* 모든 아이템 (레이어 자식부터 재귀) */
  Model.walk = function (doc, fn) {
    function rec(list, parent, layer) {
      for (var i = 0; i < list.length; i++) {
        var it = list[i];
        if (fn(it, list, i, parent, layer) === false) return false;
        if (it.type === 'group') { if (rec(it.children, it, layer) === false) return false; }
      }
      return true;
    }
    for (var L = 0; L < doc.layers.length; L++) {
      if (rec(doc.layers[L].children, null, doc.layers[L]) === false) return;
    }
  };

  /* 월드 행렬 · 유효 잠금/표시 상태를 누적하며 한 번에 순회 (O(n))
     fn(item, info) — info = {m, locked, visible, list, index, parent, layer, depth}
     fn 이 false 를 반환하면 그 아이템의 하위(그룹 자식)는 건너뛴다. */
  Model.walkWorld = function (doc, fn, opts) {
    opts = opts || {};
    function rec(list, pm, locked, visible, parent, layer, depth) {
      for (var i = 0; i < list.length; i++) {
        var it = list[i];
        var lk = locked || !!it.locked;
        var vi = visible && it.visible !== false;
        if (opts.skipLocked && lk) continue;
        if (opts.skipHidden && !vi) continue;
        var m = M.mul(pm, it.m);
        var r = fn(it, { m: m, locked: lk, visible: vi, list: list, index: i, parent: parent, layer: layer, depth: depth });
        if (r === false) continue;
        if (it.type === 'group') rec(it.children, m, lk, vi, it, layer, depth + 1);
      }
    }
    for (var L = 0; L < doc.layers.length; L++) {
      var ly = doc.layers[L];
      if (opts.skipLocked && ly.locked) continue;
      if (opts.skipHidden && !ly.visible) continue;
      rec(ly.children, opts.base || M.ident(), !!ly.locked, ly.visible !== false, null, ly, 0);
    }
  };

  Model.find = function (doc, id) {
    var res = null;
    Model.walk(doc, function (it) { if (it.id === id) { res = it; return false; } });
    return res;
  };

  /* 아이템의 부모 배열 + 인덱스 */
  Model.locate = function (doc, item) {
    var res = null;
    Model.walk(doc, function (it, list, i, parent, layer) {
      if (it === item) { res = { list: list, index: i, parent: parent, layer: layer }; return false; }
    });
    return res;
  };

  /* 아이템 -> 문서(월드) 좌표 변환 행렬 */
  Model.worldMatrix = function (doc, item) {
    var chain = [];
    function rec(list, acc) {
      for (var i = 0; i < list.length; i++) {
        var it = list[i];
        if (it === item) { chain = acc.concat([it]); return true; }
        if (it.type === 'group' && rec(it.children, acc.concat([it]))) return true;
      }
      return false;
    }
    for (var L = 0; L < doc.layers.length; L++) if (rec(doc.layers[L].children, [])) break;
    var m = M.ident();
    for (var i = 0; i < chain.length; i++) m = M.mul(m, chain[i].m);
    return m;
  };

  /* 아이템이 잠기거나 숨겨진 상태인지(상위 포함) */
  Model.effLocked = function (doc, item) {
    var loc = Model.locate(doc, item);
    if (!loc) return false;
    if (item.locked) return true;
    var p = loc.parent;
    while (p) { if (p.locked) return true; var l2 = Model.locate(doc, p); p = l2 && l2.parent; }
    return loc.layer ? !!loc.layer.locked : false;
  };
  Model.effVisible = function (doc, item) {
    var loc = Model.locate(doc, item);
    if (!loc) return false;
    if (!item.visible) return false;
    var p = loc.parent;
    while (p) { if (!p.visible) return false; var l2 = Model.locate(doc, p); p = l2 && l2.parent; }
    return loc.layer ? !!loc.layer.visible : true;
  };

  Model.activeLayer = function (doc) {
    return doc.layers[U.clamp(doc.activeLayer, 0, doc.layers.length - 1)] || doc.layers[0];
  };

  /* 최상위(레이어 직속) 아이템 목록 - 위(앞)에서부터 */
  Model.topItems = function (doc) {
    var out = [];
    for (var L = doc.layers.length - 1; L >= 0; L--) {
      var ly = doc.layers[L];
      for (var i = ly.children.length - 1; i >= 0; i--) out.push({ item: ly.children[i], layer: ly, list: ly.children, index: i });
    }
    return out;
  };

  /* 아이템의 모든 앵커 포인트 개수 */
  Model.countPts = function (it) {
    var n = 0;
    if (it.subs) for (var i = 0; i < it.subs.length; i++) n += it.subs[i].pts.length;
    return n;
  };

})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
