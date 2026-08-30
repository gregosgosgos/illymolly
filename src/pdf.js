/* =========================================================================
   pdf.js — 벡터 PDF 내보내기
   -------------------------------------------------------------------------
   외부 라이브러리 없이 PDF 1.4 파일을 직접 쓴다. 패스·색·불투명도·클리핑은
   벡터 그대로, 텍스트는 표준 14 글꼴(Helvetica)로, 이미지는 XObject 로 넣는다.

   PDF 좌표계는 좌하단이 원점이고 y 가 위로 간다. 문서 전체에
   [1 0 0 -1 0 H] 변환을 걸어 화면(좌상단 원점) 좌표를 그대로 쓴다.
   ========================================================================= */
(function (AI) {
  'use strict';
  var U = AI.util, M = AI.mat, R = AI.rect, G = AI.geom, Model = AI.model,
    Rn = AI.render, Col = AI.color;
  var P = AI.pdf = {};

  function n(v) { return U.round(v, 4); }

  /* ---------------- 콘텐츠 스트림 ---------------- */
  function Writer() {
    this.buf = [];
    this.xobjects = {};   /* 이름 -> {kind:'image', src} */
    this.alphas = {};     /* 이름 -> 알파값 */
    this.fonts = {};      /* 이름 -> base font */
    this.seq = 0;
  }
  Writer.prototype.w = function (s) { this.buf.push(s); return this; };

  Writer.prototype.alphaName = function (a) {
    var key = 'GS' + String(U.round(a, 3)).replace('.', '_');
    this.alphas[key] = a;
    return key;
  };
  Writer.prototype.fontName = function (base) {
    var key = 'F' + base.replace(/[^A-Za-z]/g, '');
    this.fonts[key] = base;
    return key;
  };
  Writer.prototype.imageName = function (src) {
    for (var k in this.xobjects) if (this.xobjects[k].src === src) return k;
    var key = 'Im' + (++this.seq);
    this.xobjects[key] = { kind: 'image', src: src };
    return key;
  };

  function rgb(hex) {
    var c = Col.hexToRgb(hex || '#000000');
    return n(c.r / 255) + ' ' + n(c.g / 255) + ' ' + n(c.b / 255);
  }

  /* 아이템의 서브패스를 PDF 경로 연산자로 */
  function pathOps(w, it, m) {
    it.subs.forEach(function (sub) {
      if (!sub.pts.length) return;
      var segs = G.segments(sub);
      var p0 = M.apply(m, sub.pts[0].x, sub.pts[0].y);
      w.w(n(p0.x) + ' ' + n(p0.y) + ' m');
      segs.forEach(function (sg) {
        var b = M.apply(m, sg.b.x, sg.b.y);
        if (sg.c1.x === sg.a.x && sg.c1.y === sg.a.y && sg.c2.x === sg.b.x && sg.c2.y === sg.b.y) {
          w.w(n(b.x) + ' ' + n(b.y) + ' l');
        } else {
          var c1 = M.apply(m, sg.c1.x, sg.c1.y), c2 = M.apply(m, sg.c2.x, sg.c2.y);
          w.w(n(c1.x) + ' ' + n(c1.y) + ' ' + n(c2.x) + ' ' + n(c2.y) + ' ' + n(b.x) + ' ' + n(b.y) + ' c');
        }
      });
      if (sub.closed) w.w('h');
    });
  }

  /* 그레이디언트·패턴은 PDF 셰이딩까지 가지 않고 대표색으로 근사한다 */
  function flatColor(paint) {
    if (!paint || paint.type === 'none') return null;
    if (paint.type === 'solid') return paint.color;
    if (paint.stops && paint.stops.length) {
      /* 정지점 색의 평균 — 눈으로 보기에 가장 덜 튄다 */
      var r = 0, g = 0, b = 0;
      paint.stops.forEach(function (s) {
        var c = Col.hexToRgb(s.color);
        r += c.r; g += c.g; b += c.b;
      });
      var k = paint.stops.length;
      return Col.rgbToHex(Math.round(r / k), Math.round(g / k), Math.round(b / k));
    }
    return '#cccccc';
  }

  function paintAlpha(paint) {
    if (!paint) return 1;
    return paint.alpha == null ? 1 : paint.alpha;
  }

  function drawItem(w, doc, it, m, alpha) {
    if (!it.visible) return;
    var a = alpha * (it.opacity == null ? 1 : it.opacity);
    if (a <= 0.003) return;
    var wm = M.mul(m, it.m);

    if (it.type === 'symbol') {
      var sd = AI.assets.findSymbol(doc, it.symbolId);
      if (sd) drawItem(w, doc, sd.item, wm, a);
      return;
    }
    if (it.type === 'group') {
      w.w('q');
      if (it.clip && it.children.length) {
        var cp = it.children[it.children.length - 1];
        pathOps(w, cp, M.mul(wm, cp.m));
        w.w('W n');
        for (var i = 0; i < it.children.length - 1; i++) drawItem(w, doc, it.children[i], wm, a);
      } else {
        it.children.forEach(function (c) { drawItem(w, doc, c, wm, a); });
      }
      w.w('Q');
      return;
    }
    if (it.type === 'image') { drawImage(w, it, wm, a); return; }
    if (it.type === 'text') { drawText(w, it, wm, a); return; }
    if (it.type !== 'path') return;

    AI.appearance.list(it).forEach(function (e) {
      if (e.kind === 'fill') {
        var col = flatColor(e.paint);
        if (!col) return;
        w.w('q');
        setAlpha(w, a * paintAlpha(e.paint));
        w.w(rgb(col) + ' rg');
        pathOps(w, it, wm);
        w.w('f');
        w.w('Q');
      } else {
        var st = e.stroke;
        if (!st || st.type === 'none' || !(st.width > 0)) return;
        var sc = flatColor(st);
        if (!sc) return;
        w.w('q');
        setAlpha(w, a * paintAlpha(st));
        w.w(rgb(sc) + ' RG');
        /* 변환에 담긴 배율만큼 선 두께를 맞춘다 */
        var k = Math.sqrt(Math.abs(wm[0] * wm[3] - wm[1] * wm[2])) || 1;
        w.w(n(Math.max(st.width * k, 0.01)) + ' w');
        w.w((st.cap === 'round' ? 1 : st.cap === 'square' ? 2 : 0) + ' J');
        w.w((st.join === 'round' ? 1 : st.join === 'bevel' ? 2 : 0) + ' j');
        if (st.dash && st.dash.length) w.w('[' + st.dash.map(function (d) { return n(d * k); }).join(' ') + '] 0 d');
        else w.w('[] 0 d');
        pathOps(w, it, wm);
        w.w('S');
        w.w('Q');
      }
    });
  }

  function setAlpha(w, a) {
    if (a >= 0.999) return;
    w.w('/' + w.alphaName(a) + ' gs');
  }

  function drawImage(w, it, m, a) {
    var name = w.imageName(it.src);
    w.w('q');
    setAlpha(w, a);
    /* 이미지 XObject 는 단위 사각형에 그려지므로 크기·상하반전을 변환에 담는다 */
    var mm = M.mulAll(m, M.translate(0, it.h), M.scale(it.w, -it.h));
    w.w([n(mm[0]), n(mm[1]), n(mm[2]), n(mm[3]), n(mm[4]), n(mm[5])].join(' ') + ' cm');
    w.w('/' + name + ' Do');
    w.w('Q');
  }

  function drawText(w, it, m, a) {
    var t = it.text;
    var col = flatColor(it.fill);
    if (!col) return;
    var L = Rn.layoutText(it);
    var base = 'Helvetica';
    if (/serif/i.test(t.family) && !/sans/i.test(t.family)) base = 'Times-Roman';
    if (/mono|courier/i.test(t.family)) base = 'Courier';
    if (t.weight >= 600) base = base === 'Times-Roman' ? 'Times-Bold' : (base + '-Bold');
    var fname = w.fontName(base);

    w.w('q');
    setAlpha(w, a);
    w.w(rgb(col) + ' rg');
    for (var i = 0; i < L.lines.length; i++) {
      var lx = t.area ? (L.xs[i] || 0) : lineX(L, i, t);
      var ly = t.area ? (L.asc + i * L.lineH) : (i * L.lineH);
      /* 글자는 y 가 위로 가는 좌표계에서 그려야 하므로 줄마다 상하반전을 넣는다 */
      var mm = M.mulAll(m, M.translate(lx, ly), M.scale(1, -1));
      w.w('BT');
      w.w('/' + fname + ' ' + n(t.size) + ' Tf');
      if (t.tracking) w.w(n(t.tracking) + ' Tc');
      w.w([n(mm[0]), n(mm[1]), n(mm[2]), n(mm[3]), n(mm[4]), n(mm[5])].join(' ') + ' Tm');
      w.w('(' + escapeText(L.lines[i]) + ') Tj');
      w.w('ET');
    }
    w.w('Q');
  }

  function lineX(L, i, t) {
    var wdt = L.widths[i] || 0;
    if (t.align === 'center') return -wdt / 2;
    if (t.align === 'right') return -wdt;
    return 0;
  }

  /* 표준 14 글꼴은 WinAnsi 라 한글이 들어가지 않는다.
     ASCII 밖 글자는 '?' 로 바꾸고 호출부에서 안내한다. */
  var droppedText = 0;
  function escapeText(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c > 255) { out += '?'; droppedText++; continue; }
      var ch = s[i];
      if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
      else if (c < 32) out += ' ';
      else out += ch;
    }
    return out;
  }

  /* ---------------- 파일 조립 ---------------- */
  P.toPDF = function (app, opt) {
    opt = opt || {};
    droppedText = 0;
    var doc = app.doc;
    var ab = doc.artboards[opt.artboard == null ? doc.activeArtboard : opt.artboard];
    var W = ab.w, H = ab.h;

    var w = new Writer();
    /* 대지 좌상단을 원점으로, y 아래 방향으로 맞춘다 */
    w.w('q');
    w.w('1 0 0 -1 ' + n(-ab.x) + ' ' + n(H + ab.y) + ' cm');
    if (opt.background !== false && doc.bg) {
      w.w(rgb(doc.bg) + ' rg');
      w.w(n(ab.x) + ' ' + n(ab.y) + ' ' + n(W) + ' ' + n(H) + ' re f');
    }
    doc.layers.forEach(function (ly) {
      if (!ly.visible) return;
      ly.children.forEach(function (c) { drawItem(w, doc, c, M.ident(), 1); });
    });
    w.w('Q');
    var content = w.buf.join('\n');

    /* --- 객체 --- */
    var objs = [];
    function obj(body) { objs.push(body); return objs.length; }   /* 1-based 번호 */

    var imageObjs = {};
    Object.keys(w.xobjects).forEach(function (k) {
      var info = imageStream(w.xobjects[k].src);
      if (!info) return;
      imageObjs[k] = obj(
        '<< /Type /XObject /Subtype /Image /Width ' + info.w + ' /Height ' + info.h +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /' + info.filter +
        ' /Length ' + info.data.length + ' >>\nstream\n' + info.data + '\nendstream');
    });
    var fontObjs = {};
    Object.keys(w.fonts).forEach(function (k) {
      fontObjs[k] = obj('<< /Type /Font /Subtype /Type1 /BaseFont /' + w.fonts[k] + ' /Encoding /WinAnsiEncoding >>');
    });
    var gsObjs = {};
    Object.keys(w.alphas).forEach(function (k) {
      gsObjs[k] = obj('<< /Type /ExtGState /ca ' + n(w.alphas[k]) + ' /CA ' + n(w.alphas[k]) + ' >>');
    });

    var contentObj = obj('<< /Length ' + byteLen(content) + ' >>\nstream\n' + content + '\nendstream');

    var res = ['<< /ProcSet [/PDF /Text /ImageC]'];
    if (Object.keys(fontObjs).length) {
      res.push('/Font << ' + Object.keys(fontObjs).map(function (k) { return '/' + k + ' ' + fontObjs[k] + ' 0 R'; }).join(' ') + ' >>');
    }
    if (Object.keys(imageObjs).length) {
      res.push('/XObject << ' + Object.keys(imageObjs).map(function (k) { return '/' + k + ' ' + imageObjs[k] + ' 0 R'; }).join(' ') + ' >>');
    }
    if (Object.keys(gsObjs).length) {
      res.push('/ExtGState << ' + Object.keys(gsObjs).map(function (k) { return '/' + k + ' ' + gsObjs[k] + ' 0 R'; }).join(' ') + ' >>');
    }
    res.push('>>');

    var pagesNo = objs.length + 2;      /* 아래 순서를 미리 계산 */
    var pageObj = obj('<< /Type /Page /Parent ' + pagesNo + ' 0 R /MediaBox [0 0 ' + n(W) + ' ' + n(H) +
      '] /Resources ' + res.join(' ') + ' /Contents ' + contentObj + ' 0 R >>');
    var pages = obj('<< /Type /Pages /Kids [' + pageObj + ' 0 R] /Count 1 >>');
    /* 제목의 비ASCII 는 사용자가 그린 글자가 아니므로 경고 수에 넣지 않는다 */
    var dropAtTitle = droppedText;
    var info = obj('<< /Producer (Illymolly) /Title (' + escapeText(String(doc.name || '무제')) + ') >>');
    droppedText = dropAtTitle;
    var root = obj('<< /Type /Catalog /Pages ' + pages + ' 0 R >>');

    /* --- 직렬화 --- */
    var out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    var offsets = [0];
    objs.forEach(function (body, i) {
      offsets.push(byteLen(out));
      out += (i + 1) + ' 0 obj\n' + body + '\nendobj\n';
    });
    var xref = byteLen(out);
    out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
    for (var i2 = 1; i2 <= objs.length; i2++) {
      out += String(offsets[i2]).padStart(10, '0') + ' 00000 n \n';
    }
    out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + root + ' 0 R /Info ' + info + ' 0 R >>\n';
    out += 'startxref\n' + xref + '\n%%EOF\n';
    P.lastDroppedText = droppedText;
    return out;
  };

  /* 파일 전체를 latin1(1글자 = 1바이트)로 다루므로 길이가 곧 바이트 수다.
     본문은 escapeText 가 ASCII 로 걸러 주고, JPEG 는 원래 바이트 문자열이다. */
  function byteLen(s) { return s.length; }

  /* latin1 문자열 -> Uint8Array (Blob 으로 그대로 저장할 수 있다) */
  P.toBytes = function (str) {
    var out = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
    return out;
  };

  /* data:image/jpeg 는 그대로(DCTDecode), 그 밖은 캔버스로 JPEG 변환 */
  function imageStream(src) {
    if (!U.hasDOM) return null;
    var im = Rn.getImage(src);
    if (!im || !im.complete || !im.naturalWidth) return null;
    var cv = document.createElement('canvas');
    cv.width = im.naturalWidth; cv.height = im.naturalHeight;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cv.width, cv.height);   /* PDF DCT 는 알파가 없다 */
    ctx.drawImage(im, 0, 0);
    var url;
    try { url = cv.toDataURL('image/jpeg', 0.92); } catch (e) { return null; }
    var b64 = url.slice(url.indexOf(',') + 1);
    return { w: cv.width, h: cv.height, filter: 'DCTDecode', data: atobBinary(b64) };
  }
  function atobBinary(b64) {
    var bin = atob(b64), out = '';
    for (var i = 0; i < bin.length; i++) out += bin[i];
    return out;
  }
})(typeof globalThis !== 'undefined' ? globalThis.AI : window.AI);
