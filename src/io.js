/* =========================================================================
   io.js — 새 문서 / 열기 / 저장 / SVG · PNG 내보내기
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, M = AI.mat, R = AI.rect, G = AI.geom, Model = AI.model, Rn = AI.render, Col = AI.color;
  var IO = AI.io = {};

  function download(name, blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  IO.newDoc = function (app) {
    var s = prompt('새 문서 크기 (가로 x 세로)', app.doc.width + ' x ' + app.doc.height);
    if (s == null) return;
    var m = s.split(/[x×,]/);
    var w = U.parseNum(m[0], 800), h = U.parseNum(m[1], 600);
    app.setDoc(Model.newDoc(Math.max(1, w), Math.max(1, h)));
    app.history.reset(app.doc, '새 문서');
    AI.viewT.fitArtboard(app);
    U.toast('새 문서 ' + U.round(w) + ' × ' + U.round(h));
  };

  IO.docSetup = function (app) {
    var ab = app.doc.artboards[app.doc.activeArtboard];
    var s = prompt('대지 크기 (가로 x 세로)', U.round(ab.w) + ' x ' + U.round(ab.h));
    if (s == null) return;
    var m = s.split(/[x×,]/);
    app.history.begin('문서 설정', app.doc);
    ab.w = Math.max(1, U.parseNum(m[0], ab.w));
    ab.h = Math.max(1, U.parseNum(m[1], ab.h));
    app.doc.width = ab.w; app.doc.height = ab.h;
    app.history.commit();
    app.invalidate();
  };

  /* ---------------- 이미지 배치 ---------------- */
  IO.placeImage = function (app) {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';
    inp.onchange = function () {
      var f = inp.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        var src = String(r.result);
        var probe = new Image();
        probe.onload = function () {
          var ab = app.doc.artboards[app.doc.activeArtboard];
          var iw = probe.naturalWidth || 100, ih = probe.naturalHeight || 100;
          var k = Math.min(1, ab.w * 0.8 / iw, ab.h * 0.8 / ih);
          var w = iw * k, h = ih * k;
          app.history.begin('이미지 배치', app.doc);
          var it = Model.newImage(src, ab.x + (ab.w - w) / 2, ab.y + (ab.h - h) / 2, w, h);
          it.name = f.name;
          Model.activeLayer(app.doc).children.push(it);
          AI.sel.set(app, [it]);
          app.history.commit();
          app.invalidate();
          AI.ui.syncAll(app);
          U.toast('이미지 배치: ' + f.name + ' (' + iw + '×' + ih + ')');
        };
        probe.onerror = function () { U.toast('이미지를 읽을 수 없습니다'); };
        probe.src = src;
      };
      r.readAsDataURL(f);
    };
    inp.click();
  };

  IO.save = function (app, asNew) {
    var name = app.doc.name;
    if (asNew) {
      var n = prompt('파일 이름', name);
      if (n == null) return;
      name = n; app.doc.name = n;
    }
    var data = JSON.stringify({ format: 'illymolly', version: 1, doc: app.doc }, null, 1);
    download(name.replace(/\.[a-z]+$/i, '') + '.illy.json', new Blob([data], { type: 'application/json' }));
    app.dirty = false;
    AI.ui.syncStatus(app);
    U.toast('저장됨');
  };

  IO.openFile = function (app) {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,.illy,.svg,application/json,image/svg+xml';
    inp.onchange = function () {
      var f = inp.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          if (/\.svg$/i.test(f.name)) { IO.importSVG(app, String(r.result), f.name); return; }
          var o = JSON.parse(String(r.result));
          var doc = o.doc || o;
          normalizeDoc(doc);
          app.setDoc(doc);
          app.history.reset(app.doc, '열기');
          AI.viewT.fitArtboard(app);
          U.toast(f.name + ' 열기 완료');
        } catch (e) {
          U.toast('파일을 읽을 수 없습니다: ' + e.message);
        }
      };
      r.readAsText(f);
    };
    inp.click();
  };

  function normalizeDoc(doc) {
    doc.layers = doc.layers || [Model.newLayer()];
    doc.artboards = doc.artboards || [{ id: U.uid('AB'), name: '대지 1', x: 0, y: 0, w: doc.width || 800, h: doc.height || 600 }];
    doc.guides = doc.guides || [];
    doc.activeArtboard = doc.activeArtboard || 0;
    doc.activeLayer = doc.activeLayer || 0;
    Model.walk(doc, function (it) {
      it.m = it.m || M.ident();
      if (it.type === 'path' && !it.subs) it.subs = [{ closed: false, pts: [] }];
      if (it.opacity == null) it.opacity = 1;
      if (it.visible == null) it.visible = true;
    });
  }
  IO.normalizeDoc = normalizeDoc;

  /* ---------------- SVG 내보내기 ---------------- */
  var gradSeq = 0;
  function paintSvg(paint, defs, bounds) {
    if (!paint || paint.type === 'none') return { attr: 'none', op: 1 };
    if (paint.type === 'solid') return { attr: paint.color, op: paint.alpha == null ? 1 : paint.alpha };
    var id = 'grad' + (++gradSeq);
    var stops = paint.stops.slice().sort(function (a, b) { return a.t - b.t; }).map(function (s) {
      return '<stop offset="' + U.round(s.t * 100, 2) + '%" stop-color="' + s.color + '" stop-opacity="' + (s.alpha == null ? 1 : s.alpha) + '"/>';
    }).join('');
    if (paint.type === 'radial') {
      defs.push('<radialGradient id="' + id + '" cx="' + (paint.cx || .5) + '" cy="' + (paint.cy || .5) + '" r="' + (paint.r || .5) + '">' + stops + '</radialGradient>');
    } else {
      var a = U.rad(paint.angle || 0);
      var dx = Math.cos(a) / 2, dy = Math.sin(a) / 2;
      defs.push('<linearGradient id="' + id + '" x1="' + (0.5 - dx) + '" y1="' + (0.5 - dy) + '" x2="' + (0.5 + dx) + '" y2="' + (0.5 + dy) + '">' + stops + '</linearGradient>');
    }
    return { attr: 'url(#' + id + ')', op: 1 };
  }

  function itemSvg(doc, it, defs) {
    if (!it.visible) return '';
    var tr = M.isIdent(it.m) ? '' : ' transform="matrix(' + it.m.map(function (v) { return U.round(v, 4); }).join(' ') + ')"';
    var op = (it.opacity != null && it.opacity < 1) ? ' opacity="' + U.round(it.opacity, 3) + '"' : '';
    if (it.type === 'group') {
      var inner = it.children.map(function (c) { return itemSvg(doc, c, defs); }).join('');
      if (it.clip && it.children.length) {
        var cp = it.children[it.children.length - 1];
        var cid = 'clip' + (++gradSeq);
        defs.push('<clipPath id="' + cid + '"><path d="' + G.toSvgD(cp, cp.m) + '"/></clipPath>');
        inner = it.children.slice(0, -1).map(function (c) { return itemSvg(doc, c, defs); }).join('');
        return '<g' + tr + op + ' clip-path="url(#' + cid + ')">' + inner + '</g>';
      }
      return '<g' + tr + op + '>' + inner + '</g>';
    }
    var b = Rn.localBounds(it);
    var f = paintSvg(it.fill, defs, b);
    var s = paintSvg(it.stroke && it.stroke.type !== 'none' ? it.stroke : null, defs, b);
    var style = ' fill="' + f.attr + '"' + (f.op < 1 ? ' fill-opacity="' + U.round(f.op, 3) + '"' : '');
    if (it.stroke && it.stroke.type !== 'none') {
      style += ' stroke="' + s.attr + '" stroke-width="' + U.round(it.stroke.width, 3) + '"';
      if (s.op < 1) style += ' stroke-opacity="' + U.round(s.op, 3) + '"';
      if (it.stroke.cap && it.stroke.cap !== 'butt') style += ' stroke-linecap="' + it.stroke.cap + '"';
      if (it.stroke.join && it.stroke.join !== 'miter') style += ' stroke-linejoin="' + it.stroke.join + '"';
      if (it.stroke.dash && it.stroke.dash.length) style += ' stroke-dasharray="' + it.stroke.dash.join(' ') + '"';
    }
    if (it.type === 'path') return '<path' + tr + op + ' d="' + G.toSvgD(it, null) + '"' + style + '/>';
    if (it.type === 'image') {
      return '<image' + tr + op + ' x="0" y="0" width="' + U.round(it.w, 3) + '" height="' + U.round(it.h, 3) +
        '" preserveAspectRatio="none" href="' + escXml(it.src) + '"/>';
    }
    if (it.type === 'text') {
      var t = it.text, lh = t.size * (t.leading || 1.2);
      var lines = String(t.content).split('\n').map(function (l, i) {
        return '<tspan x="0" y="' + U.round(i * lh, 3) + '">' + escXml(l) + '</tspan>';
      }).join('');
      return '<text' + tr + op + ' font-family="' + escXml(t.family) + '" font-size="' + t.size + '"' +
        (t.weight !== 400 ? ' font-weight="' + t.weight + '"' : '') +
        (t.align !== 'left' ? ' text-anchor="' + (t.align === 'center' ? 'middle' : 'end') + '"' : '') +
        (t.tracking ? ' letter-spacing="' + t.tracking + '"' : '') +
        style + '>' + lines + '</text>';
    }
    return '';
  }

  function escXml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c];
    });
  }

  IO.toSVG = function (app) {
    gradSeq = 0;
    var ab = app.doc.artboards[app.doc.activeArtboard];
    var defs = [];
    var body = app.doc.layers.filter(function (l) { return l.visible; })
      .map(function (l) { return '<g id="' + escXml(l.name) + '">' + l.children.map(function (c) { return itemSvg(app.doc, c, defs); }).join('') + '</g>'; })
      .join('');
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + U.round(ab.w, 2) + '" height="' + U.round(ab.h, 2) + '" ' +
      'viewBox="' + U.round(ab.x, 2) + ' ' + U.round(ab.y, 2) + ' ' + U.round(ab.w, 2) + ' ' + U.round(ab.h, 2) + '">\n' +
      (defs.length ? '<defs>' + defs.join('') + '</defs>\n' : '') + body + '\n</svg>';
  };

  IO.exportSVG = function (app) {
    var svg = IO.toSVG(app);
    download(app.doc.name.replace(/\.[a-z.]+$/i, '') + '.svg', new Blob([svg], { type: 'image/svg+xml' }));
    U.toast('SVG 내보내기 완료');
  };

  IO.exportPNG = function (app) {
    var s = prompt('PNG 배율 (1 = 100%)', '2');
    if (s == null) return;
    var scale = U.clamp(U.parseNum(s, 2), 0.1, 10);
    var ab = app.doc.artboards[app.doc.activeArtboard];
    var cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(ab.w * scale));
    cv.height = Math.max(1, Math.round(ab.h * scale));
    var ctx = cv.getContext('2d');
    var fake = {
      doc: app.doc, dpr: 1, exporting: true, exportBg: true,
      view: { scale: scale, tx: -ab.x * scale, ty: -ab.y * scale },
      prefs: { grid: false, guides: false, outline: false },
      canvas: cv, sel: [], selPts: []
    };
    Rn.scene(ctx, fake);
    cv.toBlob(function (blob) {
      download(app.doc.name.replace(/\.[a-z.]+$/i, '') + '.png', blob);
      U.toast('PNG 내보내기 완료 (' + cv.width + '×' + cv.height + ')');
    }, 'image/png');
  };

  /* ---------------- SVG 가져오기 (기본 도형/패스) ---------------- */
  IO.importSVG = function (app, text, name) {
    var dom = new DOMParser().parseFromString(text, 'image/svg+xml');
    var svg = dom.documentElement;
    if (!svg || svg.nodeName.toLowerCase() !== 'svg') { U.toast('SVG 파싱 실패'); return; }
    var doc = Model.newDoc(parseFloat(svg.getAttribute('width')) || 800, parseFloat(svg.getAttribute('height')) || 600);
    doc.name = name.replace(/\.svg$/i, '');
    var layer = doc.layers[0];

    function parseTransform(str) {
      var m = M.ident();
      if (!str) return m;
      var re = /(matrix|translate|scale|rotate)\s*\(([^)]*)\)/g, mm;
      while ((mm = re.exec(str))) {
        var v = mm[2].split(/[\s,]+/).map(parseFloat);
        if (mm[1] === 'matrix') m = M.mul(m, v.slice(0, 6));
        else if (mm[1] === 'translate') m = M.mul(m, M.translate(v[0] || 0, v[1] || 0));
        else if (mm[1] === 'scale') m = M.mul(m, M.scale(v[0] || 1, v.length > 1 ? v[1] : v[0]));
        else if (mm[1] === 'rotate') m = M.mul(m, M.around(M.rotate(U.rad(v[0] || 0)), v[1] || 0, v[2] || 0));
      }
      return m;
    }

    function styleOf(el, it) {
      var f = el.getAttribute('fill'), s = el.getAttribute('stroke'), w = el.getAttribute('stroke-width');
      it.fill = (!f || f === 'none') ? (f === 'none' ? Col.none() : Col.solid('#000000')) : Col.solid(normColor(f));
      it.stroke = Model.defaultStroke();
      if (s && s !== 'none') { it.stroke.type = 'solid'; it.stroke.color = normColor(s); it.stroke.width = parseFloat(w) || 1; }
      var o = parseFloat(el.getAttribute('opacity'));
      if (!isNaN(o)) it.opacity = o;
    }
    function normColor(c) {
      c = String(c).trim();
      if (c[0] === '#') return c.length === 4 ? '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3] : c.slice(0, 7);
      var m = c.match(/rgb\s*\(([^)]*)\)/i);
      if (m) { var v = m[1].split(',').map(parseFloat); return Col.rgbToHex(v[0], v[1], v[2]); }
      var probe = document.createElement('div');
      probe.style.color = c;
      document.body.appendChild(probe);
      var cs = getComputedStyle(probe).color;
      probe.remove();
      var mm = cs.match(/\d+/g);
      return mm ? Col.rgbToHex(+mm[0], +mm[1], +mm[2]) : '#000000';
    }

    function walk(el, parentList) {
      for (var i = 0; i < el.children.length; i++) {
        var c = el.children[i], tag = c.nodeName.toLowerCase(), it = null;
        if (tag === 'g') {
          it = Model.newGroup([]);
          it.m = parseTransform(c.getAttribute('transform'));
          parentList.push(it);
          walk(c, it.children);
          continue;
        }
        if (tag === 'path') it = pathFromD(c.getAttribute('d'));
        else if (tag === 'rect') it = Model.newRect(+c.getAttribute('x') || 0, +c.getAttribute('y') || 0, +c.getAttribute('width') || 0, +c.getAttribute('height') || 0, +c.getAttribute('rx') || 0);
        else if (tag === 'circle') it = Model.newEllipse((+c.getAttribute('cx') || 0) - (+c.getAttribute('r') || 0), (+c.getAttribute('cy') || 0) - (+c.getAttribute('r') || 0), (+c.getAttribute('r') || 0) * 2, (+c.getAttribute('r') || 0) * 2);
        else if (tag === 'ellipse') it = Model.newEllipse((+c.getAttribute('cx') || 0) - (+c.getAttribute('rx') || 0), (+c.getAttribute('cy') || 0) - (+c.getAttribute('ry') || 0), (+c.getAttribute('rx') || 0) * 2, (+c.getAttribute('ry') || 0) * 2);
        else if (tag === 'line') it = Model.newLine(+c.getAttribute('x1') || 0, +c.getAttribute('y1') || 0, +c.getAttribute('x2') || 0, +c.getAttribute('y2') || 0);
        else if (tag === 'polygon' || tag === 'polyline') {
          var pts = (c.getAttribute('points') || '').trim().split(/[\s,]+/).map(parseFloat);
          var arr = [];
          for (var k = 0; k + 1 < pts.length; k += 2) arr.push({ x: pts[k], y: pts[k + 1] });
          it = Model.newPath([{ closed: tag === 'polygon', pts: arr }]);
        } else if (tag === 'image') {
          var href = c.getAttribute('href') || c.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
          if (!href) continue;
          it = Model.newImage(href, +c.getAttribute('x') || 0, +c.getAttribute('y') || 0,
            +c.getAttribute('width') || 100, +c.getAttribute('height') || 100);
        } else if (tag === 'text') {
          it = Model.newText(+c.getAttribute('x') || 0, +c.getAttribute('y') || 0, c.textContent || '');
          it.text.size = parseFloat(c.getAttribute('font-size')) || 24;
        }
        if (!it) continue;
        var tm = parseTransform(c.getAttribute('transform'));
        if (!M.isIdent(tm)) it.m = M.mul(tm, it.m);
        if (it.type !== 'image') styleOf(c, it);
        parentList.push(it);
      }
    }

    /* 최상위 <g id="..."> (transform 없음) 는 레이어로 취급 — 자체 SVG 왕복 시 구조 보존 */
    var tops = Array.prototype.filter.call(svg.children, function (c) { return c.nodeType === 1; });
    var asLayers = tops.length > 0 && tops.every(function (c) {
      return c.nodeName.toLowerCase() === 'g' && c.getAttribute('id') && !c.getAttribute('transform');
    });
    if (asLayers) {
      doc.layers = tops.map(function (g, i) {
        var ly = Model.newLayer(g.getAttribute('id') || ('레이어 ' + (i + 1)));
        walk(g, ly.children);
        return ly;
      });
      doc.activeLayer = doc.layers.length - 1;
    } else {
      walk(svg, layer.children);
    }
    app.setDoc(doc);
    app.history.reset(doc, 'SVG 가져오기');
    AI.viewT.fitArtboard(app);
    U.toast('SVG 가져오기 완료');
  };

  /* d 속성 파서 (M L H V C S Q T A Z) */
  function pathFromD(d) {
    if (!d) return null;
    var toks = String(d).match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
    var i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, subs = [], cur = null, prevC = null;
    function nx() { return parseFloat(toks[i++]); }
    function startSub() { cur = { closed: false, pts: [] }; subs.push(cur); }
    function add(px, py) { cur.pts.push({ x: px, y: py }); return cur.pts[cur.pts.length - 1]; }
    while (i < toks.length) {
      var t = toks[i];
      if (/[a-zA-Z]/.test(t)) { cmd = t; i++; } else if (cmd === 'M') cmd = 'L'; else if (cmd === 'm') cmd = 'l';
      var rel = cmd === cmd.toLowerCase();
      var C = cmd.toUpperCase();
      if (C === 'M') {
        x = (rel ? x : 0) + nx(); y = (rel ? y : 0) + nx();
        startSub(); add(x, y); sx = x; sy = y; prevC = null;
      } else if (C === 'L') {
        x = (rel ? x : 0) + nx(); y = (rel ? y : 0) + nx();
        if (!cur) { startSub(); }
        add(x, y); prevC = null;
      } else if (C === 'H') { x = (rel ? x : 0) + nx(); add(x, y); prevC = null; }
      else if (C === 'V') { y = (rel ? y : 0) + nx(); add(x, y); prevC = null; }
      else if (C === 'C' || C === 'S') {
        var c1x, c1y;
        if (C === 'C') { c1x = (rel ? x : 0) + nx(); c1y = (rel ? y : 0) + nx(); }
        else { c1x = prevC ? 2 * x - prevC.x : x; c1y = prevC ? 2 * y - prevC.y : y; }
        var c2x = (rel ? x : 0) + nx(), c2y = (rel ? y : 0) + nx();
        var nxx = (rel ? x : 0) + nx(), nyy = (rel ? y : 0) + nx();
        if (!cur) startSub();
        var last = cur.pts[cur.pts.length - 1];
        if (last) { last.ox = c1x; last.oy = c1y; }
        var np = add(nxx, nyy);
        np.ix = c2x; np.iy = c2y;
        prevC = { x: c2x, y: c2y };
        x = nxx; y = nyy;
      } else if (C === 'Q' || C === 'T') {
        var qx, qy;
        if (C === 'Q') { qx = (rel ? x : 0) + nx(); qy = (rel ? y : 0) + nx(); }
        else { qx = prevC ? 2 * x - prevC.x : x; qy = prevC ? 2 * y - prevC.y : y; }
        var ex = (rel ? x : 0) + nx(), ey = (rel ? y : 0) + nx();
        if (!cur) startSub();
        var l2 = cur.pts[cur.pts.length - 1];
        if (l2) { l2.ox = x + 2 / 3 * (qx - x); l2.oy = y + 2 / 3 * (qy - y); }
        var np2 = add(ex, ey);
        np2.ix = ex + 2 / 3 * (qx - ex); np2.iy = ey + 2 / 3 * (qy - ey);
        prevC = { x: qx, y: qy };
        x = ex; y = ey;
      } else if (C === 'A') {
        nx(); nx(); nx(); nx(); nx();
        x = (rel ? x : 0) + nx(); y = (rel ? y : 0) + nx();
        if (!cur) startSub();
        add(x, y); prevC = null;
      } else if (C === 'Z') {
        if (cur) cur.closed = true;
        x = sx; y = sy; prevC = null;
      } else { i++; }
    }
    subs = subs.filter(function (s) { return s.pts.length > 1; });
    if (!subs.length) return null;
    return Model.newPath(subs);
  }
  IO.pathFromD = pathFromD;
})(window.AI);
