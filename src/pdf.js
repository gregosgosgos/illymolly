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

  /* PDF 이름은 공백·특수문자를 #XX 로 적는다 (별색 이름이 그대로 들어간다) */
  function pdfName(s) {
    return String(s).replace(/[^A-Za-z0-9_.\-]/g, function (ch) {
      var b = ch.charCodeAt(0);
      if (b < 256) return '#' + (b < 16 ? '0' : '') + b.toString(16).toUpperCase();
      return encodeURIComponent(ch).replace(/%/g, '#');
    });
  }
  function hex4(v) { return ('0000' + (v & 0xffff).toString(16).toUpperCase()).slice(-4); }

  /* PDF 문자열 — ASCII 는 (그대로), 한글 등은 UTF-16BE 16진 문자열로.
     레이어 이름 · 문서 제목처럼 사용자가 그린 글자가 아닌 것에 쓴다
     (그래서 '? 로 대체' 개수에도 들어가지 않는다). */
  function pdfString(str) {
    var s2 = String(str == null ? '' : str);
    if (!/[^\x20-\x7e]/.test(s2)) {
      return '(' + s2.replace(/([\\()])/g, '\\$1') + ')';
    }
    var hex = 'FEFF';
    for (var i = 0; i < s2.length; i++) hex += hex4(s2.charCodeAt(i));
    return '<' + hex + '>';
  }
  function utf16hex(cp) {
    if (cp <= 0xffff) return hex4(cp);
    var v = cp - 0x10000;
    return hex4(0xd800 + (v >> 10)) + hex4(0xdc00 + (v & 0x3ff));
  }
  function chunk(a, n2) {
    var out = [];
    for (var i = 0; i < a.length; i += n2) out.push(a.slice(i, i + n2));
    return out;
  }
  function bytesToLatin1(b) {
    var s2 = '';
    for (var i = 0; i < b.length; i += 8192) {
      s2 += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
    }
    return s2;
  }
  /* 서브셋한 글꼴에는 여섯 글자 태그를 붙이는 것이 규칙이다 */
  function subsetTag(seed) {
    var h = 0;
    for (var i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    var out = '';
    for (var k = 0; k < 6; k++) { out += String.fromCharCode(65 + (h % 26)); h = Math.floor(h / 26) + 7; }
    return out;
  }

  function docBgPaint(doc) {
    if (!AI.prepress || AI.prepress.colorMode(doc) !== 'cmyk') return null;
    return { type: 'solid', color: doc.bg, cmyk: AI.prepress.rgbToCmyk(doc.bg || '#ffffff') };
  }

  /* ---------------- 콘텐츠 스트림 ---------------- */
  function Writer() {
    this.buf = [];
    this.xobjects = {};   /* 이름 -> {kind:'image', src} */
    this.alphas = {};     /* 이름 -> 알파값 */
    this.fonts = {};      /* 이름 -> base font */
    this.spots = {};      /* 이름 -> {res:'CS1', name, cmyk} — 별색 분판 */
    this.embed = {};      /* 이름 -> {font, gids:{원본gid:1}} — 심을 글꼴 */
    this.ocgs = [];       /* [{res:'OC0', name, visible}] — 레이어 (PDF 의 선택적 콘텐츠) */
    this.overprint = false;
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
  /* 별색은 PDF 의 /Separation 색공간이 된다 — RIP 이 이름으로 판을 만든다 */
  Writer.prototype.spotName = function (name, cmyk) {
    if (this.spots[name]) return this.spots[name].res;
    var res = 'CS' + (Object.keys(this.spots).length + 1);
    this.spots[name] = { res: res, name: name, cmyk: cmyk };
    return res;
  };
  /* 레이어 한 겹 = PDF 의 선택적 콘텐츠 그룹(OCG) 하나.
     일러스트레이터는 PDF 를 열 때 OCG 를 레이어로 되살린다. */
  Writer.prototype.ocgName = function (layer) {
    for (var i = 0; i < this.ocgs.length; i++) if (this.ocgs[i].layer === layer) return this.ocgs[i].res;
    var res = 'OC' + this.ocgs.length;
    this.ocgs.push({ res: res, layer: layer, name: layer.name || ('레이어 ' + (this.ocgs.length + 1)), visible: layer.visible !== false });
    return res;
  };

  /* 심는 글꼴 — 쓰인 글리프를 모아 두었다가 마지막에 서브셋해서 넣는다 */
  Writer.prototype.embedName = function (font) {
    var key = 'E' + font.key.replace(/[^A-Za-z0-9]/g, '');
    if (!this.embed[key]) this.embed[key] = { font: font, order: [], cid: {}, uni: {} };
    return key;
  };
  /* 콘텐츠에 적을 CID 를 그 자리에서 정한다 — 서브셋 글꼴의 새 글리프 번호가
     이 번호와 같아지도록 아래에서 같은 순서로 서브셋한다. */
  Writer.prototype.useGlyph = function (key, gid, cp) {
    var e = this.embed[key];
    if (e.cid[gid] == null) {
      e.order.push(gid);
      e.cid[gid] = e.order.length;      /* 0 은 .notdef 자리 */
      e.uni[e.cid[gid]] = cp;
    }
    return e.cid[gid];
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
  function cmykOps(v) {
    return n(v.c / 100) + ' ' + n(v.m / 100) + ' ' + n(v.y / 100) + ' ' + n(v.k / 100);
  }
  /* paint 가 담고 있는 만큼만 정확하게 쓴다.
     별색이면 /Separation, CMYK 값이 있으면 DeviceCMYK, 없으면 DeviceRGB. */
  function colorOps(w, doc, paint, hex, stroking) {
    var PP = AI.prepress;
    if (PP && paint && paint.spot) {
      var sp = PP.findSpot(doc, paint.spot);
      if (sp) {
        var res = w.spotName(sp.name, sp.cmyk);
        var tint = n((paint.tint == null ? 100 : paint.tint) / 100);
        return stroking ? ('/' + res + ' CS ' + tint + ' SCN') : ('/' + res + ' cs ' + tint + ' scn');
      }
    }
    var v = PP ? PP.paintCmyk(doc, paint || { type: 'solid', color: hex }) : null;
    if (v) return cmykOps(v) + (stroking ? ' K' : ' k');
    return rgb(hex) + (stroking ? ' RG' : ' rg');
  }
  /* 오버프린트 — 밑색을 파내지 않고 겹쳐 찍으라는 지시 */
  function opGS(w, it, which) {
    var PP = AI.prepress;
    if (!PP || !PP.hasOverprint(it, which)) return null;
    w.overprint = true;
    return '/GSOP gs';
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

  /* 기하 효과(왜곡 및 변형)까지 반영한 경로 */
  function pathOpsFx(w, it, m) {
    var px = AI.distort.proxies(it);
    if (!px) { pathOps(w, it, m); return; }
    px.forEach(function (p) { pathOps(w, p, M.mul(m, p.fxm)); });
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

    /* 반복 — 규칙이 준 행렬마다 원본을 한 벌씩 */
    if (AI.repeat && AI.repeat.has(it) && !AI.repeat.isOne(it)) {
      var rms = AI.repeat.matrices(it);
      if (rms) {
        var one = AI.repeat.one(it);
        for (var ri = 0; ri < rms.length; ri++) drawItem(w, doc, one, M.mul(m, rms[ri]), alpha);
        return;
      }
    }

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
        pathOpsFx(w, cp, M.mul(wm, cp.m));
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

    /* 3D — 투영된 면을 먼 것부터 칠한다 */
    var td = AI.threed.result(it);
    if (td) {
      td.faces.forEach(function (f) {
        w.w('q');
        setAlpha(w, a);
        w.w(rgb(f.color) + ' rg');
        f.rings.forEach(function (ring) {
          if (ring.length < 2) return;
          var p0 = M.apply(wm, ring[0].x, ring[0].y);
          w.w(n(p0.x) + ' ' + n(p0.y) + ' m');
          for (var i = 1; i < ring.length; i++) {
            var q = M.apply(wm, ring[i].x, ring[i].y);
            w.w(n(q.x) + ' ' + n(q.y) + ' l');
          }
          w.w('h');
        });
        w.w('f*');
        w.w('Q');
      });
      return;
    }

    /* 왜곡 및 변형 — 변형된 기하마다 같은 겹으로 한 벌씩 */
    var gpx = AI.distort.proxies(it);
    if (gpx) {
      gpx.forEach(function (p) {
        var q = Object.create(p);
        q.m = p.fxm; q.opacity = 1;
        drawItem(w, doc, q, wm, a);
      });
      return;
    }

    AI.appearance.list(it).forEach(function (e) {
      if (e.kind === 'fill') {
        var col = flatColor(e.paint);
        if (!col) return;
        w.w('q');
        setAlpha(w, a * paintAlpha(e.paint));
        var opf = opGS(w, it, 'fill'); if (opf) w.w(opf);
        w.w(colorOps(w, doc, e.paint, col, false));
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
        var ops = opGS(w, it, 'stroke'); if (ops) w.w(ops);
        w.w(colorOps(w, doc, st, sc, true));
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

    /* 패스 상의 문자 — 글자마다 접선 각도로 세운 텍스트 행렬을 쓴다 */
    if (t.path && L.glyphs) {
      L.glyphs.forEach(function (g) {
        var gm = M.mulAll(m, M.translate(g.x, g.y), M.rotate(g.ang), M.scale(1, -1));
        w.w('BT');
        writeRun(w, t, g.ch, gm, fname);
        w.w('ET');
      });
      w.w('Q');
      return;
    }

    for (var i = 0; i < L.lines.length; i++) {
      var lx = t.area ? (L.xs[i] || 0) : lineX(L, i, t);
      var ly = t.area ? (L.asc + i * L.lineH) : (i * L.lineH);
      /* 글자는 y 가 위로 가는 좌표계에서 그려야 하므로 줄마다 상하반전을 넣는다 */
      var mm = M.mulAll(m, M.translate(lx, ly), M.scale(1, -1));
      w.w('BT');
      if (t.tracking) w.w(n(t.tracking) + ' Tc');
      writeRun(w, t, L.lines[i], mm, fname);
      w.w('ET');
    }
    w.w('Q');
  }

  /* 한 줄을 쓴다.
     ASCII 밖 글자가 있고 심을 글꼴이 있으면 글꼴을 심어서 쓴다 — 그러면
     글자 모양이 원본 그대로이고, 일러스트레이터에서 편집 가능한 텍스트로 열린다.
     글꼴이 없으면 예전처럼 표준 14 글꼴로 쓰고 못 담는 글자는 ? 가 된다.
     글꼴이 바뀌는 자리에서 줄을 토막 내고, 토막마다 진행 폭을 계산해 이어 붙인다. */
  function writeRun(w, t, text, mm, fname) {
    var FE = AI.fontembed;
    var weight = t.weight || 400;

    /* 줄에 한글이 섞여 있으면 **줄 전체**를 심은 글꼴로 쓴다.
       라틴 부분만 표준 글꼴로 떼어 내면 그 구간의 진행 폭을 우리가 추정해야
       하는데, 추정이 조금만 어긋나도 띄어쓰기 간격이 눈에 띄게 벌어진다.
       한 글꼴로 쓰면 글꼴이 가진 폭이 그대로 쓰이므로 어긋날 여지가 없다. */
    var whole = wholeLineFont(FE, text, weight);
    if (whole) {
      w.w([n(mm[0]), n(mm[1]), n(mm[2]), n(mm[3]), n(mm[4]), n(mm[5])].join(' ') + ' Tm');
      var wkey = w.embedName(whole), whex = '';
      for (var q = 0; q < text.length; q++) {
        var wcp = text.codePointAt(q);
        if (wcp > 0xffff) q++;
        var wgid = FE.gid(whole, wcp);
        whex += ('0000' + w.useGlyph(wkey, wgid, wcp).toString(16)).slice(-4);
      }
      w.w('/' + wkey + ' ' + n(t.size) + ' Tf');
      w.w('<' + whex + '> Tj');
      return;
    }

    var runs = [], cur = null;
    for (var i = 0; i < text.length; i++) {
      var cp = text.codePointAt(i);
      var wide = cp > 0xffff;
      var ch = wide ? text.slice(i, i + 2) : text[i];
      if (wide) i++;
      var font = (FE && cp > 0x7e) ? FE.pick(cp, weight) : null;
      if (!cur || cur.font !== font) { cur = { font: font, chars: [] }; runs.push(cur); }
      cur.chars.push({ ch: ch, cp: cp });
    }
    var dx = 0;
    runs.forEach(function (r) {
      var rm = M.mul(mm, M.translate(dx, 0));
      w.w([n(rm[0]), n(rm[1]), n(rm[2]), n(rm[3]), n(rm[4]), n(rm[5])].join(' ') + ' Tm');
      if (r.font) {
        var key = w.embedName(r.font);
        var hex = '', adv = 0, upm = r.font.unitsPerEm || 1000;
        r.chars.forEach(function (c) {
          var gid = FE.gid(r.font, c.cp);
          var cid = w.useGlyph(key, gid, c.cp);
          hex += ('0000' + cid.toString(16)).slice(-4);
          adv += FE.advance(r.font, gid) / upm * t.size + (t.tracking || 0);
        });
        w.w('/' + key + ' ' + n(t.size) + ' Tf');
        w.w('<' + hex + '> Tj');
        dx += adv;
      } else {
        var str = r.chars.map(function (c) { return c.ch; }).join('');
        w.w('/' + fname + ' ' + n(t.size) + ' Tf');
        w.w('(' + escapeText(str) + ') Tj');
        dx += measureAscii(t, str);
      }
    });
  }

  /* 이 줄을 통째로 담을 수 있는 심은 글꼴 — 한글이 하나라도 있을 때만 */
  function wholeLineFont(FE, text, weight) {
    if (!FE) return null;
    var hasWide = false, cps = [];
    for (var i = 0; i < text.length; i++) {
      var cp = text.codePointAt(i);
      if (cp > 0xffff) i++;
      if (cp > 0x7e) hasWide = true;
      cps.push(cp);
    }
    if (!hasWide) return null;
    var cand = FE.pick(cps.find(function (c) { return c > 0x7e; }), weight);
    if (!cand) return null;
    for (var k = 0; k < cps.length; k++) if (!FE.has(cand, cps[k])) return null;
    return cand;
  }

  /* 표준 14 글꼴 구간의 진행 폭 — 화면 렌더러의 계산을 그대로 쓴다 */
  function measureAscii(t, str) {
    if (!str) return 0;
    var wdt = Rn.measureLine ? Rn.measureLine(str, t) : str.length * t.size * 0.5;
    return wdt + (t.tracking || 0) * str.length;
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
  /* ---------------- .ai 로 저장 ----------------
     Illustrator 9(2000) 이후의 .ai 는 사실 PDF 다. 헤더가 %PDF- 로 시작하고,
     일러스트레이터만 읽는 비공개 스트림(PGF)이 하나 더 들어 있을 뿐이다.
     그 비공개 부분은 공개된 규격이 없으므로 우리는 쓰지 않는다 — 대신
     일러스트레이터가 "PDF 호환" 경로로 읽는 부분을 정확히 쓴다.
     열면 패스 · 색 · 이미지가 그대로 편집된다 (라이브 셰이프 · 효과는 평면화).

     한글은 표준 14 글꼴에 없어 ? 가 되므로, 기본으로 문자를 윤곽선으로 바꾼
     사본을 만들어 내보낸다. 원본 문서는 건드리지 않는다. */
  P.toAI = function (app, opt) {
    opt = opt || {};
    P.lastOutlined = 0;
    /* 글꼴을 심을 수 있으면 그게 낫다 — 글자 모양이 원본 그대로이고
       일러스트레이터에서 **편집 가능한 텍스트**로 열린다. 윤곽선은
       글꼴을 못 받았거나 일부러 요청했을 때만 쓴다. */
    if (!opt.outlineText) return P.toPDF(app, opt);
    if (!U.hasDOM || !AI.trace) return P.toPDF(app, opt);   /* 글리프 윤곽은 캔버스가 필요하다 */

    var copy = U.deepCopy(app.doc);
    var tmp = {
      doc: copy, view: app.view, prefs: app.prefs, sel: [], selPts: [],
      dpr: 1, invalidate: function () { }
    };
    var n = 0, guard = 0;
    for (;;) {
      var found = null;
      Model.walk(copy, function (it, list, i) {
        if (it.type === 'text') { found = { it: it, list: list, i: i }; return false; }
      });
      if (!found || guard++ > 2000) break;
      var outline = AI.trace.textToOutlines(tmp, found.it);
      if (outline) { found.list.splice(found.i, 1, outline); n++; }
      else found.list.splice(found.i, 1);   /* 윤곽선을 못 만들면 빼는 편이 ? 보다 낫다 */
    }
    P.lastOutlined = n;
    return P.toPDF(tmp, opt);
  };

  P.toPDF = function (app, opt) {
    opt = opt || {};
    droppedText = 0;
    P.lastEmbedded = 0; P.lastEmbedBytes = 0;
    var doc = app.doc;

    /* 어느 대지를 담을지 — 여럿이면 여러 페이지가 된다.
       일러스트레이터는 여러 쪽 PDF 를 열 때 쪽마다 대지를 만들어 준다. */
    var idx;
    if (opt.artboards === 'all') idx = doc.artboards.map(function (_, i) { return i; });
    else if (Array.isArray(opt.artboards) && opt.artboards.length) {
      idx = opt.artboards.map(function (v) { return U.clamp(Math.round(v), 0, doc.artboards.length - 1); });
    } else idx = [opt.artboard == null ? doc.activeArtboard : opt.artboard];

    var w = new Writer();
    var pages = idx.map(function (ai2) {
      var ab = doc.artboards[ai2];
      w.buf = [];
      /* 대지 좌상단을 원점으로, y 아래 방향으로 맞춘다 */
      w.w('q');
      w.w('1 0 0 -1 ' + n(-ab.x) + ' ' + n(ab.h + ab.y) + ' cm');
      if (opt.background !== false && doc.bg) {
        w.w(colorOps(w, doc, docBgPaint(doc), doc.bg, false));
        w.w(n(ab.x) + ' ' + n(ab.y) + ' ' + n(ab.w) + ' ' + n(ab.h) + ' re f');
      }
      /* 레이어마다 OCG 로 감싼다 — 일러스트레이터가 레이어로 되살린다 */
      doc.layers.forEach(function (ly) {
        if (!ly.visible) return;
        if (!ly.children.length) return;
        var oc = w.ocgName(ly);
        w.w('/OC /' + oc + ' BDC');
        ly.children.forEach(function (c) { drawItem(w, doc, c, M.ident(), 1); });
        w.w('EMC');
      });
      w.w('Q');
      return { index: ai2, name: ab.name, w: ab.w, h: ab.h, content: w.buf.join('\n') };
    });
    var W = pages[0].w, H = pages[0].h;

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

    /* --- 심는 글꼴 (Type0 / CIDFontType2, Identity-H) ---
       쓰인 글리프만 서브셋해서 넣는다. 글리프 번호를 그대로 CID 로 쓰므로
       CIDToGIDMap 은 /Identity 다. ToUnicode 를 붙여 복사 · 검색도 되게 한다. */
    var embedded = 0, embedBytes = 0;
    Object.keys(w.embed).forEach(function (k) {
      var e = w.embed[k], f = e.font;
      if (!e.order.length) return;
      var sub;
      try { sub = AI.fontembed.subset(f, e.order); } catch (err) { return; }
      embedded++; embedBytes += sub.data.length;

      /* 콘텐츠에 적은 CID 와 서브셋의 새 글리프 번호는 같아야 한다 */
      var used = e.order.map(function (g, i) {
        return { cid: i + 1, gid: g, cp: e.uni[i + 1] };
      });

      var upm = f.unitsPerEm || 1000;
      var Wparts = used.map(function (x) {
        return x.cid + ' [' + n(AI.fontembed.advance(f, x.gid) / upm * 1000) + ']';
      });

      var bfr = used.filter(function (x) { return x.cp != null; }).map(function (x) {
        return '<' + hex4(x.cid) + '> <' + utf16hex(x.cp) + '>';
      });
      var toUni = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n' +
        '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n' +
        '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n' +
        chunk(bfr, 100).map(function (g) {
          return g.length + ' beginbfchar\n' + g.join('\n') + '\nendbfchar';
        }).join('\n') +
        '\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';

      var fileObj = obj('<< /Length ' + sub.data.length + ' /Length1 ' + sub.data.length + ' >>\nstream\n' +
        bytesToLatin1(sub.data) + '\nendstream');
      var tag = subsetTag(f.psName || 'Font') + '+' + (f.psName || 'Font');
      var fd = obj('<< /Type /FontDescriptor /FontName /' + tag +
        ' /Flags 4 /FontBBox [' + [f.xMin, f.yMin, f.xMax, f.yMax].map(function (v) { return Math.round(v / upm * 1000); }).join(' ') + ']' +
        ' /ItalicAngle 0 /Ascent ' + Math.round(f.ascent / upm * 1000) +
        ' /Descent ' + Math.round(f.descent / upm * 1000) +
        ' /CapHeight ' + Math.round(f.ascent / upm * 1000 * 0.72) +
        ' /StemV 80 /FontFile2 ' + fileObj + ' 0 R >>');
      var uniObj = obj('<< /Length ' + byteLen(toUni) + ' >>\nstream\n' + toUni + '\nendstream');
      var cidFont = obj('<< /Type /Font /Subtype /CIDFontType2 /BaseFont /' + tag +
        ' /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >>' +
        ' /FontDescriptor ' + fd + ' 0 R /DW 1000 /W [' + Wparts.join(' ') + ']' +
        ' /CIDToGIDMap /Identity >>');
      fontObjs[k] = obj('<< /Type /Font /Subtype /Type0 /BaseFont /' + tag +
        ' /Encoding /Identity-H /DescendantFonts [' + cidFont + ' 0 R]' +
        ' /ToUnicode ' + uniObj + ' 0 R >>');
    });
    P.lastEmbedded = embedded;
    P.lastEmbedBytes = embedBytes;
    var gsObjs = {};
    Object.keys(w.alphas).forEach(function (k) {
      gsObjs[k] = obj('<< /Type /ExtGState /ca ' + n(w.alphas[k]) + ' /CA ' + n(w.alphas[k]) + ' >>');
    });
    if (w.overprint) {
      gsObjs.GSOP = obj('<< /Type /ExtGState /OP true /op true /OPM 1 >>');
    }
    /* 별색 — 농도 0~1 을 그 별색의 CMYK 로 옮기는 함수를 달아 준다 */
    var csObjs = {};
    Object.keys(w.spots).forEach(function (name) {
      var sp = w.spots[name];
      var fn = obj('<< /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [' +
        cmykOps(sp.cmyk) + '] /N 1 >>');
      csObjs[sp.res] = obj('[ /Separation /' + pdfName(sp.name) + ' /DeviceCMYK ' + fn + ' 0 R ]');
    });

    var contentObjs = pages.map(function (pg) {
      return obj('<< /Length ' + byteLen(pg.content) + ' >>\nstream\n' + pg.content + '\nendstream');
    });

    /* --- 레이어 (선택적 콘텐츠 그룹) --- */
    var ocgObjs = w.ocgs.map(function (o) {
      return obj('<< /Type /OCG /Name ' + pdfString(o.name) + ' >>');
    });

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
    if (Object.keys(csObjs).length) {
      res.push('/ColorSpace << ' + Object.keys(csObjs).map(function (k) { return '/' + k + ' ' + csObjs[k] + ' 0 R'; }).join(' ') + ' >>');
    }
    if (ocgObjs.length) {
      res.push('/Properties << ' + w.ocgs.map(function (o, i) {
        return '/' + o.res + ' ' + ocgObjs[i] + ' 0 R';
      }).join(' ') + ' >>');
    }
    res.push('>>');
    var resStr = res.join(' ');

    var pagesNo = objs.length + pages.length + 1;   /* 아래 순서를 미리 계산 */
    var pageObjs = pages.map(function (pg, i) {
      return obj('<< /Type /Page /Parent ' + pagesNo + ' 0 R /MediaBox [0 0 ' + n(pg.w) + ' ' + n(pg.h) +
        '] /Resources ' + resStr + ' /Contents ' + contentObjs[i] + ' 0 R >>');
    });
    var pagesObj = obj('<< /Type /Pages /Kids [' +
      pageObjs.map(function (o) { return o + ' 0 R'; }).join(' ') +
      '] /Count ' + pageObjs.length + ' >>');
    var info = obj('<< /Producer (Illymolly) /Title ' + pdfString(doc.name || '무제') + ' >>');
    var ocProps = '';
    if (ocgObjs.length) {
      var refs = ocgObjs.map(function (o) { return o + ' 0 R'; }).join(' ');
      var onRefs = ocgObjs.filter(function (_, i) { return w.ocgs[i].visible; })
        .map(function (o) { return o + ' 0 R'; }).join(' ');
      var offRefs = ocgObjs.filter(function (_, i) { return !w.ocgs[i].visible; })
        .map(function (o) { return o + ' 0 R'; }).join(' ');
      ocProps = ' /OCProperties << /OCGs [' + refs + '] /D << /Order [' + refs + ']' +
        ' /ON [' + onRefs + '] /OFF [' + offRefs + '] /BaseState /ON >> >>';
    }
    var root = obj('<< /Type /Catalog /Pages ' + pagesObj + ' 0 R' + ocProps + ' >>');
    P.lastPages = pageObjs.length;
    P.lastLayers = ocgObjs.length;

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
