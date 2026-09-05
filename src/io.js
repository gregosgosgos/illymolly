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
    if (AI.docs && AI.docs.current(app)) AI.docs.current(app).dirty = false;
    if (AI.autosave) AI.autosave.save(app, true);   /* 남은 문서가 없으면 기록을 지운다 */
    AI.ui.syncStatus(app);
    AI.ui.syncDocTabs && AI.ui.syncDocTabs(app);
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

  /* ---- PDF 가져오기 ----
     페이지의 벡터·문자·이미지를 편집 가능한 오브젝트로 되살린다.
     별색(칼선 포함)은 이름 그대로 문서에 등록된다. */
  IO.importPDFBytes = function (app, bytes, name, opts) {
    if (!AI.pdfin) { U.toast('PDF 모듈을 찾을 수 없습니다'); return null; }
    var doc = Model.newDoc(600, 400);
    doc.name = String(name || 'PDF').replace(/\.pdf$/i, '');
    var tmp = { doc: doc };
    var rep;
    try {
      rep = AI.pdfin.importInto(tmp, bytes, opts || {});
    } catch (e) {
      U.toast('PDF 를 읽지 못했습니다: ' + e.message);
      return null;
    }
    AI.docs.add(app, doc, { label: 'PDF 가져오기' });
    U.toast(IO.pdfReport(rep));
    return rep;
  };

  IO.pdfReport = function (rep) {
    var parts = [];
    if (rep.paths) parts.push('패스 ' + rep.paths);
    if (rep.texts) parts.push('문자 ' + rep.texts);
    if (rep.images) parts.push('이미지 ' + rep.images);
    if (rep.spots && rep.spots.length) parts.push('별색 ' + rep.spots.join('·'));
    var skip = Object.keys(rep.skipped || {});
    var head = (rep.imported > 1 ? rep.imported + '쪽 · ' : '') + (parts.join(' · ') || '가져온 것 없음');
    return head + (skip.length ? ' (못 가져옴: ' + skip.map(function (k) { return k + ' ' + rep.skipped[k]; }).join(', ') + ')' : '');
  };

  IO.openPDF = function (app) {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.pdf,application/pdf';
    inp.onchange = function () {
      var f = inp.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () { IO.importPDFBytes(app, new Uint8Array(r.result), f.name); };
      r.readAsArrayBuffer(f);
    };
    inp.click();
  };

  IO.openFile = function (app) {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,.illy,.svg,.pdf,application/json,image/svg+xml,application/pdf';
    inp.onchange = function () {
      var f = inp.files[0];
      if (!f) return;
      if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
        var rp = new FileReader();
        rp.onload = function () { IO.importPDFBytes(app, new Uint8Array(rp.result), f.name); };
        rp.readAsArrayBuffer(f);
        return;
      }
      var r = new FileReader();
      r.onload = function () {
        try {
          if (/\.svg$/i.test(f.name)) { IO.importSVG(app, String(r.result), f.name); return; }
          var o = JSON.parse(String(r.result));
          var doc = o.doc || o;
          normalizeDoc(doc);
          /* 일러스트레이터처럼 파일은 새 탭으로 열린다 */
          AI.docs.add(app, doc, { label: '열기' });
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
    if (AI.styles) AI.styles.normalize(doc);
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
  function paintSvg(paint, defs, bounds, doc) {
    if (!paint || paint.type === 'none') return { attr: 'none', op: 1 };
    if (paint.type === 'solid') return { attr: paint.color, op: paint.alpha == null ? 1 : paint.alpha };
    if (paint.type === 'pattern') {
      var pd = AI.assets.findPattern(doc || IO.__doc, paint.patternId);
      if (!pd) return { attr: '#cccccc', op: 1 };
      var pid = 'pat' + (++gradSeq);
      var k = (paint.scale == null ? 100 : paint.scale) / 100;
      defs.push('<pattern id="' + pid + '" patternUnits="userSpaceOnUse" width="' + U.round(pd.w * k, 3) +
        '" height="' + U.round(pd.h * k, 3) + '"' +
        (paint.angle ? ' patternTransform="rotate(' + U.round(paint.angle, 3) + ')"' : '') + '>' +
        '<g transform="scale(' + U.round(k, 4) + ')">' + itemSvg(IO.__doc, pd.item, defs) + '</g></pattern>');
      return { attr: 'url(#' + pid + ')', op: paint.alpha == null ? 1 : paint.alpha };
    }
    /* 자유형은 위 분기에서 그림으로 심는다. 여기까지 온 경우(문자 · 모양 스택 등)는
       대표색으로 근사한다 — SVG 에 대응하는 칠이 없다. */
    if (paint.type === 'freeform') {
      var f0 = paint.stops && paint.stops[0];
      return { attr: (f0 && f0.color) || '#cccccc', op: (f0 && f0.alpha == null) ? 1 : ((f0 && f0.alpha) || 1) };
    }
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

  /* 기하 효과까지 반영한 d 문자열 */
  function svgDFx(it, m) {
    var px = AI.distort.proxies(it);
    if (!px) return G.toSvgD(it, m);
    return px.map(function (p) { return G.toSvgD(p, m ? M.mul(m, p.fxm) : p.fxm); }).join(' ');
  }

  function itemSvg(doc, it, defs) {
    if (!it.visible) return '';
    /* 반복 — 규칙이 준 행렬마다 원본을 그대로 한 벌씩 담는다 */
    if (AI.repeat && AI.repeat.has(it) && !AI.repeat.isOne(it)) {
      var rms = AI.repeat.matrices(it);
      if (rms) {
        var one = AI.repeat.one(it);
        return rms.map(function (mi) {
          var t = M.isIdent(mi) ? '' : ' transform="matrix(' + mi.map(function (v) { return U.round(v, 4); }).join(' ') + ')"';
          return '<g' + t + '>' + itemSvg(doc, one, defs) + '</g>';
        }).join('');
      }
    }
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
    /* 3D — 투영된 면을 먼 것부터 폴리곤으로 내보낸다 */
    if (it.type === 'path') {
      var td = AI.threed.result(it);
      if (td) {
        var tb = td.faces.map(function (f) {
          var d = f.rings.map(function (r) {
            return 'M' + r.map(function (p) { return U.round(p.x, 3) + ' ' + U.round(p.y, 3); }).join(' L') + 'Z';
          }).join(' ');
          return '<path d="' + d + '" fill="' + f.color + '" fill-rule="evenodd" stroke="' + f.color +
            '" stroke-width="0.6"/>';
        }).join('');
        return '<g' + tr + op + '>' + tb + '</g>';
      }
    }
    /* 왜곡 및 변형 — 변형된 기하마다 같은 스타일로 한 벌씩 내보낸다 */
    var gpx = (it.type === 'path') ? AI.distort.proxies(it) : null;
    if (gpx) {
      var gbody = gpx.map(function (p) {
        var q = Object.create(p);
        q.m = p.fxm; q.opacity = 1; q.opacityMask = null;
        return itemSvg(doc, q, defs);
      }).join('');
      return '<g' + tr + op + '>' + gbody + '</g>';
    }
    if (it.type === 'symbol') {
      var sdef = AI.assets.findSymbol(doc, it.symbolId);
      if (!sdef) return '';
      return '<g' + tr + op + '>' + itemSvg(doc, sdef.item, defs) + '</g>';
    }
    if (it.type === 'group') {
      var inner = it.children.map(function (c) { return itemSvg(doc, c, defs); }).join('');
      if (it.clip && it.children.length) {
        var cp = it.children[it.children.length - 1];
        var cid = 'clip' + (++gradSeq);
        defs.push('<clipPath id="' + cid + '"><path d="' + svgDFx(cp, cp.m) + '"/></clipPath>');
        inner = it.children.slice(0, -1).map(function (c) { return itemSvg(doc, c, defs); }).join('');
        return '<g' + tr + op + ' clip-path="url(#' + cid + ')">' + inner + '</g>';
      }
      return '<g' + tr + op + '>' + inner + '</g>';
    }
    var b = Rn.localBounds(it);
    var style = styleFor(it, it.fill, it.stroke, defs, b);

    /* 자유형 그레이디언트 — SVG 에 대응하는 칠이 없다. 화면에 그릴 때와 똑같이
       구운 그림을 도형으로 잘라 심는다 (일러스트레이터도 이 칠은 래스터로 나간다). */
    if (it.type === 'path' && it.fill && it.fill.type === 'freeform' && it.fill.stops.length && U.hasDOM) {
      var ffBox = G.pathBounds(it, null);
      var ffCv = Rn.freeformCanvas(it.fill, ffBox);
      if (ffCv) {
        var fid = 'ffclip' + (++gradSeq);
        defs.push('<clipPath id="' + fid + '"><path d="' + G.toSvgD(it, null) + '"/></clipPath>');
        var strokeOnly = styleFor(it, AI.color.none(), it.stroke, defs, b);
        return '<g' + tr + op + '><image clip-path="url(#' + fid + ')" x="' + U.round(ffBox.x, 3) +
          '" y="' + U.round(ffBox.y, 3) + '" width="' + U.round(R.w(ffBox), 3) +
          '" height="' + U.round(R.h(ffBox), 3) + '" preserveAspectRatio="none" href="' +
          ffCv.toDataURL('image/png') + '"/>' +
          '<path d="' + G.toSvgD(it, null) + '"' + strokeOnly + '/></g>';
      }
    }

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
      /* 패스 상의 문자는 SVG 에 그대로 대응하는 <textPath> 가 있다 */
      if (t.path) {
        var tpid = 'tp' + (++gradSeq);
        defs.push('<path id="' + tpid + '" d="' + G.toSvgD({ subs: t.path.subs }, null) + '" fill="none"/>');
        var startOff = U.round(L.pathLen ? (pathStartOffset(t, L) / L.pathLen) * 100 : 0, 3);
        var dy = t.path.align === 'ascender' ? -L.asc
          : t.path.align === 'descender' ? t.size * 0.2
            : t.path.align === 'center' ? -L.asc / 2 : 0;
        return '<text' + tr + op + ' font-family="' + escXml(t.family) + '" font-size="' + t.size + '"' +
          (t.weight !== 400 ? ' font-weight="' + t.weight + '"' : '') +
          (t.tracking ? ' letter-spacing="' + t.tracking + '"' : '') +
          style + '><textPath href="#' + tpid + '" xlink:href="#' + tpid + '" startOffset="' + startOff + '%"' +
          (t.path.flip ? ' side="right"' : '') +
          (dy ? ' dy="' + U.round(dy, 3) + '"' : '') + '>' +
          escXml(String(t.content).replace(/\n/g, ' ')) + '</textPath></text>';
      }
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

  /* 패스 상의 문자가 실제로 시작하는 호 길이 (정렬을 반영) */
  function pathStartOffset(t, L) {
    var s0 = t.path.start || 0;
    if (t.align === 'center') s0 += (L.pathLen - L.textLen) / 2;
    else if (t.align === 'right') s0 += L.pathLen - L.textLen;
    return s0;
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

  /* 별색과 CMYK 는 SVG 표준에 자리가 없다. 값을 잃지 않도록 data- 속성에 적어
     둔다 — 우리 파일로 다시 읽을 때, 그리고 RIP·워크플로 스크립트가 이름으로
     칼선을 찾을 때 쓰인다. */
  function prepressAttr(paint, which) {
    if (!paint || paint.type === 'none') return '';
    var out = '';
    if (paint.spot) {
      out += ' data-' + which + '-spot="' + U.esc(paint.spot) + '"';
      if (paint.tint != null && paint.tint < 100) out += ' data-' + which + '-tint="' + U.round(paint.tint, 2) + '"';
    }
    var v = AI.prepress && AI.prepress.paintCmyk(IO.__doc, paint);
    if (v) out += ' data-' + which + '-cmyk="' + AI.prepress.cmykText(v) + '"';
    return out;
  }

  /* 칠 · 획 한 쌍을 SVG 속성 문자열로 */
  function styleFor(it, fill, stroke, defs, b) {
    var f = paintSvg(fill, defs, b);
    var out = ' fill="' + f.attr + '"' + (f.op < 1 ? ' fill-opacity="' + U.round(f.op, 3) + '"' : '');
    out += prepressAttr(fill, 'fill');
    if (stroke && stroke.type !== 'none' && stroke.width > 0) {
      var s = paintSvg(stroke, defs, b);
      out += ' stroke="' + s.attr + '" stroke-width="' + U.round(stroke.width, 3) + '"';
      out += prepressAttr(stroke, 'stroke');
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

  IO.toSVG = function (app, abIndex) {
    gradSeq = 0;
    IO.__doc = app.doc;
    var ab = app.doc.artboards[abIndex == null ? app.doc.activeArtboard : abIndex] ||
      app.doc.artboards[app.doc.activeArtboard];
    var defs = [];
    var body = app.doc.layers.filter(function (l) { return l.visible; })
      .map(function (l) { return '<g id="' + escXml(l.name) + '">' + l.children.map(function (c) { return itemSvg(app.doc, c, defs); }).join('') + '</g>'; })
      .join('');
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + U.round(ab.w, 2) + '" height="' + U.round(ab.h, 2) + '" ' +
      'viewBox="' + U.round(ab.x, 2) + ' ' + U.round(ab.y, 2) + ' ' + U.round(ab.w, 2) + ' ' + U.round(ab.h, 2) + '">\n' +
      (defs.length ? '<defs>' + defs.join('') + '</defs>\n' : '') + body + '\n</svg>';
  };

  IO.exportSVG = function (app) {
    if (app.doc.artboards.length > 1) { IO.exportArtboards(app, 'svg'); return; }
    var svg = IO.toSVG(app);
    download(baseName(app) + '.svg', new Blob([svg], { type: 'image/svg+xml' }));
    U.toast('SVG 내보내기 완료');
  };

  function baseName(app) { return app.doc.name.replace(/\.[a-z.]+$/i, ''); }

  /* 대지 이름을 파일 이름에 쓸 수 있게 다듬는다 */
  function safeName(s) {
    return String(s || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim() || '대지';
  }

  /* '1-3, 5' 같은 범위 문자열 -> 0 부터 시작하는 인덱스 배열 */
  IO.parseRange = function (text, n) {
    var out = [], seen = {};
    String(text || '').split(',').forEach(function (part) {
      var m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
      if (!m) return;
      var a = +m[1], b = m[2] ? +m[2] : a;
      if (b < a) { var t = a; a = b; b = t; }
      for (var i = a; i <= b; i++) {
        var k = i - 1;
        if (k >= 0 && k < n && !seen[k]) { seen[k] = 1; out.push(k); }
      }
    });
    return out;
  };

  /* 한 대지를 캔버스로 그린다 (PNG 내보내기 · 미리 보기 공용) */
  IO.renderArtboard = function (app, abIndex, scale, withBg) {
    var ab = app.doc.artboards[abIndex];
    var cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(ab.w * scale));
    cv.height = Math.max(1, Math.round(ab.h * scale));
    Rn.scene(cv.getContext('2d'), {
      doc: app.doc, dpr: 1, exporting: true, exportBg: withBg !== false,
      view: { scale: scale, tx: -ab.x * scale, ty: -ab.y * scale },
      prefs: { grid: false, guides: false, outline: false },
      canvas: cv, sel: [], selPts: [], invalidate: function () { }
    });
    return cv;
  };

  /* ---------------- 대지별 내보내기 ----------------
     일러스트레이터의 [내보내기 > 화면에 맞게 내보내기] 처럼 대지마다 파일을
     하나씩 만든다. 이름은 "문서-대지이름.확장자". */
  IO.exportArtboards = function (app, format) {
    AI.dialogs.exportArtboards(app, format, function (o) {
      var idx = o.which === 'current' ? [app.doc.activeArtboard]
        : o.which === 'range' ? IO.parseRange(o.range, app.doc.artboards.length)
          : app.doc.artboards.map(function (_, i) { return i; });
      if (!idx.length) { U.toast('내보낼 대지가 없습니다 — 범위를 확인하세요'); return; }
      o.indexes = idx;
      o.single = idx.length === 1 && o.which === 'current';
      IO.exportArtboardsNow(app, o);
    });
  };

  /* 실제로 파일을 만들어 내려받는다 (대화상자 없이 — 자동화에서도 쓴다) */
  IO.exportArtboardsNow = function (app, o) {
    var idx = o.indexes || app.doc.artboards.map(function (_, i) { return i; });
    var base = baseName(app);
    var one = o.single || app.doc.artboards.length === 1;
    var fmt = o.format || 'png';
    var names = [];
    idx.forEach(function (i, k) {
      var ab = app.doc.artboards[i];
      var name = base + (one ? '' : '-' + safeName(ab.name || ('대지 ' + (i + 1))));
      names.push(name + '.' + fmt);
      /* 브라우저가 연달아 오는 다운로드를 놓치지 않도록 조금씩 띄운다 */
      setTimeout(function () {
        if (fmt === 'svg') {
          download(name + '.svg', new Blob([IO.toSVG(app, i)], { type: 'image/svg+xml' }));
        } else if (fmt === 'pdf') {
          if (!AI.pdf) return;
          var bytes = AI.pdf.toBytes(AI.pdf.toPDF(app, { artboard: i, background: o.background !== false }));
          download(name + '.pdf', new Blob([bytes], { type: 'application/pdf' }));
        } else {
          var cv = IO.renderArtboard(app, i, o.scale || 2, o.background);
          try {
            cv.toBlob(function (blob) { download(name + '.png', blob); }, 'image/png');
          } catch (e) {
            U.toast(name + ' — 연결된 그림 때문에 PNG 로 만들 수 없습니다');
          }
        }
      }, k * 120);
    });
    U.toast(idx.length + '개 대지를 ' + fmt.toUpperCase() + ' 로 내보냅니다');
    IO.lastExportNames = names;      /* 방금 만든 파일 이름 (자동화·테스트에서 확인용) */
    return names;
  };

  IO.exportPDF = function (app) {
    if (!AI.pdf) { U.toast('PDF 모듈이 없습니다'); return; }
    if (app.doc.artboards.length > 1) { IO.exportArtboards(app, 'pdf'); return; }
    var str = AI.pdf.toPDF(app);
    var bytes = AI.pdf.toBytes(str);
    download(baseName(app) + '.pdf', new Blob([bytes], { type: 'application/pdf' }));
    U.toast('PDF 내보내기 완료' +
      (AI.pdf.lastDroppedText ? ' — 한글 등 비ASCII 글자 ' + AI.pdf.lastDroppedText + '자는 ?로 대체되었습니다 (윤곽선 만들기 권장)' : ''));
  };

  /* 문서에 담기지 않고 주소만 걸린 그림 — 브라우저가 캔버스를 잠가 버려
     PNG · PDF 로 내보낼 수 없게 만든다. 미리 이름을 알려 줄 수 있게 모아 둔다. */
  IO.linkedImages = function (doc) {
    var out = [];
    Model.walk(doc, function (it) {
      if (it.type === 'image' && it.linked) out.push(it.name || '이미지');
    });
    return out;
  };
  function warnLinked(app) {
    var n = IO.linkedImages(app.doc);
    if (!n.length) return false;
    U.toast('연결된 이미지 ' + n.length + '개(' + n.slice(0, 2).join(', ') +
      (n.length > 2 ? ' 외' : '') + ') 때문에 래스터로 내보낼 수 없습니다 — ' +
      '원본을 [이미지 복사] 로 다시 붙여넣거나 SVG 로 내보내 주세요');
    return true;
  }
  IO.warnLinked = warnLinked;

  IO.exportPNG = function (app) {
    if (app.doc.artboards.length > 1) { IO.exportArtboards(app, 'png'); return; }
    if (warnLinked(app)) return;
    AI.dialogs.exportPNG(app, function (scale, withBg) {
      var cv = IO.renderArtboard(app, app.doc.activeArtboard, scale, withBg);
      try {
        cv.toBlob(function (blob) {
          download(baseName(app) + '.png', blob);
          U.toast('PNG 내보내기 완료 (' + cv.width + '×' + cv.height + ')');
        }, 'image/png');
      } catch (e) {
        U.toast('PNG 로 내보낼 수 없습니다 — 다른 사이트에서 연결된 그림이 들어 있습니다');
      }
    });
  };

  /* ---------------- SVG 가져오기 (기본 도형/패스) ---------------- */
  /* SVG 문자열 -> 레이어 목록. 문서로 열 때도, 붙여넣을 때도 이 하나를 쓴다. */
  IO.parseSVG = function (text) {
    var dom = new DOMParser().parseFromString(text, 'image/svg+xml');
    var svg = dom.documentElement;
    if (!svg || svg.nodeName.toLowerCase() !== 'svg') return null;
    if (svg.getElementsByTagName('parsererror').length) return null;
    var vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(parseFloat);
    var width = parseFloat(svg.getAttribute('width')) || (vb.length === 4 ? vb[2] : 0) || 800;
    var height = parseFloat(svg.getAttribute('height')) || (vb.length === 4 ? vb[3] : 0) || 600;

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
    var layers;
    if (asLayers) {
      layers = tops.map(function (g, i) {
        var ly = Model.newLayer(g.getAttribute('id') || ('레이어 ' + (i + 1)));
        walk(g, ly.children);
        return ly;
      });
    } else {
      layers = [Model.newLayer()];
      walk(svg, layers[0].children);
    }
    return { width: width, height: height, layers: layers };
  };

  /* 붙여넣기 · 드롭용 — 레이어 구분 없이 항목만 뽑아 온다 */
  IO.svgToItems = function (text) {
    var p = IO.parseSVG(text);
    if (!p) return null;
    var out = [];
    p.layers.forEach(function (ly) { out.push.apply(out, ly.children); });
    return out.length ? out : null;
  };

  IO.importSVG = function (app, text, name) {
    var p = IO.parseSVG(text);
    if (!p) { U.toast('SVG 파싱 실패'); return; }
    var doc = Model.newDoc(p.width, p.height);
    doc.name = String(name || '무제').replace(/\.svg$/i, '');
    doc.layers = p.layers;
    doc.activeLayer = doc.layers.length - 1;
    AI.docs.add(app, doc, { label: 'SVG 가져오기' });
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
