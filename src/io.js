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

  IO.newDoc = function (app) { AI.dialogs.newDocument(app); };
  IO.docSetup = function (app) { AI.dialogs.documentSetup(app); };

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

  function writeFile(app, name) {
    app.doc.name = name;
    var data = JSON.stringify({ format: 'illymolly', version: 1, doc: app.doc }, null, 1);
    download(name.replace(/\.[a-z]+$/i, '') + '.illy.json', new Blob([data], { type: 'application/json' }));
    app.dirty = false;
    AI.ui.syncStatus(app);
    U.toast('저장됨: ' + name);
  }
  IO.save = function (app, asNew) {
    if (!asNew) { writeFile(app, app.doc.name); return; }
    AI.dialog.open({
      title: '다른 이름으로 저장',
      fields: [{ id: 'name', label: '파일 이름', type: 'text', value: app.doc.name, width: 180 }],
      onDone: function (v) { writeFile(app, (v.name || '무제-1').trim()); }
    });
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
    U.bumpIds(doc);
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
    /* 주석자로 지정한 기하가 있으면 사용자 좌표계로 내보낸다 */
    if (paint.p0 && paint.p1) {
      if (paint.type === 'radial') {
        var rr = U.round(Math.hypot(paint.p1.x - paint.p0.x, paint.p1.y - paint.p0.y), 3) || 0.01;
        defs.push('<radialGradient id="' + id + '" gradientUnits="userSpaceOnUse" cx="' + U.round(paint.p0.x, 3) +
          '" cy="' + U.round(paint.p0.y, 3) + '" r="' + rr + '">' + stops + '</radialGradient>');
      } else {
        defs.push('<linearGradient id="' + id + '" gradientUnits="userSpaceOnUse" x1="' + U.round(paint.p0.x, 3) +
          '" y1="' + U.round(paint.p0.y, 3) + '" x2="' + U.round(paint.p1.x, 3) +
          '" y2="' + U.round(paint.p1.y, 3) + '">' + stops + '</linearGradient>');
      }
      return { attr: 'url(#' + id + ')', op: 1 };
    }
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
    if (AI.effects.has(it)) {
      var fid = 'fx' + (++gradSeq);
      var fdef = AI.effects.svgFilter(it, fid);
      if (fdef) { defs.push(fdef); op += ' filter="url(#' + fid + ')"'; }
    }
    /* 불투명도 마스크 — SVG <mask> 는 기본이 luminance 라 화면과 규칙이 같다 */
    if (it.opacityMask) {
      var mid = 'omask' + (++gradSeq);
      var mb = Rn.localBounds(it);
      var inner2 = itemSvg(doc, it.opacityMask, defs);
      defs.push('<mask id="' + mid + '" maskUnits="userSpaceOnUse" x="' + U.round(mb.x - 4, 3) +
        '" y="' + U.round(mb.y - 4, 3) + '" width="' + U.round(mb.x2 - mb.x + 8, 3) +
        '" height="' + U.round(mb.y2 - mb.y + 8, 3) + '">' +
        (it.maskInvert ? '<rect x="' + U.round(mb.x - 4, 3) + '" y="' + U.round(mb.y - 4, 3) +
          '" width="' + U.round(mb.x2 - mb.x + 8, 3) + '" height="' + U.round(mb.y2 - mb.y + 8, 3) +
          '" fill="#ffffff"/><g style="mix-blend-mode:difference">' + inner2 + '</g>' : inner2) +
        '</mask>');
      var body2 = it.type === 'group'
        ? it.children.map(function (c) { return itemSvg(doc, c, defs); }).join('')
        : itemSvg(doc, maskless(it), defs);
      return '<g' + tr + op + ' mask="url(#' + mid + ')">' + body2 + '</g>';
    }
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
    var style = styleFor(it, it.fill, it.stroke, defs, b);

    /* 가변 폭 획: 칠 패스 + 윤곽 리본 패스로 나눠 내보낸다 */
    if (it.type === 'path' && it.stroke && it.stroke.type !== 'none' &&
        it.stroke.widthProfile && it.stroke.widthProfile.length > 1) {
      var fillOnly = styleFor(it, it.fill, null, defs, b);
      var ribbon = variableStrokePath(it, it.stroke);
      var sp = paintSvg(it.stroke, defs, b);
      return '<g' + tr + op + '><path d="' + G.toSvgD(it, null) + '"' + fillOnly + '/>' +
        (ribbon ? '<path d="' + ribbon + '" fill="' + sp.attr + '"' +
          (sp.op < 1 ? ' fill-opacity="' + U.round(sp.op, 3) + '"' : '') + '/>' : '') + '</g>';
    }

    /* 모양 스택(칠·획 여러 겹)은 SVG 에 대응이 없으므로 같은 패스를 겹쳐 그린다 */
    if (AI.appearance.isCustom(it) && it.type === 'path') {
      var layers = AI.appearance.list(it).map(function (e) {
        var st = styleFor(it, e.kind === 'fill' ? e.paint : AI.color.none(),
          e.kind === 'stroke' ? e.stroke : null, defs, b);
        return '<path d="' + G.toSvgD(it, null) + '"' + st + '/>';
      }).join('');
      return '<g' + tr + op + '>' + layers + '</g>';
    }
    if (it.type === 'path') return '<path' + tr + op + ' d="' + G.toSvgD(it, null) + '"' + style + '/>';
    if (it.type === 'image') {
      if (it.crop) {
        var c = it.crop;
        var W = it.w / Math.max(c.w, 1e-6), H = it.h / Math.max(c.h, 1e-6);
        var cid = 'clip' + (++gradSeq);
        defs.push('<clipPath id="' + cid + '"><rect x="0" y="0" width="' + U.round(it.w, 3) +
          '" height="' + U.round(it.h, 3) + '"/></clipPath>');
        return '<g' + tr + op + ' clip-path="url(#' + cid + ')"><image x="' + U.round(-c.x * W, 3) +
          '" y="' + U.round(-c.y * H, 3) + '" width="' + U.round(W, 3) + '" height="' + U.round(H, 3) +
          '" preserveAspectRatio="none" href="' + escXml(it.src) + '"/></g>';
      }
      return '<image' + tr + op + ' x="0" y="0" width="' + U.round(it.w, 3) + '" height="' + U.round(it.h, 3) +
        '" preserveAspectRatio="none" href="' + escXml(it.src) + '"/>';
    }
    if (it.type === 'text') {
      var t = it.text;
      var L = Rn.layoutText(it);
      /* 영역 문자는 줄바꿈 결과를 그대로 tspan 으로 굳혀 내보낸다 (SVG 에 자동 흐름이 없다) */
      var lines = L.lines.map(function (l, i) {
        var lx = t.area ? U.round(L.xs[i] || 0, 3) : 0;
        var ly = t.area ? U.round(L.asc + i * L.lineH, 3) : U.round(i * L.lineH, 3);
        return '<tspan x="' + lx + '" y="' + ly + '">' + escXml(l) + '</tspan>';
      }).join('');
      return '<text' + tr + op + ' font-family="' + escXml(t.family) + '" font-size="' + t.size + '"' +
        (t.weight !== 400 ? ' font-weight="' + t.weight + '"' : '') +
        (!t.area && t.align !== 'left' ? ' text-anchor="' + (t.align === 'center' ? 'middle' : 'end') + '"' : '') +
        (t.tracking ? ' letter-spacing="' + t.tracking + '"' : '') +
        style + '>' + lines + '</text>';
    }
    return '';
  }

  /* 화살표를 <marker> 로 — 시작/끝 각각 정의한다 */
  var ARROW_D = {
    arrow: 'M0 0 L-3.2 1.7 L-2.3 0 L-3.2 -1.7 Z',
    triangle: 'M0 0 L-2.8 1.5 L-2.8 -1.5 Z',
    circle: 'M-2.6 0 a1.3 1.3 0 1 0 2.6 0 a1.3 1.3 0 1 0 -2.6 0',
    square: 'M-2.6 -1.3 h2.6 v2.6 h-2.6 z',
    bar: 'M-0.35 -1.5 h0.7 v3 h-0.7 z'
  };
  /* 마스크를 뗀 사본 — 재귀가 무한히 돌지 않게 한다 */
  function maskless(it) {
    var c = Object.create(null);
    for (var k in it) if (Object.prototype.hasOwnProperty.call(it, k)) c[k] = it[k];
    delete c.opacityMask;
    c.m = [1, 0, 0, 1, 0, 0];
    return c;
  }

  /* 가변 폭 획은 SVG 에 대응이 없으므로 리본 모양으로 윤곽을 떠서 채운다 */
  function variableStrokePath(it, stroke) {
    var out = [];
    it.subs.forEach(function (sub) {
      var pts = G.flattenSub(sub, 0.3);
      if (pts.length < 2) return;
      var acc = [0], total = 0, i;
      for (i = 1; i < pts.length; i++) {
        total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        acc.push(total);
      }
      if (total < 1e-6) return;
      var left = [], right = [];
      for (i = 0; i < pts.length; i++) {
        var a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        var dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
        var nx = -dy / l, ny = dx / l;
        var hw = stroke.width * Rn.profileAt(stroke.widthProfile, acc[i] / total) / 2;
        left.push({ x: pts[i].x + nx * hw, y: pts[i].y + ny * hw });
        right.push({ x: pts[i].x - nx * hw, y: pts[i].y - ny * hw });
      }
      var ring = left.concat(right.reverse());
      out.push('M' + ring.map(function (p) { return U.round(p.x, 2) + ' ' + U.round(p.y, 2); }).join('L') + 'Z');
    });
    return out.join('');
  }

  /* 칠 · 획 한 쌍을 SVG 속성 문자열로 */
  function styleFor(it, fill, stroke, defs, b) {
    var f = paintSvg(fill, defs, b);
    var out = ' fill="' + f.attr + '"' + (f.op < 1 ? ' fill-opacity="' + U.round(f.op, 3) + '"' : '');
    if (stroke && stroke.type !== 'none' && stroke.width > 0) {
      var s = paintSvg(stroke, defs, b);
      out += ' stroke="' + s.attr + '" stroke-width="' + U.round(stroke.width, 3) + '"';
      if (s.op < 1) out += ' stroke-opacity="' + U.round(s.op, 3) + '"';
      if (stroke.cap && stroke.cap !== 'butt') out += ' stroke-linecap="' + stroke.cap + '"';
      if (stroke.join && stroke.join !== 'miter') out += ' stroke-linejoin="' + stroke.join + '"';
      if (stroke.dash && stroke.dash.length) out += ' stroke-dasharray="' + stroke.dash.join(' ') + '"';
      out += arrowMarkers(it, defs, stroke);
    }
    return out;
  }

  /* 화살표는 열린 패스의 끝점에만 붙는다 — 렌더러와 같은 규칙 */
  function hasOpenSub(it) {
    if (it.type !== 'path' || !it.subs) return false;
    return it.subs.some(function (sub) { return !sub.closed && sub.pts.length >= 2; });
  }
  function arrowMarkers(it, defs, stroke) {
    var s = stroke || it.stroke, out = '';
    if (!s || !hasOpenSub(it)) return '';
    var sc = (s.arrowScale == null ? 100 : s.arrowScale) / 100;
    [['arrowStart', 'marker-start', true], ['arrowEnd', 'marker-end', false]].forEach(function (o) {
      var kind = s[o[0]] || 'none';
      if (!ARROW_D[kind]) return;
      var id = 'arw' + (++gradSeq);
      var flip = o[2] ? ' transform="rotate(180)"' : '';
      defs.push('<marker id="' + id + '" markerUnits="strokeWidth" markerWidth="8" markerHeight="8" ' +
        'viewBox="-4 -4 8 8" refX="0" refY="0" orient="auto" overflow="visible">' +
        '<g' + flip + ' transform="scale(' + U.round(sc, 3) + ')">' +
        '<path d="' + ARROW_D[kind] + '" fill="' + s.color + '"/></g></marker>');
      out += ' ' + o[1] + '="url(#' + id + ')"';
    });
    return out;
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
    AI.dialogs.exportPNG(app, function (scale, withBg) {
      var ab = app.doc.artboards[app.doc.activeArtboard];
      var cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(ab.w * scale));
      cv.height = Math.max(1, Math.round(ab.h * scale));
      var ctx = cv.getContext('2d');
      var fake = {
        doc: app.doc, dpr: 1, exporting: true, exportBg: withBg,
        view: { scale: scale, tx: -ab.x * scale, ty: -ab.y * scale },
        prefs: { grid: false, guides: false, outline: false },
        canvas: cv, sel: [], selPts: [], invalidate: function () { }
      };
      Rn.scene(ctx, fake);
      cv.toBlob(function (blob) {
        download(app.doc.name.replace(/\.[a-z.]+$/i, '') + '.png', blob);
        U.toast('PNG 내보내기 완료 (' + cv.width + '×' + cv.height + ')');
      }, 'image/png');
    });
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
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
