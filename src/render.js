/* =========================================================================
   render.js — 캔버스 렌더러 (아트워크 + 선택 UI)
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, M = AI.mat, R = AI.rect, G = AI.geom, Col = AI.color, Model = AI.model;
  var Rn = AI.render = {};

  var mctx = U.hasDOM ? document.createElement('canvas').getContext('2d') : null;

  /* 캔버스가 없는 환경(Node)용 근사 글자폭 — 전각 1.0em, 그 외 0.52em */
  function approxWidth(str, size) {
    var w = 0;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      var wide = (c >= 0x1100 && c <= 0x115F) || (c >= 0x2E80 && c <= 0xA4CF) ||
        (c >= 0xAC00 && c <= 0xD7A3) || (c >= 0xF900 && c <= 0xFAFF) ||
        (c >= 0xFE30 && c <= 0xFE6F) || (c >= 0xFF00 && c <= 0xFF60) || (c >= 0xFFE0 && c <= 0xFFE6);
      w += wide ? 1.0 : 0.52;
    }
    return w * size;
  }
  Rn.measureLine = function (line, t) {
    if (mctx) { mctx.font = Rn.fontCss(t); return mctx.measureText(line).width; }
    return approxWidth(line, t.size);
  };
  Rn.hasCanvas = function () { return !!mctx; };

  /* ---------------- 텍스트 계측 ---------------- */
  Rn.fontCss = function (t) {
    return (t.italic ? 'italic ' : '') + (t.weight || 400) + ' ' + t.size + 'px ' + t.family;
  };
  Rn.textLines = function (it) { return Rn.layoutText(it).lines; };

  /* ---------------- 텍스트 레이아웃 ----------------
     점 문자: 줄바꿈 문자로만 나뉜다.
     영역 문자(it.text.area): 상자 폭(또는 도형의 가로 span)에 맞춰 자동 줄바꿈하고,
     상자 높이를 넘는 줄은 넘침으로 표시한다.                                  */
  Rn.layoutText = function (it) {
    var t = it.text;
    var lh = t.size * (t.leading || 1.2);
    var asc = t.size * 0.8;
    var tr = t.tracking || 0;
    function widthOf(str) { return Rn.measureLine(str, t) + Math.max(0, str.length - 1) * tr; }

    /* 패스 상 문자 — 글자 하나씩 호 길이를 따라 놓는다 */
    if (t.path) return layoutOnPath(it, lh, asc, tr);

    if (!t.area) {
      var raw = String(t.content).split('\n');
      var w0 = 0;
      raw.forEach(function (l) { w0 = Math.max(w0, widthOf(l)); });
      return {
        lines: raw, xs: raw.map(function () { return 0; }), widths: raw.map(widthOf),
        w: w0, h: (raw.length - 1) * lh + t.size, lineH: lh, asc: asc, overflow: false, area: null
      };
    }

    var area = t.area;
    var lines = [], xs = [], widths = [];
    var y = asc;                                   /* 첫 줄의 기준선 */
    var overflow = false;
    var paras = String(t.content).split('\n');

    for (var pi = 0; pi < paras.length; pi++) {
      var rest = paras[pi];
      do {
        var span = spanAt(it, y, lh);
        if (!span) {                               /* 이 높이에는 글자를 놓을 자리가 없다 */
          y += lh;
          if (y - asc > area.h + lh * 4) { overflow = rest.length > 0; break; }
          continue;
        }
        var avail = span.x2 - span.x;
        var take = fitLine(rest, avail, widthOf);
        var line = take.line;
        lines.push(line);
        widths.push(widthOf(line));
        xs.push(alignX(span, widthOf(line), t.align));
        rest = take.rest;
        y += lh;
        if (y - asc > area.h && (rest.length || pi < paras.length - 1)) { overflow = true; rest = ''; pi = paras.length; break; }
      } while (rest.length);
      if (pi >= paras.length) break;
    }
    if (!lines.length) { lines.push(''); xs.push(alignX({ x: 0, x2: area.w }, 0, t.align)); widths.push(0); }

    return {
      lines: lines, xs: xs, widths: widths,
      w: area.w, h: area.h, lineH: lh, asc: asc, overflow: overflow, area: area
    };
  };

  /* ---------------- 패스 상 문자 레이아웃 ----------------
     t.path = { subs, start, align, flip, effect } — subs 는 아이템 로컬 좌표.
     글자마다 진행 거리를 재어 그 지점의 접선 각도로 세운다. */
  Rn.pathWalker = function (it) {
    var t = it.text;
    if (!t || !t.path) return null;
    /* 같은 패스에는 같은 순회기를 재사용한다 (글자마다 다시 평탄화하면 비싸다) */
    var w = it.__walk;
    if (w && w.subs === t.path.subs) return w.walk;
    var walk = G.walker(t.path.subs, 0.3, null);
    try {
      Object.defineProperty(it, '__walk', {
        value: { subs: t.path.subs, walk: walk }, writable: true, configurable: true, enumerable: false
      });
    } catch (err) { it.__walk = { subs: t.path.subs, walk: walk }; }
    return walk;
  };

  function layoutOnPath(it, lh, asc, tr) {
    var t = it.text, pth = t.path;
    var walk = Rn.pathWalker(it);
    var chars = String(t.content).replace(/\n/g, ' ').split('');
    var adv = chars.map(function (c) { return Rn.measureLine(c, t) + tr; });
    var total = adv.reduce(function (a, b) { return a + b; }, 0) - (chars.length ? tr : 0);
    var len = walk ? walk.length : 0;

    /* 정렬 = 패스 위에서의 시작 위치 (왼쪽 / 가운데 / 오른쪽 맞추기) */
    var s0 = pth.start || 0;
    if (t.align === 'center') s0 += (len - total) / 2;
    else if (t.align === 'right') s0 += len - total;

    /* 기준선 오프셋 — 일러스트레이터의 [문자 맞추기] */
    var off = pth.align === 'ascender' ? -asc
      : pth.align === 'descender' ? t.size * 0.2
        : pth.align === 'center' ? -asc / 2 : 0;
    if (pth.flip) off = -off;

    var glyphs = [], s = s0, overflow = false;
    var r = R.empty();
    for (var i = 0; i < chars.length; i++) {
      var mid = s + adv[i] / 2;
      if (walk && (mid < -adv[i] || mid > len + adv[i])) { overflow = true; s += adv[i]; continue; }
      var q = walk ? walk.at(mid) : null;
      if (!q) { s += adv[i]; continue; }
      var ang = q.ang + (pth.flip ? Math.PI : 0);
      var nx = -Math.sin(ang), ny = Math.cos(ang);
      /* 글자 왼쪽 아래(기준선 시작점)로 되돌린다 */
      var half = adv[i] / 2 - tr / 2;
      glyphs.push({
        ch: chars[i], ang: ang, adv: adv[i],
        x: q.x - Math.cos(ang) * half + nx * off,
        y: q.y - Math.sin(ang) * half + ny * off
      });
      var g = glyphs[glyphs.length - 1];
      R.add(r, g.x, g.y);
      R.add(r, g.x + Math.cos(ang) * adv[i], g.y + Math.sin(ang) * adv[i]);
      R.add(r, g.x - nx * asc, g.y - ny * asc);
      R.add(r, g.x + Math.cos(ang) * adv[i] - nx * asc, g.y + Math.sin(ang) * adv[i] - ny * asc);
      s += adv[i];
    }
    if (R.isEmpty(r)) r = G.pathBounds({ subs: pth.subs }, null);
    return {
      lines: [chars.join('')], xs: [0], widths: [total], glyphs: glyphs,
      box: r, w: R.w(r), h: R.h(r), lineH: lh, asc: asc,
      overflow: overflow, area: null, pathLen: len, textLen: total
    };
  }

  function alignX(span, w, align) {
    if (align === 'center') return (span.x + span.x2) / 2 - w / 2;
    if (align === 'right') return span.x2 - w;
    return span.x;
  }

  /* 한 줄에 들어갈 만큼 잘라 낸다 — 공백 우선, 안 되면 글자 단위 (한글 대응) */
  function fitLine(str, avail, widthOf) {
    if (!str.length) return { line: '', rest: '' };
    if (widthOf(str) <= avail) return { line: str, rest: '' };
    var lastSpace = -1;
    for (var i = 1; i <= str.length; i++) {
      if (widthOf(str.slice(0, i)) > avail) {
        var cut = (lastSpace > 0) ? lastSpace : Math.max(1, i - 1);
        var line = str.slice(0, cut).replace(/\s+$/, '');
        var rest = str.slice(cut).replace(/^\s+/, '');
        return { line: line, rest: rest };
      }
      if (str[i - 1] === ' ') lastSpace = i;
    }
    return { line: str, rest: '' };
  }

  /* 기준선 y 위치에서 글자를 놓을 수 있는 가로 구간
     — 사각형 상자면 [0,w], 도형이면 스캔라인 교차의 가장 넓은 구간 */
  function spanAt(it, y, lh) {
    var area = it.text.area;
    if (y - it.text.size * 0.8 > area.h) return null;
    var shape = it.text.areaShape;
    if (!shape || !shape.length) return { x: 0, x2: area.w };
    /* 글자 높이 밴드의 위·아래에서 각각 교차 구간을 구해 겹치는 부분을 쓴다 */
    var top = scanSpans(shape, y - it.text.size * 0.72);
    var bot = scanSpans(shape, y + it.text.size * 0.1);
    var best = null;
    top.forEach(function (a) {
      bot.forEach(function (b) {
        var x = Math.max(a.x, b.x), x2 = Math.min(a.x2, b.x2);
        if (x2 - x > it.text.size * 0.6 && (!best || x2 - x > best.x2 - best.x)) best = { x: x, x2: x2 };
      });
    });
    return best;
  }

  var scanCache = null;
  function scanSpans(subs, y) {
    var xs = [];
    subs.forEach(function (sub) {
      var pts = G.flattenSub(sub, 0.4);
      var n = pts.length;
      for (var i = 0; i < n; i++) {
        var a = pts[i], b = pts[(i + 1) % n];
        if ((a.y > y) === (b.y > y)) continue;
        xs.push(a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y));
      }
    });
    xs.sort(function (p, q) { return p - q; });
    var out = [];
    for (var k = 0; k + 1 < xs.length; k += 2) out.push({ x: xs[k], x2: xs[k + 1] });
    return out;
  }

  Rn.measureText = function (it) {
    var L = Rn.layoutText(it);
    return {
      w: L.w, h: L.h, lineH: L.lineH, lines: L.lines, asc: L.asc, xs: L.xs,
      overflow: L.overflow, area: L.area, glyphs: L.glyphs, box: L.box,
      pathLen: L.pathLen, textLen: L.textLen
    };
  };
  /* ---------------- 이미지 캐시 ---------------- */
  Rn.imageCache = Object.create(null);
  Rn.getImage = function (src, onLoad) {
    var im = Rn.imageCache[src];
    if (!im) {
      im = new Image();
      Rn.imageCache[src] = im;
      im.onload = function () { if (onLoad) onLoad(); };
      im.onerror = function () { im.__failed = true; if (onLoad) onLoad(); };
      im.src = src;
    }
    return im;
  };

  /* ---------------- 아이템 바운딩 (로컬) ---------------- */
  /* 기하 효과(왜곡 및 변형)가 걸려 있으면 변형된 결과들의 합집합이 바운딩이다 */
  Rn.pathBoundsFx = function (it, m) {
    var px = AI.distort.proxies(it);
    if (!px) return G.pathBounds(it, m);
    var r = R.empty();
    for (var i = 0; i < px.length; i++) {
      r = R.union(r, G.pathBounds(px[i], m ? M.mul(m, px[i].fxm) : px[i].fxm));
    }
    return r;
  };

  Rn.localBounds = function (it) {
    if (it.type === 'path') return Rn.pathBoundsFx(it, null);
    if (it.type === 'image') return { x: 0, y: 0, x2: it.w, y2: it.h };
    if (it.type === 'symbol') {
      var def = Rn.symbolDef && Rn.symbolDef(it);
      if (!def) return R.empty();
      return Rn.xformBounds(Rn.localBounds(def.item), def.item.m);
    }
    if (it.type === 'text') {
      var m = Rn.measureText(it), t = it.text, x0 = 0;
      if (t.path) return m.box || G.pathBounds({ subs: t.path.subs }, null);
      if (t.area) return { x: 0, y: 0, x2: t.area.w, y2: t.area.h };
      if (t.align === 'center') x0 = -m.w / 2; else if (t.align === 'right') x0 = -m.w;
      var last = (m.lines.length - 1) * m.lineH;
      return { x: x0, y: -m.asc, x2: x0 + m.w, y2: last + t.size * 0.25 };
    }
    if (it.type === 'group') {
      var r = R.empty();
      for (var i = 0; i < it.children.length; i++) {
        var c = it.children[i];
        var b = Rn.localBounds(c);
        if (R.isEmpty(b)) continue;
        r = R.union(r, Rn.xformBounds(b, c.m));
      }
      return r;
    }
    return R.empty();
  };

  Rn.xformBounds = function (b, m) {
    if (R.isEmpty(b)) return b;
    var r = R.empty(), pts = [[b.x, b.y], [b.x2, b.y], [b.x2, b.y2], [b.x, b.y2]];
    for (var i = 0; i < 4; i++) { var p = M.apply(m, pts[i][0], pts[i][1]); R.add(r, p.x, p.y); }
    return r;
  };

  /* 누적 행렬 m 을 직접 받는 바운딩 — 트리를 되짚지 않으므로 O(항목수)
     sw: 획 두께에 곱할 배율 (화면 좌표계 계산 시 view.scale) */
  Rn.boundsM = function (it, m, geo, sw) {
    if (it.type === 'group') {
      var r = R.empty();
      for (var i = 0; i < it.children.length; i++) {
        r = R.union(r, Rn.boundsM(it.children[i], M.mul(m, it.children[i].m), geo, sw));
      }
      if (!geo && AI.effects.has(it) && !R.isEmpty(r)) r = R.grow(r, AI.effects.padding(it) * (sw == null ? 1 : sw));
      return r;
    }
    var b = (it.type === 'path') ? Rn.pathBoundsFx(it, m) : Rn.xformBounds(Rn.localBounds(it), m);
    if (!geo && it.type === 'path') {
      var maxPad = 0;
      AI.appearance.strokes(it).forEach(function (e) {
        var st = e.stroke;
        if (!st || st.type === 'none') return;
        var al = st.align, k = al === 'inside' ? 0 : al === 'outside' ? 1 : 0.5;
        maxPad = Math.max(maxPad, (st.width || 0) * k);
      });
      if (maxPad) b = R.grow(b, maxPad * (sw == null ? 1 : sw));
    }
    if (!geo && AI.effects.has(it)) b = R.grow(b, AI.effects.padding(it) * (sw == null ? 1 : sw));
    return b;
  };

  /* 월드 바운딩 (문서 좌표) — geo=true 면 획 두께 무시 */
  Rn.worldBounds = function (doc, it, geo) {
    Rn.__doc = doc;                 /* 심볼 정의를 찾을 수 있게 현재 문서를 기억 */
    return Rn.boundsM(it, Model.worldMatrix(doc, it), geo, 1);
  };

  Rn.selectionBounds = function (app, geo) {
    var r = R.empty();
    for (var i = 0; i < app.sel.length; i++) r = R.union(r, Rn.worldBounds(app.doc, app.sel[i], geo));
    return r;
  };

  /* ---------------- paint -> canvas style ---------------- */
  function paintStyle(ctx, paint, viewBounds, m) {
    if (!paint || paint.type === 'none') return null;
    if (paint.type === 'solid') return Col.toCss(paint.color, paint.alpha);
    if (paint.type === 'pattern') return patternStyle(ctx, paint, m);
    var b = viewBounds;
    if (R.isEmpty(b)) return Col.toCss(paint.stops[0].color, paint.stops[0].alpha);
    var g;
    /* 그레이디언트 주석자로 직접 지정한 기하가 있으면 그것을 쓴다 (로컬 좌표) */
    if (m && paint.p0 && paint.p1) {
      var a0 = M.apply(m, paint.p0.x, paint.p0.y), a1 = M.apply(m, paint.p1.x, paint.p1.y);
      if (paint.type === 'radial') {
        var rr = Math.max(U.dist(a0.x, a0.y, a1.x, a1.y), 0.01);
        g = ctx.createRadialGradient(a0.x, a0.y, 0, a0.x, a0.y, rr);
      } else {
        g = ctx.createLinearGradient(a0.x, a0.y, a1.x, a1.y);
      }
      paint.stops.slice().sort(function (p, q) { return p.t - q.t; }).forEach(function (st) {
        g.addColorStop(U.clamp(st.t, 0, 1), Col.toCss(st.color, st.alpha));
      });
      return g;
    }
    if (paint.type === 'radial') {
      var cx = b.x + R.w(b) * (paint.cx == null ? .5 : paint.cx);
      var cy = b.y + R.h(b) * (paint.cy == null ? .5 : paint.cy);
      var rad = Math.max(R.w(b), R.h(b)) * (paint.r == null ? .5 : paint.r);
      g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rad, .01));
    } else {
      var a = U.rad(paint.angle || 0);
      var cx0 = R.cx(b), cy0 = R.cy(b);
      var len = (Math.abs(Math.cos(a)) * R.w(b) + Math.abs(Math.sin(a)) * R.h(b)) / 2;
      g = ctx.createLinearGradient(cx0 - Math.cos(a) * len, cy0 - Math.sin(a) * len,
        cx0 + Math.cos(a) * len, cy0 + Math.sin(a) * len);
    }
    paint.stops.slice().sort(function (p, q) { return p.t - q.t; }).forEach(function (s) {
      g.addColorStop(U.clamp(s.t, 0, 1), Col.toCss(s.color, s.alpha));
    });
    return g;
  }

  /* 패턴 칠 — 타일 캔버스를 화면 배율에 맞춰 굽고 CanvasPattern 으로 만든다 */
  function patternStyle(ctx, paint, m) {
    var app = Rn.__app;
    if (!app || !U.hasDOM) return '#cccccc';
    var def = AI.assets.findPattern(app.doc, paint.patternId);
    if (!def) return '#cccccc';
    var sc = ((app.view && app.view.scale) || 1) * ((paint.scale == null ? 100 : paint.scale) / 100);
    var cv = AI.assets.tileCanvas(app, def, sc);
    if (!cv) return '#cccccc';
    var pat = ctx.createPattern(cv, 'repeat');
    if (!pat) return '#cccccc';
    if (pat.setTransform && paint.angle) {
      var a = U.rad(paint.angle);
      try { pat.setTransform(new DOMMatrix([Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0])); } catch (e) { }
    }
    return pat;
  }

  /* ---------------- 아트워크 ---------------- */
  Rn.scene = function (ctx, app) {
    Rn.__app = app; Rn.__doc = app.doc;
    var doc = app.doc, vw = ctx.canvas.width / app.dpr, vh = ctx.canvas.height / app.dpr;

    ctx.save();
    ctx.setTransform(app.dpr, 0, 0, app.dpr, 0, 0);
    if (app.exporting) ctx.clearRect(0, 0, vw, vh);
    else {
      ctx.fillStyle = (U.hasDOM && document.body)
        ? (getComputedStyle(document.body).getPropertyValue('--canvas-bg').trim() || '#3a3a3a')
        : '#3a3a3a';
      ctx.fillRect(0, 0, vw, vh);
    }

    /* 내보내기 모드: 대지 배경만 */
    if (app.exporting) {
      var ab0 = doc.artboards[doc.activeArtboard] || doc.artboards[0];
      if (app.exportBg !== false && ab0) {
        var q0 = AI.viewT.toScreen(app, ab0.x, ab0.y);
        ctx.fillStyle = doc.bg || '#fff';
        ctx.fillRect(q0.x, q0.y, ab0.w * app.view.scale, ab0.h * app.view.scale);
      }
      var vmE = AI.viewT.matrix(app);
      for (var LE = 0; LE < doc.layers.length; LE++) {
        if (!doc.layers[LE].visible) continue;
        drawList(ctx, app, doc.layers[LE].children, vmE, 1);
      }
      ctx.restore();
      return;
    }

    /* 대지 */
    doc.artboards.forEach(function (ab, i) {
      var p = AI.viewT.toScreen(app, ab.x, ab.y), s = app.view.scale;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 2;
      ctx.fillStyle = doc.bg || '#fff';
      ctx.fillRect(p.x, p.y, ab.w * s, ab.h * s);
      ctx.restore();
      ctx.strokeStyle = (i === doc.activeArtboard) ? '#8a8a8a' : '#5a5a5a';
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(p.x) + .5, Math.round(p.y) + .5, Math.round(ab.w * s), Math.round(ab.h * s));
      ctx.fillStyle = (i === doc.activeArtboard) ? '#d0d0d0' : '#8a8a8a';
      ctx.font = '11px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(ab.name, p.x, p.y - 5);
    });

    if (app.prefs.grid) drawGrid(ctx, app, vw, vh);

    /* 레이어 */
    var vm = AI.viewT.matrix(app);
    for (var L = 0; L < doc.layers.length; L++) {
      var ly = doc.layers[L];
      if (!ly.visible) continue;
      drawList(ctx, app, ly.children, vm, 1, undefined);
    }

    if (app.prefs.guides) drawGuides(ctx, app, vw, vh);
    ctx.restore();
  };

  function drawGrid(ctx, app, vw, vh) {
    var step = (app.prefs.gridSize || 72) / (app.prefs.gridDiv || 8) * app.view.scale;
    while (step < 6) step *= 2;
    var o = AI.viewT.toScreen(app, 0, 0);
    ctx.save(); ctx.lineWidth = 1;
    var x = o.x % step, y = o.y % step, i = 0;
    for (; x < vw; x += step, i++) {
      ctx.strokeStyle = 'rgba(120,150,190,.18)';
      ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, 0); ctx.lineTo(Math.round(x) + .5, vh); ctx.stroke();
    }
    for (; y < vh; y += step) {
      ctx.strokeStyle = 'rgba(120,150,190,.18)';
      ctx.beginPath(); ctx.moveTo(0, Math.round(y) + .5); ctx.lineTo(vw, Math.round(y) + .5); ctx.stroke();
    }
    ctx.restore();
  }

  function drawGuides(ctx, app, vw, vh) {
    ctx.save();
    ctx.strokeStyle = '#3ad0e0'; ctx.lineWidth = 1;
    app.doc.guides.forEach(function (g) {
      ctx.beginPath();
      if (g.axis === 'h') { var y = AI.viewT.toScreen(app, 0, g.pos).y; ctx.moveTo(0, Math.round(y) + .5); ctx.lineTo(vw, Math.round(y) + .5); }
      else { var x = AI.viewT.toScreen(app, g.pos, 0).x; ctx.moveTo(Math.round(x) + .5, 0); ctx.lineTo(Math.round(x) + .5, vh); }
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawList(ctx, app, list, pm, alpha, inIso) {
    for (var i = 0; i < list.length; i++) Rn.item(ctx, app, list[i], pm, alpha, inIso);
  }

  /* 효과가 있는 아이템은 오프스크린에 그린 뒤 필터를 걸어 합성한다.
     칠·획을 각각 그리면 그림자가 두 번 생기므로 반드시 한 번에 합성해야 한다. */
  var pads = [null, null, null];
  function pad(i, w, h) {
    var o = pads[i];
    if (!o) {
      if (!U.hasDOM) return null;
      o = pads[i] = { cv: document.createElement('canvas'), ctx: null };
      o.ctx = o.cv.getContext('2d', { willReadFrequently: i === 2 });
    }
    if (o.cv.width < w || o.cv.height < h) {
      o.cv.width = Math.max(o.cv.width, w);
      o.cv.height = Math.max(o.cv.height, h);
    }
    o.ctx.setTransform(1, 0, 0, 1, 0, 0);
    o.ctx.globalCompositeOperation = 'source-over';
    o.ctx.globalAlpha = 1;
    o.ctx.filter = 'none';
    o.ctx.clearRect(0, 0, o.cv.width, o.cv.height);
    return o;
  }
  var scratch = null, sctx = null;
  function getScratch(w, h) {
    var o = pad(0, w, h);
    if (!o) return null;
    scratch = o.cv; sctx = o.ctx;
    return sctx;
  }

  /* ---------------- 불투명도 마스크 ----------------
     마스크 아이템의 밝기(luminance)를 알파로 써서 내용을 가린다.
     SVG <mask> 와 같은 규칙이라 내보내기와 화면이 일치한다. */
  function drawWithMask(ctx, app, it, m, a, inIso) {
    var dpr = app.dpr || 1;
    var sc = (app.view && app.view.scale) || 1;
    var b = Rn.boundsM(it, m, false, sc);
    if (R.isEmpty(b)) return;
    var mb = Rn.boundsM(it.opacityMask, M.mul(m, it.opacityMask.m), false, sc);
    /* 마스크 밖은 검정(=투명)이므로 내용 영역만 있으면 된다 */
    var x0 = Math.floor(b.x - 2), y0 = Math.floor(b.y - 2);
    var w = Math.ceil(R.w(b)) + 4, h = Math.ceil(R.h(b)) + 4;
    if (w <= 0 || h <= 0 || w * dpr > 6000 || h * dpr > 6000) { drawPlain(ctx, app, it, m, a, inIso); return; }

    var content = pad(1, Math.ceil(w * dpr), Math.ceil(h * dpr));
    var maskP = pad(2, Math.ceil(w * dpr), Math.ceil(h * dpr));
    if (!content || !maskP) { drawPlain(ctx, app, it, m, a, inIso); return; }

    content.ctx.setTransform(dpr, 0, 0, dpr, -x0 * dpr, -y0 * dpr);
    drawPlain(content.ctx, app, it, m, 1, inIso);

    /* 마스크를 검정 바탕 위에 그린 뒤 밝기를 알파로 바꾼다 */
    maskP.ctx.setTransform(1, 0, 0, 1, 0, 0);
    maskP.ctx.fillStyle = '#000000';
    maskP.ctx.fillRect(0, 0, Math.ceil(w * dpr), Math.ceil(h * dpr));
    maskP.ctx.setTransform(dpr, 0, 0, dpr, -x0 * dpr, -y0 * dpr);
    drawPlain(maskP.ctx, app, it.opacityMask, M.mul(m, it.opacityMask.m), 1, inIso);
    maskP.ctx.setTransform(1, 0, 0, 1, 0, 0);
    var iw = Math.ceil(w * dpr), ih = Math.ceil(h * dpr);
    try {
      var img = maskP.ctx.getImageData(0, 0, iw, ih);
      var d = img.data, inv = !!it.maskInvert;
      for (var i = 0; i < d.length; i += 4) {
        var lum = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
        d[i + 3] = inv ? 255 - lum : lum;
      }
      maskP.ctx.putImageData(img, 0, 0);
    } catch (e) { drawPlain(ctx, app, it, m, a, inIso); return; }

    content.ctx.setTransform(1, 0, 0, 1, 0, 0);
    content.ctx.globalCompositeOperation = 'destination-in';
    content.ctx.drawImage(maskP.cv, 0, 0, iw, ih, 0, 0, iw, ih);
    content.ctx.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.globalAlpha = a;
    if (it.blend && it.blend !== 'normal') ctx.globalCompositeOperation = it.blend;
    if (AI.effects.has(it)) ctx.filter = AI.effects.filterString(it, sc) || 'none';
    ctx.drawImage(content.cv, 0, 0, iw, ih, x0, y0, w, h);
    ctx.restore();
  }

  function drawWithEffects(ctx, app, it, m, a, inIso) {
    var sc = (app.view && app.view.scale) || 1;
    var dpr = app.dpr || 1;
    var b = Rn.boundsM(it, m, true, sc);
    if (R.isEmpty(b)) return;
    var strokePad = 0;
    (function scan(o) {
      if (o.type === 'group') { o.children.forEach(scan); return; }
      strokePad = Math.max(strokePad, AI.appearance.maxStrokeWidth(o));
    })(it);
    var pad = (AI.effects.padding(it) + strokePad) * sc + 6;
    var x0 = Math.floor(b.x - pad), y0 = Math.floor(b.y - pad);
    var w = Math.ceil(R.w(b) + pad * 2) + 2, h = Math.ceil(R.h(b) + pad * 2) + 2;
    var s2 = (w > 0 && h > 0 && w * dpr <= 6000 && h * dpr <= 6000)
      ? getScratch(Math.ceil(w * dpr), Math.ceil(h * dpr)) : null;
    if (!s2) { drawPlain(ctx, app, it, m, a, inIso); return; }

    s2.setTransform(dpr, 0, 0, dpr, -x0 * dpr, -y0 * dpr);
    drawPlain(s2, app, it, m, a, inIso);

    ctx.save();
    if (it.blend && it.blend !== 'normal') ctx.globalCompositeOperation = it.blend;
    ctx.filter = AI.effects.filterString(it, sc) || 'none';
    ctx.drawImage(scratch, 0, 0, Math.ceil(w * dpr), Math.ceil(h * dpr), x0, y0, w, h);
    ctx.restore();
  }

  Rn.item = function (ctx, app, it, pm, alpha, inIso) {
    if (!it.visible || it.__editing) return;
    var iso = app.isolation && app.isolation.length;
    if (iso && inIso === undefined) inIso = false;
    if (iso && !inIso && app.isolation.indexOf(it) >= 0) inIso = true;
    var m = M.mul(pm, it.m);
    var a = alpha * (it.opacity == null ? 1 : it.opacity);
    if (iso && !inIso && it.type !== 'group') a *= 0.28;
    if (a <= 0.001) return;

    if (it.opacityMask && !app.prefs.outline && Rn.hasCanvas()) {
      drawWithMask(ctx, app, it, m, a, inIso);
      return;
    }
    if (AI.effects.has(it) && !app.prefs.outline && Rn.hasCanvas()) {
      drawWithEffects(ctx, app, it, m, a, inIso);
      return;
    }
    drawPlain(ctx, app, it, m, a, inIso);
  };

  function drawPlain(ctx, app, it, m, a, inIso) {
    if (it.type === 'group') {
      ctx.save();
      if (it.blend && it.blend !== 'normal') ctx.globalCompositeOperation = it.blend;
      if (it.clip && it.children.length) {
        var cp = it.children[it.children.length - 1];
        ctx.beginPath();
        traceFx(ctx, cp, M.mul(m, cp.m));
        ctx.clip();
        for (var i = 0; i < it.children.length - 1; i++) Rn.item(ctx, app, it.children[i], m, a, inIso);
      } else {
        drawList(ctx, app, it.children, m, a, inIso);
      }
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.globalAlpha = a;
    if (it.blend && it.blend !== 'normal') ctx.globalCompositeOperation = it.blend;

    if (app.prefs.outline) {
      ctx.beginPath();
      if (it.type === 'path') traceFx(ctx, it, m);
      else {
        var bb = Rn.localBounds(it);
        var q = [[bb.x, bb.y], [bb.x2, bb.y], [bb.x2, bb.y2], [bb.x, bb.y2]].map(function (p) { return M.apply(m, p[0], p[1]); });
        ctx.moveTo(q[0].x, q[0].y);
        for (var k = 1; k < 4; k++) ctx.lineTo(q[k].x, q[k].y);
        ctx.closePath();
      }
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore(); return;
    }

    if (it.type === 'path') drawPath(ctx, app, it, m);
    else if (it.type === 'text') drawText(ctx, app, it, m);
    else if (it.type === 'image') drawImage(ctx, app, it, m);
    else if (it.type === 'symbol') drawSymbol(ctx, app, it, m, a, inIso);
    ctx.restore();
  }

  /* 기하 효과까지 반영해 경로를 그린다 (클립·윤곽선 보기용) */
  function traceFx(ctx, it, m) {
    var px = AI.distort.proxies(it);
    if (!px) { G.tracePath(ctx, it, m); return; }
    for (var i = 0; i < px.length; i++) G.tracePath(ctx, px[i], M.mul(m, px[i].fxm));
  }
  Rn.traceFx = traceFx;

  function viewBoundsOf(it, m) {
    if (it.type === 'path') return Rn.pathBoundsFx(it, m);
    return Rn.xformBounds(Rn.localBounds(it), m);
  }

  function drawPath(ctx, app, it, m) {
    /* 왜곡 및 변형 — 변형된 기하마다 원본과 똑같은 겹으로 다시 그린다 */
    var px = AI.distort.proxies(it);
    if (px) {
      for (var k = 0; k < px.length; k++) drawPath(ctx, app, px[k], M.mul(m, px[k].fxm));
      return;
    }
    var vb = viewBoundsOf(it, m);
    var stack = AI.appearance.list(it);
    for (var i = 0; i < stack.length; i++) {
      var e = stack[i];
      if (e.kind === 'fill') fillLayer(ctx, app, it, m, e.paint, vb);
      else strokeLayer(ctx, app, it, m, e.stroke, vb);
    }
  }

  function fillLayer(ctx, app, it, m, paint, vb) {
    if (!Col.isPaint(paint)) return;
    ctx.beginPath();
    G.tracePath(ctx, it, m);
    ctx.fillStyle = paintStyle(ctx, paint, vb, m);
    ctx.fill('nonzero');
  }

  function strokeLayer(ctx, app, it, m, s, vb) {
    if (!s || s.type === 'none' || !(s.width > 0)) return;

    var allClosed = it.subs.length > 0 && it.subs.every(function (sub) { return sub.closed; });
    var align = (s.align === 'inside' || s.align === 'outside') && allClosed ? s.align : 'center';
    var w = Math.max(s.width * app.view.scale, 0.08);

    function setup(lw, doubled) {
      ctx.strokeStyle = paintStyle(ctx, s, vb, m);
      ctx.lineWidth = lw;
      /* 두께를 2배로 그려 클리핑하는 방식에서는 둥근 끝이 2배가 되어
         점선 바깥 가장자리가 톱니처럼 보인다. 이 경우에만 butt 로 대체. */
      ctx.lineCap = (doubled && s.dash && s.dash.length) ? 'butt' : (s.cap || 'butt');
      ctx.lineJoin = s.join || 'miter';
      ctx.miterLimit = s.miter || 10;
      if (s.dash && s.dash.length) ctx.setLineDash(s.dash.map(function (d) { return d * app.view.scale; }));
      else ctx.setLineDash([]);
      ctx.lineDashOffset = (s.dashOffset || 0) * app.view.scale;
    }

    /* 서예 브러시 — 진행 방향과 펜촉 각도의 관계로 두께가 변한다 */
    if (s.brush && s.brush.type === 'calligraphic' && align === 'center') {
      drawCalligraphic(ctx, app, it, m, s, vb);
      drawArrows(ctx, app, it, m, s);
      return;
    }
    /* 가변 폭 프로파일이 있으면 구간마다 두께를 바꿔 그린다 */
    if (s.widthProfile && s.widthProfile.length > 1 && align === 'center') {
      drawVariableStroke(ctx, app, it, m, s, vb);
      drawArrows(ctx, app, it, m, s);
      return;
    }

    if (align === 'center') {
      setup(w);
      ctx.beginPath();
      G.tracePath(ctx, it, m);
      ctx.stroke();
      ctx.setLineDash([]);
      drawArrows(ctx, app, it, m, s);
      return;
    }

    /* 안쪽/바깥쪽 정렬: 두 배 두께로 그린 뒤 반대쪽을 클리핑으로 잘라낸다 */
    ctx.save();
    ctx.beginPath();
    if (align === 'outside') {
      /* 도형 바깥만 남기는 역클리핑 (evenodd + 큰 사각형) */
      var big = 1e6;
      ctx.moveTo(-big, -big); ctx.lineTo(big, -big); ctx.lineTo(big, big); ctx.lineTo(-big, big); ctx.closePath();
      G.tracePath(ctx, it, m);
      ctx.clip('evenodd');
    } else {
      G.tracePath(ctx, it, m);
      ctx.clip('nonzero');
    }
    setup(w * 2, true);
    ctx.beginPath();
    G.tracePath(ctx, it, m);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    drawArrows(ctx, app, it, m, s);
  }

  /* ---------------- 가변 폭 (폭 도구) ---------------- */
  /* widthProfile = [{t:0..1, w:배율}, …] — 패스를 따라 두께를 보간해 그린다.
     구간을 잘게 나눠 각 조각을 그 지점의 두께로 그리는 방식이라
     캔버스의 단일 lineWidth 제약을 우회한다. */
  Rn.profileAt = function (prof, t) {
    if (!prof || !prof.length) return 1;
    if (t <= prof[0].t) return prof[0].w;
    for (var i = 1; i < prof.length; i++) {
      if (t <= prof[i].t) {
        var a = prof[i - 1], b = prof[i];
        var k = (b.t - a.t) < 1e-9 ? 0 : (t - a.t) / (b.t - a.t);
        return a.w + (b.w - a.w) * k;
      }
    }
    return prof[prof.length - 1].w;
  };

  /* 서예 브러시: 펜촉을 각도 θ, 납작함 r 인 타원으로 보고
     진행 방향과 펜촉이 이루는 각으로 두께를 정한다. */
  function drawCalligraphic(ctx, app, it, m, s, vb) {
    var sc = app.view.scale;
    var th = U.rad(s.brush.angle || 0);
    var round = U.clamp((s.brush.roundness == null ? 20 : s.brush.roundness) / 100, 0.02, 1);
    ctx.save();
    ctx.strokeStyle = paintStyle(ctx, s, vb, m);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);
    it.subs.forEach(function (sub) {
      var pts = G.flattenSub(sub, 0.3 / Math.max(sc, 0.05));
      if (pts.length < 2) return;
      if (sub.closed) pts = pts.concat([pts[0]]);
      for (var i = 1; i < pts.length; i++) {
        var a = M.apply(m, pts[i - 1].x, pts[i - 1].y);
        var b = M.apply(m, pts[i].x, pts[i].y);
        var dir = Math.atan2(b.y - a.y, b.x - a.x);
        /* 펜촉에 수직으로 그을 때 가장 굵고, 나란할 때 가장 가늘다 */
        var k = Math.abs(Math.sin(dir - th));
        var w = s.width * sc * (round + (1 - round) * k);
        ctx.lineWidth = Math.max(w, 0.08);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    });
    ctx.restore();
  }

  function drawVariableStroke(ctx, app, it, m, s, vb) {
    var sc = app.view.scale;
    ctx.save();
    ctx.strokeStyle = paintStyle(ctx, s, vb, m);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);
    it.subs.forEach(function (sub) {
      var pts = G.flattenSub(sub, 0.25 / Math.max(sc, 0.05));
      if (pts.length < 2) return;
      /* 누적 길이로 t 를 매긴다 */
      var len = [0], total = 0, i;
      for (i = 1; i < pts.length; i++) {
        total += U.dist(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
        len.push(total);
      }
      if (total < 1e-6) return;
      for (i = 1; i < pts.length; i++) {
        var t = (len[i - 1] + len[i]) / 2 / total;
        var a = M.apply(m, pts[i - 1].x, pts[i - 1].y);
        var b = M.apply(m, pts[i].x, pts[i].y);
        ctx.lineWidth = Math.max(s.width * Rn.profileAt(s.widthProfile, t) * sc, 0.08);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    });
    ctx.restore();
  }

  /* 심볼 인스턴스 — 정의 아트웍을 인스턴스 변환 위에 그린다 */
  Rn.symbolDef = function (it) {
    var doc = Rn.__doc;
    if (!doc || !doc.symbols) return null;
    for (var i = 0; i < doc.symbols.length; i++) if (doc.symbols[i].id === it.symbolId) return doc.symbols[i];
    return null;
  };
  function drawSymbol(ctx, app, it, m, a, inIso) {
    var def = AI.assets.findSymbol(app.doc, it.symbolId);
    if (!def) return;
    Rn.item(ctx, app, def.item, m, 1, inIso);
  }

  function drawImage(ctx, app, it, m) {
    var im = Rn.getImage(it.src, function () { app.invalidate && app.invalidate(); });
    ctx.save();
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    if (im.complete && im.naturalWidth && !im.__failed) {
      ctx.imageSmoothingQuality = 'high';
      try {
        var c = it.crop;
        if (c) {
          ctx.drawImage(im,
            c.x * im.naturalWidth, c.y * im.naturalHeight,
            c.w * im.naturalWidth, c.h * im.naturalHeight,
            0, 0, it.w, it.h);
        } else {
          ctx.drawImage(im, 0, 0, it.w, it.h);
        }
      } catch (e) { }
    } else {
      ctx.fillStyle = 'rgba(150,150,150,.25)';
      ctx.fillRect(0, 0, it.w, it.h);
      ctx.strokeStyle = 'rgba(120,120,120,.7)';
      ctx.lineWidth = 1 / Math.max(Math.hypot(m[0], m[1]), 1e-6);
      ctx.strokeRect(0, 0, it.w, it.h);
    }
    ctx.restore();
  }

  /* ---------------- 화살표 (획 패널) ---------------- */
  var ARROWS = {
    none: null,
    /* 각 도형은 획 두께 1 기준 단위 좌표. 끝점이 원점, +x 가 진행 방향 */
    arrow: function (ctx) {
      ctx.moveTo(0, 0); ctx.lineTo(-3.2, 1.7); ctx.lineTo(-2.3, 0); ctx.lineTo(-3.2, -1.7); ctx.closePath();
    },
    triangle: function (ctx) {
      ctx.moveTo(0, 0); ctx.lineTo(-2.8, 1.5); ctx.lineTo(-2.8, -1.5); ctx.closePath();
    },
    circle: function (ctx) { ctx.arc(-1.3, 0, 1.3, 0, 6.2832); },
    square: function (ctx) { ctx.rect(-2.6, -1.3, 2.6, 2.6); },
    bar: function (ctx) { ctx.rect(-0.35, -1.5, 0.7, 3); }
  };
  Rn.ARROW_TYPES = Object.keys(ARROWS);

  /* 열린 서브패스의 양 끝에서 접선 방향을 구한다 */
  function endpoints(it) {
    var out = [];
    it.subs.forEach(function (sub) {
      if (sub.closed || sub.pts.length < 2) return;
      var segs = G.segments(sub);
      if (!segs.length) return;
      var f = segs[0];
      var fdx = (f.c1.x !== f.a.x || f.c1.y !== f.a.y) ? f.c1.x - f.a.x : f.b.x - f.a.x;
      var fdy = (f.c1.x !== f.a.x || f.c1.y !== f.a.y) ? f.c1.y - f.a.y : f.b.y - f.a.y;
      var l = segs[segs.length - 1];
      var ldx = (l.c2.x !== l.b.x || l.c2.y !== l.b.y) ? l.b.x - l.c2.x : l.b.x - l.a.x;
      var ldy = (l.c2.x !== l.b.x || l.c2.y !== l.b.y) ? l.b.y - l.c2.y : l.b.y - l.a.y;
      out.push({ start: { p: f.a, dx: -fdx, dy: -fdy }, end: { p: l.b, dx: ldx, dy: ldy } });
    });
    return out;
  }

  function drawArrows(ctx, app, it, m, stroke) {
    var s = stroke || it.stroke;
    if (!s || s.type === 'none' || !(s.width > 0)) return;
    if ((s.arrowStart || 'none') === 'none' && (s.arrowEnd || 'none') === 'none') return;
    var sc = app.view.scale;
    var size = s.width * sc * ((s.arrowScale == null ? 100 : s.arrowScale) / 100);
    if (size <= 0.2) return;
    var color = s.type === 'solid' ? Col.toCss(s.color, s.alpha) : '#000000';
    endpoints(it).forEach(function (e) {
      [['arrowStart', e.start], ['arrowEnd', e.end]].forEach(function (o) {
        var kind = s[o[0]] || 'none';
        var fn = ARROWS[kind];
        if (!fn) return;
        var sp = M.apply(m, o[1].p.x, o[1].p.y);
        var d = M.applyV(m, o[1].dx, o[1].dy);
        var a = Math.atan2(d.y, d.x);
        ctx.save();
        ctx.translate(sp.x, sp.y);
        ctx.rotate(a);
        ctx.scale(size, size);
        ctx.beginPath();
        fn(ctx);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.restore();
      });
    });
  }

  function drawText(ctx, app, it, m) {
    var t = it.text, mt = Rn.measureText(it);
    if (t.path) { drawTextOnPath(ctx, app, it, m, mt); return; }
    ctx.save();
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.font = Rn.fontCss(t);
    ctx.textBaseline = 'alphabetic';
    /* 영역 문자는 줄마다 x 오프셋을 직접 계산하므로 정렬은 left 로 고정한다 */
    ctx.textAlign = t.area ? 'left' : (t.align === 'center' ? 'center' : t.align === 'right' ? 'right' : 'left');
    var vb = t.area
      ? { x: 0, y: 0, x2: t.area.w, y2: t.area.h }
      : { x: (t.align === 'center' ? -mt.w / 2 : t.align === 'right' ? -mt.w : 0), y: -mt.asc };
    if (!t.area) { vb.x2 = vb.x + mt.w; vb.y2 = vb.y + mt.h; }
    /* 문자도 모양 스택을 그대로 따른다 (아래 겹부터) */
    AI.appearance.list(it).forEach(function (e) {
      var fs = null, ss = null, lw = 1;
      if (e.kind === 'fill') {
        if (!Col.isPaint(e.paint)) return;
        fs = paintStyle(ctx, e.paint, vb);
      } else {
        var st = e.stroke;
        if (!st || st.type === 'none' || !(st.width > 0)) return;
        ss = paintStyle(ctx, st, vb);
        lw = st.width;
      }
      for (var i = 0; i < mt.lines.length; i++) {
        var y = t.area ? (mt.asc + i * mt.lineH) : (i * mt.lineH);
        var x = (mt.xs && mt.xs[i]) || 0;
        var line = mt.lines[i];
        if (t.tracking) {
          drawTracked(ctx, line, x, y, t, fs, ss, lw);
        } else {
          if (fs) { ctx.fillStyle = fs; ctx.fillText(line, x, y); }
          if (ss) { ctx.strokeStyle = ss; ctx.lineWidth = lw; ctx.strokeText(line, x, y); }
        }
      }
    });
    ctx.restore();
  }

  /* 패스 상 문자 — 글자마다 접선 각도로 세워 그린다 */
  function drawTextOnPath(ctx, app, it, m, mt) {
    var t = it.text;
    var glyphs = mt.glyphs || [];
    var vb = mt.box || { x: 0, y: 0, x2: 1, y2: 1 };
    ctx.save();
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.font = Rn.fontCss(t);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    AI.appearance.list(it).forEach(function (e) {
      var fs = null, ss = null, lw = 1;
      if (e.kind === 'fill') {
        if (!Col.isPaint(e.paint)) return;
        fs = paintStyle(ctx, e.paint, vb);
      } else {
        var st = e.stroke;
        if (!st || st.type === 'none' || !(st.width > 0)) return;
        ss = paintStyle(ctx, st, vb);
        lw = st.width;
      }
      for (var i = 0; i < glyphs.length; i++) {
        var g = glyphs[i];
        ctx.save();
        ctx.translate(g.x, g.y);
        ctx.rotate(g.ang);
        if (fs) { ctx.fillStyle = fs; ctx.fillText(g.ch, 0, 0); }
        if (ss) { ctx.strokeStyle = ss; ctx.lineWidth = lw; ctx.strokeText(g.ch, 0, 0); }
        ctx.restore();
      }
    });
    ctx.restore();
  }

  function drawTracked(ctx, line, x, y, t, fs, ss, lw) {
    var w = ctx.measureText(line).width + Math.max(0, line.length - 1) * t.tracking;
    var cx = t.area ? x : (t.align === 'center' ? -w / 2 : t.align === 'right' ? -w : 0);
    var prev = ctx.textAlign; ctx.textAlign = 'left';
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (fs) { ctx.fillStyle = fs; ctx.fillText(ch, cx, y); }
      if (ss) { ctx.strokeStyle = ss; ctx.lineWidth = lw; ctx.strokeText(ch, cx, y); }
      cx += ctx.measureText(ch).width + t.tracking;
    }
    ctx.textAlign = prev;
  }

  /* =========================================================================
     선택 UI
     ========================================================================= */
  var UIC = { blue: '#2d8ceb', box: '#2d8ceb', handleFill: '#ffffff', anchor: '#2d8ceb' };

  /* 선택된 아이템 -> 소속 레이어 색상 (한 번의 순회로 수집) */
  Rn.layerColors = function (app) {
    var map = new Map();
    if (!app.sel.length) return map;
    Model.walkWorld(app.doc, function (it, info) {
      if (app.sel.indexOf(it) >= 0) map.set(it, (info.layer && info.layer.color) || UIC.blue);
    });
    return map;
  };

  Rn.ui = function (ctx, app) {
    ctx.save();
    ctx.setTransform(app.dpr, 0, 0, app.dpr, 0, 0);
    var tool = AI.tools.current(app);
    var lc = Rn.layerColors(app);
    var mainColor = (app.sel.length && lc.get(app.sel[0])) || UIC.blue;

    /* 선택된 오브젝트 패스 하이라이트 */
    var vm = AI.viewT.matrix(app);
    var directMode = tool && tool.direct;

    if (!app.hideEdges && app.hoverItem && app.sel.indexOf(app.hoverItem) < 0) {
      var hm = M.mul(vm, Model.worldMatrix(app.doc, app.hoverItem));
      ctx.save();
      ctx.beginPath();
      if (app.hoverItem.type === 'path') G.tracePath(ctx, app.hoverItem, hm);
      else if (app.hoverItem.type === 'group') outlineBox(ctx, Rn.localBounds(app.hoverItem), hm);
      else outlineBox(ctx, Rn.localBounds(app.hoverItem), hm);
      ctx.strokeStyle = 'rgba(45,140,235,.9)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.restore();
    }

    if (!app.hideEdges) {
      app.sel.forEach(function (it) {
        var wm = M.mul(vm, Model.worldMatrix(app.doc, it));
        ctx.beginPath();
        if (it.type === 'path') G.tracePath(ctx, it, wm);
        else outlineBox(ctx, Rn.localBounds(it), wm);
        ctx.strokeStyle = lc.get(it) || UIC.blue; ctx.lineWidth = 1; ctx.setLineDash([]); ctx.stroke();
      });

      /* 패스 상의 문자: 기준선 패스와 시작·끝 브래킷 */
      app.sel.forEach(function (it) {
        if (it.type !== 'text' || !it.text.path) return;
        var wm3 = M.mul(vm, Model.worldMatrix(app.doc, it));
        var L3 = Rn.layoutText(it);
        ctx.save();
        ctx.beginPath();
        G.tracePath(ctx, { subs: it.text.path.subs }, wm3);
        ctx.strokeStyle = 'rgba(45,140,235,.55)';
        ctx.setLineDash([4, 3]); ctx.lineWidth = 1; ctx.stroke();
        ctx.setLineDash([]);
        /* 시작 · 끝 브래킷 — 일러스트레이터에서 끌어 글의 시작 위치를 바꾸는 손잡이 */
        var walk = Rn.pathWalker(it);
        if (walk && walk.length) {
          var s0 = it.text.path.start || 0;
          if (it.text.align === 'center') s0 += (L3.pathLen - L3.textLen) / 2;
          else if (it.text.align === 'right') s0 += L3.pathLen - L3.textLen;
          [s0, s0 + L3.textLen].forEach(function (sv) {
            var q = walk.at(Math.max(0, Math.min(walk.length, sv)));
            if (!q) return;
            var a0 = M.apply(wm3, q.x, q.y);
            var nx = -Math.sin(q.ang), ny = Math.cos(q.ang);
            var b0 = M.apply(wm3, q.x - nx * it.text.size * 0.8, q.y - ny * it.text.size * 0.8);
            ctx.beginPath();
            ctx.moveTo(a0.x, a0.y); ctx.lineTo(b0.x, b0.y);
            ctx.strokeStyle = UIC.blue; ctx.lineWidth = 1.6; ctx.stroke();
          });
        }
        if (L3.overflow) {
          var e0 = walk && walk.at(walk.length);
          if (e0) {
            var c0 = M.apply(wm3, e0.x, e0.y);
            ctx.fillStyle = '#e2483c';
            ctx.fillRect(c0.x - 5, c0.y - 5, 11, 11);
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(c0.x - 2.5, c0.y); ctx.lineTo(c0.x + 2.5, c0.y);
            ctx.moveTo(c0.x, c0.y - 2.5); ctx.lineTo(c0.x, c0.y + 2.5);
            ctx.stroke();
          }
        }
        ctx.restore();
      });

      /* 영역 문자: 상자 테두리와 넘침 표시 (일러스트레이터의 빨간 ⊞) */
      app.sel.forEach(function (it) {
        if (it.type !== 'text' || !it.text.area) return;
        var wm2 = M.mul(vm, Model.worldMatrix(app.doc, it));
        var L = Rn.layoutText(it);
        ctx.save();
        if (it.text.areaShape) {
          ctx.beginPath();
          it.text.areaShape.forEach(function (sub) {
            G.tracePath(ctx, { subs: [sub] }, wm2);
          });
          ctx.strokeStyle = 'rgba(45,140,235,.45)';
          ctx.setLineDash([4, 3]); ctx.lineWidth = 1; ctx.stroke();
          ctx.setLineDash([]);
        }
        if (L.overflow) {
          var c = M.apply(wm2, it.text.area.w, it.text.area.h);
          ctx.fillStyle = '#e2483c';
          ctx.fillRect(c.x - 5, c.y - 5, 11, 11);
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(c.x - 2.5, c.y); ctx.lineTo(c.x + 2.5, c.y);
          ctx.moveTo(c.x, c.y - 2.5); ctx.lineTo(c.x, c.y + 2.5);
          ctx.stroke();
        }
        ctx.restore();
      });

      /* 바운딩 박스 */
      if (!directMode && app.sel.length && app.prefs.bbox !== false) drawBBox(ctx, app, mainColor);
      if (app.prefs.cornerWidgets !== false) drawCornerWidgets(ctx, app, mainColor);

      /* 직접 선택: 앵커/핸들 */
      if (directMode) drawAnchors(ctx, app, vm, lc);
    }

    if (tool && tool.drawUI) tool.drawUI(ctx, app);

    /* 마퀴 */
    if (app.marquee) {
      var r = app.marquee;
      ctx.save();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.strokeRect(Math.round(r.x) + .5, Math.round(r.y) + .5, Math.round(r.x2 - r.x), Math.round(r.y2 - r.y));
      ctx.strokeStyle = '#000'; ctx.setLineDash([3, 3]);
      ctx.strokeRect(Math.round(r.x) + .5, Math.round(r.y) + .5, Math.round(r.x2 - r.x), Math.round(r.y2 - r.y));
      ctx.restore();
    }

    /* 스마트 가이드 — 정렬선 + 라벨 (Illustrator 방식) */
    if (app.smart && app.smart.length) drawSmartGuides(ctx, app);

    ctx.restore();
  };

  var SG = '#ff2fd0';
  function drawSmartGuides(ctx, app) {
    var vw = ctx.canvas.width / app.dpr, vh = ctx.canvas.height / app.dpr;
    ctx.save();
    ctx.font = '10px sans-serif';
    ctx.textBaseline = 'middle';
    app.smart.forEach(function (g) {
      var a, b, lx, ly;
      if (g.axis === 'v') {
        var x = AI.viewT.toScreen(app, g.pos, 0).x;
        /* 대상과 이동 중인 오브젝트를 잇는 구간을 강조 */
        var ys = [];
        if (g.src) { ys.push(AI.viewT.toScreen(app, 0, g.src.y).y, AI.viewT.toScreen(app, 0, g.src.y2).y); }
        if (g.moving) { ys.push(AI.viewT.toScreen(app, 0, g.moving.y).y, AI.viewT.toScreen(app, 0, g.moving.y2).y); }
        var y0 = ys.length ? Math.min.apply(null, ys) - 10 : 0;
        var y1 = ys.length ? Math.max.apply(null, ys) + 10 : vh;
        ctx.strokeStyle = SG; ctx.lineWidth = 1; ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, 0); ctx.lineTo(Math.round(x) + .5, vh); ctx.stroke();
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, y0); ctx.lineTo(Math.round(x) + .5, y1); ctx.stroke();
        lx = x + 6; ly = (y0 + y1) / 2;
      } else {
        var y = AI.viewT.toScreen(app, 0, g.pos).y;
        var xs = [];
        if (g.src) { xs.push(AI.viewT.toScreen(app, g.src.x, 0).x, AI.viewT.toScreen(app, g.src.x2, 0).x); }
        if (g.moving) { xs.push(AI.viewT.toScreen(app, g.moving.x, 0).x, AI.viewT.toScreen(app, g.moving.x2, 0).x); }
        var x0 = xs.length ? Math.min.apply(null, xs) - 10 : 0;
        var x1 = xs.length ? Math.max.apply(null, xs) + 10 : vw;
        ctx.strokeStyle = SG; ctx.lineWidth = 1; ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(0, Math.round(y) + .5); ctx.lineTo(vw, Math.round(y) + .5); ctx.stroke();
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x0, Math.round(y) + .5); ctx.lineTo(x1, Math.round(y) + .5); ctx.stroke();
        lx = (x0 + x1) / 2; ly = y - 10;
      }
      if (g.label) {
        var w = ctx.measureText(g.label).width + 8;
        ctx.fillStyle = SG;
        ctx.fillRect(lx, ly - 8, w, 15);
        ctx.fillStyle = '#fff';
        ctx.fillText(g.label, lx + 4, ly);
      }
    });
    ctx.restore();
  }

  function outlineBox(ctx, b, m) {
    if (R.isEmpty(b)) return;
    var q = [[b.x, b.y], [b.x2, b.y], [b.x2, b.y2], [b.x, b.y2]].map(function (p) { return M.apply(m, p[0], p[1]); });
    ctx.moveTo(q[0].x, q[0].y);
    for (var i = 1; i < 4; i++) ctx.lineTo(q[i].x, q[i].y);
    ctx.closePath();
  }

  /* 선택 바운딩 박스(회전 지원) 의 8개 핸들 좌표(화면) */
  Rn.bboxFrame = function (app) {
    if (!app.sel.length) return null;
    var vm = AI.viewT.matrix(app);
    if (app.sel.length === 1) {
      var it = app.sel[0];
      var wm = M.mul(vm, Model.worldMatrix(app.doc, it));
      var b = Rn.localBounds(it);
      if (R.isEmpty(b)) return null;
      /* 회전만 유지, 반전 보정 */
      return {
        rotated: true,
        pts: [
          M.apply(wm, b.x, b.y), M.apply(wm, (b.x + b.x2) / 2, b.y), M.apply(wm, b.x2, b.y),
          M.apply(wm, b.x2, (b.y + b.y2) / 2), M.apply(wm, b.x2, b.y2),
          M.apply(wm, (b.x + b.x2) / 2, b.y2), M.apply(wm, b.x, b.y2), M.apply(wm, b.x, (b.y + b.y2) / 2)
        ],
        local: b, m: wm
      };
    }
    var wb = Rn.selectionBounds(app, true);
    if (R.isEmpty(wb)) return null;
    var p1 = AI.viewT.toScreen(app, wb.x, wb.y), p2 = AI.viewT.toScreen(app, wb.x2, wb.y2);
    var b2 = R.fromPts(p1.x, p1.y, p2.x, p2.y);
    return {
      rotated: false,
      pts: [
        { x: b2.x, y: b2.y }, { x: (b2.x + b2.x2) / 2, y: b2.y }, { x: b2.x2, y: b2.y },
        { x: b2.x2, y: (b2.y + b2.y2) / 2 }, { x: b2.x2, y: b2.y2 },
        { x: (b2.x + b2.x2) / 2, y: b2.y2 }, { x: b2.x, y: b2.y2 }, { x: b2.x, y: (b2.y + b2.y2) / 2 }
      ],
      world: wb
    };
  };

  /* 라이브 사각형의 모퉁이 반경 위젯 (Illustrator CC 의 코너 위젯) */
  Rn.cornerWidgets = function (app) {
    if (app.sel.length !== 1) return null;
    var it = app.sel[0];
    if (it.type !== 'path' || !it.shape || it.shape.kind !== 'rect') return null;
    var sh = it.shape;
    var w = sh.w, h = sh.h;
    if (Math.abs(w) < 1e-3 || Math.abs(h) < 1e-3) return null;
    var wm = M.mul(AI.viewT.matrix(app), Model.worldMatrix(app.doc, it));
    var sc = Math.hypot(wm[0], wm[1]) || 1;
    var lim = Math.min(Math.abs(w), Math.abs(h)) / 2;
    var d = U.clamp(sh.r || 0, 12 / sc, lim);
    if (lim * sc < 22) return null;               /* 너무 작으면 표시하지 않음 */
    var corners = [[0, 0, 1, 1], [w, 0, -1, 1], [w, h, -1, -1], [0, h, 1, -1]];
    return {
      item: it,
      pts: corners.map(function (c, i) {
        var p = M.apply(wm, c[0] + c[2] * d, c[1] + c[3] * d);
        return { x: p.x, y: p.y, i: i, cx: c[0], cy: c[1], sx: c[2], sy: c[3] };
      })
    };
  };

  function drawCornerWidgets(ctx, app, color) {
    var cw = Rn.cornerWidgets(app);
    if (!cw) return;
    color = color || UIC.box;
    ctx.save();
    cw.pts.forEach(function (p) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, 6.2832);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.fill(); ctx.stroke();
      /* 안쪽 원호 표식 */
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.2, 0, 6.2832);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawBBox(ctx, app, color) {
    var f = Rn.bboxFrame(app);
    if (!f) return;
    color = color || UIC.box;
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(f.pts[0].x, f.pts[0].y);
    [2, 4, 6].forEach(function (i) { ctx.lineTo(f.pts[i].x, f.pts[i].y); });
    ctx.closePath(); ctx.stroke();
    for (var i = 0; i < 8; i++) {
      var p = f.pts[i];
      ctx.fillStyle = UIC.handleFill; ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.rect(Math.round(p.x) - 3.5, Math.round(p.y) - 3.5, 7, 7);
      ctx.fill(); ctx.stroke();
    }
    /* 중심점 */
    if (app.prefs.centerPoint) {
      var c = { x: (f.pts[0].x + f.pts[4].x) / 2, y: (f.pts[0].y + f.pts[4].y) / 2 };
      ctx.strokeStyle = color;
      ctx.beginPath(); ctx.moveTo(c.x - 4, c.y); ctx.lineTo(c.x + 4, c.y);
      ctx.moveTo(c.x, c.y - 4); ctx.lineTo(c.x, c.y + 4); ctx.stroke();
    }
    ctx.restore();
  }

  function drawAnchors(ctx, app, vm, lc) {
    ctx.save();
    app.sel.forEach(function (it) {
      if (it.type !== 'path') return;
      var col = (lc && lc.get(it)) || UIC.blue;
      var wm = M.mul(vm, Model.worldMatrix(app.doc, it));
      it.subs.forEach(function (sub, si) {
        sub.pts.forEach(function (p, pi) {
          var selP = AI.sel.isPtSelected(app, it, si, pi);
          var sp = M.apply(wm, p.x, p.y);
          /* 핸들 (선택된 앵커 또는 인접 앵커가 선택된 경우) */
          if (selP || AI.sel.neighborSelected(app, it, si, pi)) {
            [['i', p.ix, p.iy], ['o', p.ox, p.oy]].forEach(function (h) {
              if (h[1] == null) return;
              var hp = M.apply(wm, h[1], h[2]);
              ctx.strokeStyle = col; ctx.lineWidth = 1;
              ctx.beginPath(); ctx.moveTo(sp.x, sp.y); ctx.lineTo(hp.x, hp.y); ctx.stroke();
              ctx.beginPath(); ctx.arc(hp.x, hp.y, 3, 0, 6.2832);
              ctx.fillStyle = col; ctx.fill();
            });
          }
          ctx.beginPath();
          ctx.rect(Math.round(sp.x) - 3.5, Math.round(sp.y) - 3.5, 7, 7);
          ctx.fillStyle = selP ? col : '#ffffff';
          ctx.strokeStyle = col; ctx.lineWidth = 1;
          ctx.fill(); ctx.stroke();
        });
      });
    });
    ctx.restore();
  }

  /* 터치 정밀 조작용 루페 — Shift (Vogel & Baudisch, CHI 2007) 의 콜아웃 방식.
     손가락에 가려진 영역을 가려지지 않는 위치에 확대해 복제하고
     실제 선택 지점을 십자선으로 표시한다. 프레임 맨 끝에 그린다. */
  Rn.loupe = function (ctx, app) {
    var L = app.loupe;
    if (!L) return;
    var dpr = app.dpr, RAD = 46, ZOOM = 2, OFF = 88;
    var vw = ctx.canvas.width / dpr, vh = ctx.canvas.height / dpr;
    var lx = L.x, ly = L.y - OFF;
    if (ly - RAD < 4) ly = L.y + OFF;                 /* 위가 좁으면 아래로 */
    lx = U.clamp(lx, RAD + 4, vw - RAD - 4);
    ly = U.clamp(ly, RAD + 4, vh - RAD - 4);
    if (U.dist(lx, ly, L.x, L.y) < RAD + 6) return;   /* 겹치면 그리지 않는다 */

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.arc(lx, ly, RAD, 0, 6.2832);
    ctx.clip();
    ctx.fillStyle = '#2b2b2b';
    ctx.fillRect(lx - RAD, ly - RAD, RAD * 2, RAD * 2);
    var src = RAD / ZOOM;
    try {
      ctx.drawImage(ctx.canvas,
        (L.x - src) * dpr, (L.y - src) * dpr, src * 2 * dpr, src * 2 * dpr,
        lx - RAD, ly - RAD, RAD * 2, RAD * 2);
    } catch (e) { /* 소스 영역이 캔버스 밖 */ }
    ctx.restore();

    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,.45)';
    ctx.beginPath(); ctx.arc(lx, ly, RAD + 1, 0, 6.2832); ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(lx, ly, RAD, 0, 6.2832); ctx.stroke();

    ctx.strokeStyle = UIC.blue; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(lx - 10, ly); ctx.lineTo(lx - 3, ly);
    ctx.moveTo(lx + 3, ly); ctx.lineTo(lx + 10, ly);
    ctx.moveTo(lx, ly - 10); ctx.lineTo(lx, ly - 3);
    ctx.moveTo(lx, ly + 3); ctx.lineTo(lx, ly + 10);
    ctx.stroke();
    ctx.restore();
  };

  Rn.UIC = UIC;
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
