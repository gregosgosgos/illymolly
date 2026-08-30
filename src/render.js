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
  Rn.textLines = function (it) { return String(it.text.content).split('\n'); };
  Rn.measureText = function (it) {
    var t = it.text, lines = Rn.textLines(it);
    var w = 0;
    for (var i = 0; i < lines.length; i++) {
      var m = Rn.measureLine(lines[i], t) + Math.max(0, lines[i].length - 1) * (t.tracking || 0);
      if (m > w) w = m;
    }
    var lh = t.size * (t.leading || 1.2);
    return { w: w, h: (lines.length - 1) * lh + t.size, lineH: lh, lines: lines, asc: t.size * 0.8 };
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
  Rn.localBounds = function (it) {
    if (it.type === 'path') return G.pathBounds(it, null);
    if (it.type === 'image') return { x: 0, y: 0, x2: it.w, y2: it.h };
    if (it.type === 'text') {
      var m = Rn.measureText(it), t = it.text, x0 = 0;
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
      return r;
    }
    var b = (it.type === 'path') ? G.pathBounds(it, m) : Rn.xformBounds(Rn.localBounds(it), m);
    if (!geo && it.type === 'path' && it.stroke && it.stroke.type !== 'none') {
      var al = it.stroke.align, k = al === 'inside' ? 0 : al === 'outside' ? 1 : 0.5;
      b = R.grow(b, (it.stroke.width || 0) * (sw == null ? 1 : sw) * k);
    }
    return b;
  };

  /* 월드 바운딩 (문서 좌표) — geo=true 면 획 두께 무시 */
  Rn.worldBounds = function (doc, it, geo) {
    return Rn.boundsM(it, Model.worldMatrix(doc, it), geo, 1);
  };

  Rn.selectionBounds = function (app, geo) {
    var r = R.empty();
    for (var i = 0; i < app.sel.length; i++) r = R.union(r, Rn.worldBounds(app.doc, app.sel[i], geo));
    return r;
  };

  /* ---------------- paint -> canvas style ---------------- */
  function paintStyle(ctx, paint, viewBounds) {
    if (!paint || paint.type === 'none') return null;
    if (paint.type === 'solid') return Col.toCss(paint.color, paint.alpha);
    var b = viewBounds;
    if (R.isEmpty(b)) return Col.toCss(paint.stops[0].color, paint.stops[0].alpha);
    var g;
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

  /* ---------------- 아트워크 ---------------- */
  Rn.scene = function (ctx, app) {
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

  Rn.item = function (ctx, app, it, pm, alpha, inIso) {
    if (!it.visible || it.__editing) return;
    var iso = app.isolation && app.isolation.length;
    if (iso && inIso === undefined) inIso = false;
    if (iso && !inIso && app.isolation.indexOf(it) >= 0) inIso = true;
    var m = M.mul(pm, it.m);
    var a = alpha * (it.opacity == null ? 1 : it.opacity);
    if (iso && !inIso && it.type !== 'group') a *= 0.28;
    if (a <= 0.001) return;

    if (it.type === 'group') {
      ctx.save();
      if (it.blend && it.blend !== 'normal') ctx.globalCompositeOperation = it.blend;
      if (it.clip && it.children.length) {
        var cp = it.children[it.children.length - 1];
        ctx.beginPath();
        G.tracePath(ctx, cp, M.mul(m, cp.m));
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
      if (it.type === 'path') G.tracePath(ctx, it, m);
      else { var b = Rn.localBounds(it), q = [[b.x, b.y], [b.x2, b.y], [b.x2, b.y2], [b.x, b.y2]].map(function (p) { return M.apply(m, p[0], p[1]); }); ctx.moveTo(q[0].x, q[0].y); for (var k = 1; k < 4; k++) ctx.lineTo(q[k].x, q[k].y); ctx.closePath(); }
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore(); return;
    }

    if (it.type === 'path') drawPath(ctx, app, it, m);
    else if (it.type === 'text') drawText(ctx, app, it, m);
    else if (it.type === 'image') drawImage(ctx, app, it, m);
    ctx.restore();
  };

  function viewBoundsOf(it, m) {
    if (it.type === 'path') return G.pathBounds(it, m);
    return Rn.xformBounds(Rn.localBounds(it), m);
  }

  function drawPath(ctx, app, it, m) {
    var vb = null;
    ctx.beginPath();
    G.tracePath(ctx, it, m);
    if (Col.isPaint(it.fill)) {
      vb = viewBoundsOf(it, m);
      ctx.fillStyle = paintStyle(ctx, it.fill, vb);
      ctx.fill('nonzero');
    }
    var s = it.stroke;
    if (!s || s.type === 'none' || !(s.width > 0)) return;
    if (!vb) vb = viewBoundsOf(it, m);

    var allClosed = it.subs.length > 0 && it.subs.every(function (sub) { return sub.closed; });
    var align = (s.align === 'inside' || s.align === 'outside') && allClosed ? s.align : 'center';
    var w = Math.max(s.width * app.view.scale, 0.08);

    function setup(lw, doubled) {
      ctx.strokeStyle = paintStyle(ctx, s, vb);
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

    if (align === 'center') {
      setup(w);
      ctx.beginPath();
      G.tracePath(ctx, it, m);
      ctx.stroke();
      ctx.setLineDash([]);
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
  }

  function drawImage(ctx, app, it, m) {
    var im = Rn.getImage(it.src, function () { app.invalidate && app.invalidate(); });
    ctx.save();
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    if (im.complete && im.naturalWidth && !im.__failed) {
      ctx.imageSmoothingQuality = 'high';
      try { ctx.drawImage(im, 0, 0, it.w, it.h); } catch (e) { }
    } else {
      ctx.fillStyle = 'rgba(150,150,150,.25)';
      ctx.fillRect(0, 0, it.w, it.h);
      ctx.strokeStyle = 'rgba(120,120,120,.7)';
      ctx.lineWidth = 1 / Math.max(Math.hypot(m[0], m[1]), 1e-6);
      ctx.strokeRect(0, 0, it.w, it.h);
    }
    ctx.restore();
  }

  function drawText(ctx, app, it, m) {
    var t = it.text, mt = Rn.measureText(it);
    ctx.save();
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.font = Rn.fontCss(t);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = t.align === 'center' ? 'center' : t.align === 'right' ? 'right' : 'left';
    var vb = { x: (t.align === 'center' ? -mt.w / 2 : t.align === 'right' ? -mt.w : 0), y: -mt.asc };
    vb.x2 = vb.x + mt.w; vb.y2 = vb.y + mt.h;
    var fs = Col.isPaint(it.fill) ? paintStyle(ctx, it.fill, vb) : null;
    var ss = (it.stroke && it.stroke.type !== 'none' && it.stroke.width > 0) ? paintStyle(ctx, it.stroke, vb) : null;
    for (var i = 0; i < mt.lines.length; i++) {
      var y = i * mt.lineH;
      var line = mt.lines[i];
      if (t.tracking) {
        drawTracked(ctx, line, 0, y, t, fs, ss, it, mt);
      } else {
        if (fs) { ctx.fillStyle = fs; ctx.fillText(line, 0, y); }
        if (ss) { ctx.strokeStyle = ss; ctx.lineWidth = it.stroke.width; ctx.strokeText(line, 0, y); }
      }
    }
    ctx.restore();
  }

  function drawTracked(ctx, line, x, y, t, fs, ss, it, mt) {
    var w = ctx.measureText(line).width + Math.max(0, line.length - 1) * t.tracking;
    var cx = t.align === 'center' ? -w / 2 : t.align === 'right' ? -w : 0;
    var prev = ctx.textAlign; ctx.textAlign = 'left';
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (fs) { ctx.fillStyle = fs; ctx.fillText(ch, cx, y); }
      if (ss) { ctx.strokeStyle = ss; ctx.lineWidth = it.stroke.width; ctx.strokeText(ch, cx, y); }
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
